import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { Miniflare, Response as MiniflareResponse, type Request as MiniflareRequest } from 'miniflare'

const origin = 'https://drmc.test'
const applicationId = '123456789012345678'
const allowedUserId = '234567890123456789'
const accessKey = 'operator-access-key-for-test-only-123456'
const grantedScopes = ['identify', 'openid', 'activities.write', 'sdk.social_layer_presence']

class DiscordFixture {
  exchangeStatus = 200
  refreshStatus = 200
  revokeStatus = 200
  userId = allowedUserId
  application = applicationId
  redirectExchange = false
  malformedTokenStage: 'exchange' | 'refresh' | null = null
  requests: string[] = []

  async respond(request: MiniflareRequest): Promise<MiniflareResponse> {
    const url = new URL(request.url)
    assert.equal(url.origin, 'https://discord.com')
    if (url.pathname === '/api/v10/oauth2/@me') {
      this.requests.push('inspect')
      assert.match(request.headers.get('Authorization') ?? '', /^Bearer (initial|refreshed)-access-token$/)
      return MiniflareResponse.json({
        application: { id: this.application },
        scopes: grantedScopes,
        expires: '2026-10-20T00:00:00Z',
        user: { id: this.userId },
      })
    }

    assert.equal(request.method, 'POST')
    assert.equal(request.headers.get('Content-Type'), 'application/x-www-form-urlencoded;charset=UTF-8')
    const parameters = new URLSearchParams(await request.text())
    assert.equal(parameters.get('client_id'), applicationId)
    assert.equal(parameters.get('client_secret'), 'test-client-secret')

    if (url.pathname === '/api/oauth2/token/revoke') {
      this.requests.push('revoke')
      assert.match(parameters.get('token') ?? '', /^(initial|refreshed)-refresh-token$/)
      assert.equal(parameters.get('token_type_hint'), 'refresh_token')
      return new MiniflareResponse(null, { status: this.revokeStatus })
    }

    assert.equal(url.pathname, '/api/oauth2/token')
    const refreshing = parameters.get('grant_type') === 'refresh_token'
    this.requests.push(refreshing ? 'refresh' : 'exchange')
    if (refreshing) {
      assert.equal(parameters.get('refresh_token'), 'initial-refresh-token')
    } else {
      assert.equal(parameters.get('code'), 'test-code')
      assert.equal(parameters.get('redirect_uri'), `${origin}/probe/callback`)
    }
    if (this.redirectExchange && !refreshing) {
      return new MiniflareResponse(null, { status: 302, headers: { Location: 'https://unexpected.test' } })
    }
    const status = refreshing ? this.refreshStatus : this.exchangeStatus
    if (status !== 200) {
      return MiniflareResponse.json({ error: 'invalid_scope', error_description: 'DO NOT EXPOSE PROVIDER BODY' }, { status })
    }
    const prefix = refreshing ? 'refreshed' : 'initial'
    return MiniflareResponse.json({
      access_token: `${prefix}-access-token`,
      refresh_token: `${prefix}-refresh-token`,
      token_type: this.malformedTokenStage === (refreshing ? 'refresh' : 'exchange') ? 'unexpected' : 'Bearer',
      expires_in: 604800,
      scope: grantedScopes.join(' '),
    })
  }
}

function createRuntime(context: TestContext, discord = new DiscordFixture(), overrides: Record<string, string> = {}) {
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    cf: false,
    workers: [{
      config: {
        name: 'drmc',
        compatibilityDate: '2026-10-05',
        assets: {
          directory: new URL('../build/', import.meta.url).pathname,
          hasUserWorker: true,
          runWorkerFirst: ['/api/*', '/health', '/probe/start', '/probe/callback'],
          notFoundHandling: '404-page',
        },
        manifest: {
          mainModule: 'index.js',
          modules: { 'index.js': { type: 'esm', contents: readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8') } },
        },
        exports: { OAuthAttempt: { type: 'durable-object', storage: 'sqlite' } },
        env: {
          ASSETS: { type: 'assets' },
          OAUTH_ATTEMPTS: { type: 'durable-object', worker: 'drmc', exportName: 'OAuthAttempt' },
          ...Object.fromEntries(Object.entries({
            APP_ORIGIN: origin,
            PROBE_ENABLED: 'true',
            PROBE_ALLOWED_DISCORD_IDS: allowedUserId,
            DISCORD_CLIENT_ID: applicationId,
            DISCORD_CLIENT_SECRET: 'test-client-secret',
            PROBE_ACCESS_KEY: accessKey,
            ...overrides,
          }).map(([name, value]) => [name, { type: 'text', value }])),
        },
      },
      dev: { outboundService: { type: 'fetcher', handler: (request: MiniflareRequest) => discord.respond(request) } },
    }],
  })
  context.after(() => runtime.dispose())
  return { runtime, discord }
}

async function beginProbe(runtime: Miniflare) {
  const response = await runtime.dispatchFetch(`${origin}/probe/start`, {
    method: 'POST',
    redirect: 'manual',
    headers: { Origin: origin },
    body: new URLSearchParams({ access_key: accessKey }),
  })
  assert.equal(response.status, 303)
  const authorization = new URL(response.headers.get('Location')!)
  assert.equal(authorization.origin, 'https://discord.com')
  assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/probe/callback`)
  assert.equal(authorization.searchParams.get('scope'), 'identify openid sdk.social_layer_presence')
  const state = authorization.searchParams.get('state')!
  assert.match(state, /^[a-f0-9]{64}$/)
  const setCookie = response.headers.get('Set-Cookie')!
  assert.match(setCookie, /HttpOnly; SameSite=Lax; Max-Age=600; Secure/)
  return { state, cookie: setCookie.split(';')[0]! }
}

function callback(runtime: Miniflare, attempt: { state: string; cookie: string }, parameters: Record<string, string> = { code: 'test-code' }) {
  const query = new URLSearchParams({ state: attempt.state, ...parameters })
  return runtime.dispatchFetch(`${origin}/probe/callback?${query}`, { headers: { Cookie: attempt.cookie } })
}

test('the disabled probe reports health without accepting OAuth attempts', async context => {
  const { runtime, discord } = createRuntime(context, undefined, { PROBE_ENABLED: 'false' })
  const health = await runtime.dispatchFetch(`${origin}/health`)
  assert.deepEqual(await health.json(), { status: 'ok', feasibility: 'unverified' })
  const start = await runtime.dispatchFetch(`${origin}/probe/start`, { method: 'POST' })
  assert.equal(start.status, 404)
  assert.deepEqual(await start.json(), { error: 'probe_disabled' })
  assert.deepEqual(discord.requests, [])
})

test('public probe status exposes readiness without operator secrets or account IDs', async context => {
  for (const [overrides, expected] of [
    [{ PROBE_ENABLED: 'false' }, 'disabled'],
    [{ PROBE_ALLOWED_DISCORD_IDS: '' }, 'unconfigured'],
    [{}, 'ready'],
  ] as const) {
    const { runtime } = createRuntime(context, undefined, overrides)
    const response = await runtime.dispatchFetch(`${origin}/api/probe`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { state: expected, publication: 'not_tested' })
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
  }
})

test('prerendered pages serve through assets while callback and API routes stay protected', async context => {
  const { runtime, discord } = createRuntime(context)
  for (const path of ['/', '/probe']) {
    const response = await runtime.dispatchFetch(`${origin}${path}`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('Content-Type')!, /text\/html/)
    const html = await response.text()
    assert.match(html, /DRMC/)
    assert.match(html, /content-security-policy/i)
    assert.equal(html.includes(accessKey), false)
    assert.equal(response.headers.get('Referrer-Policy'), 'same-origin')
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY')
  }
  const callbackResponse = await runtime.dispatchFetch(`${origin}/probe/callback`)
  assert.equal(callbackResponse.status, 400)
  assert.deepEqual(await callbackResponse.json(), { error: 'invalid_authorization_state' })
  const missingApi = await runtime.dispatchFetch(`${origin}/api/missing`)
  assert.equal(missingApi.status, 404)
  assert.deepEqual(await missingApi.json(), { error: 'not_found' })
  assert.deepEqual(discord.requests, [])
})

test('configuration fails closed for empty allowlists and insecure production origins', async context => {
  const configurations: Record<string, string>[] = [{ PROBE_ALLOWED_DISCORD_IDS: '' }, { APP_ORIGIN: 'http://drmc.test' }]
  for (const overrides of configurations) {
    const { runtime } = createRuntime(context, undefined, overrides)
    const response = await runtime.dispatchFetch(`${origin}/probe/start`, { method: 'POST' })
    assert.equal(response.status, 503)
    const body = await response.json() as { error: string; fields: string[] }
    assert.equal(body.error, 'probe_not_configured')
    assert.ok(body.fields.includes(Object.keys(overrides)[0]!))
    assert.equal(JSON.stringify(body).includes('test-client-secret'), false)
  }
})

test('authorization start rejects foreign origins and wrong operator keys', async context => {
  const { runtime, discord } = createRuntime(context)
  for (const [requestOrigin, key] of [['https://attacker.test', accessKey], [origin, 'wrong-key']]) {
    const response = await runtime.dispatchFetch(`${origin}/probe/start`, {
      method: 'POST', headers: { Origin: requestOrigin! },
      body: new URLSearchParams({ access_key: key! }),
    })
    assert.equal(response.status, 403)
  }
  assert.deepEqual(discord.requests, [])
})

test('oversized operator form is rejected before authorization', async context => {
  const { runtime } = createRuntime(context)
  const response = await runtime.dispatchFetch(`${origin}/probe/start`, {
    method: 'POST', headers: { Origin: origin },
    body: new URLSearchParams({ access_key: 'x'.repeat(5000) }),
  })
  assert.equal(response.status, 413)
})

test('successful scope and refresh checks never mark publishing verified or expose credentials', async context => {
  const { runtime, discord } = createRuntime(context)
  const response = await callback(runtime, await beginProbe(runtime))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body, {
    gate: 'unverified', publication: 'not_tested', oauth: 'verified',
    requestedScopes: ['identify', 'openid', 'sdk.social_layer_presence'],
    authorization: {
      applicationId, userId: allowedUserId, scopes: grantedScopes, expiresAt: '2026-10-20T00:00:00Z',
    },
    refreshed: true, cleanup: 'revoked',
  })
  assert.deepEqual(discord.requests, ['exchange', 'inspect', 'refresh', 'inspect', 'revoke'])
  for (const secret of [accessKey, 'test-client-secret', 'access-token', 'refresh-token', 'test-code']) {
    assert.equal(JSON.stringify(body).includes(secret), false)
  }
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')
  assert.match(response.headers.get('Set-Cookie')!, /Max-Age=0/)
})

test('authorization attempts reject another browser and can only be consumed once', async context => {
  const { runtime, discord } = createRuntime(context)
  const attempt = await beginProbe(runtime)
  const wrongBrowser = await callback(runtime, { ...attempt, cookie: `drmc_probe=${'f'.repeat(64)}` })
  assert.equal(wrongBrowser.status, 400)
  assert.deepEqual(discord.requests, [])
  assert.equal((await callback(runtime, attempt)).status, 200)
  assert.equal((await callback(runtime, attempt)).status, 400)
  assert.equal(discord.requests.filter(operation => operation === 'exchange').length, 1)
})

test('concurrent callbacks cannot exchange the same attempt twice', async context => {
  const { runtime, discord } = createRuntime(context)
  const attempt = await beginProbe(runtime)
  const responses = await Promise.all([callback(runtime, attempt), callback(runtime, attempt)])
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400])
  assert.equal(discord.requests.filter(operation => operation === 'exchange').length, 1)
})

test('expired durable authorization attempts are rejected before token exchange', async context => {
  const { runtime, discord } = createRuntime(context)
  const attempt = await beginProbe(runtime)
  const namespace = await runtime.getDurableObjectNamespace('OAUTH_ATTEMPTS')
  const stub = namespace.get(namespace.idFromName(attempt.state)) as unknown as {
    create(attempt: { browserBindingHash: string; expiresAt: number }): Promise<void>
  }
  await stub.create({ browserBindingHash: 'irrelevant', expiresAt: Date.now() - 1 })
  assert.equal((await callback(runtime, attempt)).status, 400)
  assert.deepEqual(discord.requests, [])
})

test('denied consent consumes state without exchanging any code', async context => {
  const { runtime, discord } = createRuntime(context)
  const attempt = await beginProbe(runtime)
  const denied = await callback(runtime, attempt, { error: 'access_denied' })
  assert.equal(denied.status, 400)
  assert.deepEqual(await denied.json(), { error: 'authorization_denied', discord_error: 'access_denied' })
  assert.equal((await callback(runtime, attempt)).status, 400)
  assert.deepEqual(discord.requests, [])
})

for (const error of ['invalid_scope', 'invalid_request', 'invalid_client', 'server_error', 'private-unrecognized-provider-value']) {
  test(`Discord callback error ${error} consumes state and returns only a recognized diagnostic`, async context => {
    const { runtime, discord } = createRuntime(context)
    const attempt = await beginProbe(runtime)
    const response = await callback(runtime, attempt, { error, error_description: 'PRIVATE PROVIDER DESCRIPTION', code: 'private-code' })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      error: 'authorization_failed',
      discord_error: error === 'private-unrecognized-provider-value' ? 'unknown_error' : error,
    })
    assert.equal((await callback(runtime, attempt)).status, 400)
    assert.deepEqual(discord.requests, [])
  })
}

test('unlisted accounts are rejected and their obtained grants revoked', async context => {
  const discord = new DiscordFixture()
  discord.userId = '345678901234567890'
  const { runtime } = createRuntime(context, discord)
  const response = await callback(runtime, await beginProbe(runtime))
  assert.equal(response.status, 403)
  const body = await response.json() as Record<string, unknown>
  assert.deepEqual(body.failure, { operation: 'admission', reason: 'account_not_allowed', status: null })
  assert.equal(body.authorization, undefined)
  assert.equal(body.cleanup, 'revoked')
  assert.deepEqual(discord.requests, ['exchange', 'inspect', 'revoke'])
})

test('scope rejection is a sanitized diagnostic without any publication attempt', async context => {
  const discord = new DiscordFixture()
  discord.exchangeStatus = 400
  const { runtime } = createRuntime(context, discord)
  const response = await callback(runtime, await beginProbe(runtime))
  assert.equal(response.status, 502)
  const body = await response.json() as Record<string, unknown>
  assert.deepEqual(body.failure, { operation: 'exchange', reason: 'invalid_scope', status: 400 })
  assert.equal(JSON.stringify(body).includes('DO NOT EXPOSE'), false)
  assert.equal(body.gate, 'unverified')
  assert.deepEqual(discord.requests, ['exchange'])
})

test('failed refresh still revokes the initial grant', async context => {
  const discord = new DiscordFixture()
  discord.refreshStatus = 400
  const { runtime } = createRuntime(context, discord)
  const response = await callback(runtime, await beginProbe(runtime))
  assert.equal(response.status, 502)
  const body = await response.json() as Record<string, unknown>
  assert.equal(body.oauth, 'failed')
  assert.equal(body.cleanup, 'revoked')
  assert.deepEqual(discord.requests, ['exchange', 'inspect', 'refresh', 'revoke'])
})

test('revocation failure is visible and cannot report complete cleanup', async context => {
  const discord = new DiscordFixture()
  discord.revokeStatus = 503
  const { runtime } = createRuntime(context, discord)
  const response = await callback(runtime, await beginProbe(runtime))
  assert.equal(response.status, 502)
  const body = await response.json() as Record<string, unknown>
  assert.equal(body.cleanup, 'failed')
  assert.equal(body.gate, 'unverified')
})

test('authorization from another application fails verification and revokes the grant', async context => {
  const discord = new DiscordFixture()
  discord.application = '345678901234567890'
  const { runtime } = createRuntime(context, discord)
  const response = await callback(runtime, await beginProbe(runtime))
  assert.equal(response.status, 502)
  const body = await response.json() as Record<string, unknown>
  assert.deepEqual(body.failure, { operation: 'inspect', reason: 'invalid_authorization', status: 200 })
  assert.equal(body.cleanup, 'revoked')
})

test('Discord redirects are rejected rather than forwarding application credentials', async context => {
  const discord = new DiscordFixture()
  discord.redirectExchange = true
  const { runtime } = createRuntime(context, discord)
  const response = await callback(runtime, await beginProbe(runtime))
  assert.equal(response.status, 502)
  assert.deepEqual(discord.requests, ['exchange'])
})

for (const stage of ['exchange', 'refresh'] as const) {
  test(`recognizable tokens in malformed ${stage} responses are revoked`, async context => {
    const discord = new DiscordFixture()
    discord.malformedTokenStage = stage
    const { runtime } = createRuntime(context, discord)
    const response = await callback(runtime, await beginProbe(runtime))
    assert.equal(response.status, 502)
    const body = await response.json() as Record<string, unknown>
    assert.deepEqual(body.failure, { operation: stage, reason: 'invalid_token_response', status: 200 })
    assert.equal(body.cleanup, 'revoked')
    assert.equal(discord.requests.filter(operation => operation === 'revoke').length, 1)
    assert.equal(JSON.stringify(body).includes('refresh-token'), false)
  })
}
