import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DiscordOAuthClient, describeDiscordFailure } from '../src/lib/server/discord/oauth.ts'

const origin = 'https://drmc.test'
const applicationId = '123456789012345678'
const allowedUserId = '234567890123456789'
const grantedScopes = ['identify', 'openid', 'sdk.social_layer_presence']

class DiscordFixture {
  client() {
    return new DiscordOAuthClient({ clientId: applicationId, clientSecret: 'test-client-secret', redirectUri: `${origin}/auth/discord/callback` }, async (url, init) => {
      assert.equal(init?.redirect, 'manual')
      return this.respond(new Request(url, init))
    })
  }
  exchangeStatus = 200
  refreshStatus = 200
  revokeStatus = 200
  revokeError = 'private-provider-error'
  redirectRevoke = false
  userId = allowedUserId
  application = applicationId
  redirectExchange = false
  malformedTokenStage: 'exchange' | 'refresh' | null = null
  requests: string[] = []
  revokeRateLimits: { body: Record<string, unknown> | string; headers?: Record<string, string> }[] = []
  revocationsAt: number[] = []
  scopes = grantedScopes

  async respond(request: Request): Promise<Response> {
    const url = new URL(request.url)
    assert.equal(url.origin, 'https://discord.com')
    assert.equal(request.headers.get('User-Agent'), 'DiscordBot (https://github.com/twangodev/drmc, 1.0.0)')
    if (url.pathname === '/api/v10/oauth2/@me') {
      this.requests.push('inspect')
      assert.match(request.headers.get('Authorization') ?? '', /^Bearer (initial|refreshed)-access-token$/)
      return Response.json({
        application: { id: this.application },
        scopes: this.scopes,
        expires: '2026-10-20T00:00:00Z',
        user: { id: this.userId },
      })
    }

    assert.equal(request.method, 'POST')
    assert.equal(request.headers.get('Content-Type'), 'application/x-www-form-urlencoded;charset=UTF-8')
    const parameters = new URLSearchParams(await request.text())
    if (url.pathname === '/api/v10/oauth2/token/revoke') {
      this.requests.push('revoke')
      this.revocationsAt.push(Date.now())
      assert.equal(request.headers.get('Authorization'), `Basic ${btoa(`${applicationId}:test-client-secret`)}`)
      assert.equal(parameters.get('client_id'), null)
      assert.equal(parameters.get('client_secret'), null)
      assert.match(parameters.get('token') ?? '', /^(initial|refreshed)-refresh-token$/)
      assert.equal(parameters.get('token_type_hint'), null)
      const rateLimit = this.revokeRateLimits.shift()
      if (rateLimit) {
        const init = { status: 429, headers: rateLimit.headers }
        return typeof rateLimit.body === 'string'
          ? new Response(rateLimit.body, init)
          : Response.json(rateLimit.body, init)
      }
      if (this.redirectRevoke) {
        return new Response(null, { status: 302, headers: { Location: 'https://unexpected.test' } })
      }
      if (this.revokeStatus >= 400) {
        return Response.json({ error: this.revokeError, error_description: 'PRIVATE REVOCATION DESCRIPTION', token: 'private-provider-token' }, { status: this.revokeStatus })
      }
      return new Response(null, { status: this.revokeStatus })
    }

    assert.equal(url.pathname, '/api/oauth2/token')
    assert.equal(parameters.get('client_id'), applicationId)
    assert.equal(parameters.get('client_secret'), 'test-client-secret')
    const refreshing = parameters.get('grant_type') === 'refresh_token'
    this.requests.push(refreshing ? 'refresh' : 'exchange')
    if (refreshing) {
      assert.equal(parameters.get('refresh_token'), 'initial-refresh-token')
    } else {
      assert.equal(parameters.get('code'), 'test-code')
      assert.equal(parameters.get('redirect_uri'), `${origin}/auth/discord/callback`)
    }
    if (this.redirectExchange && !refreshing) {
      return new Response(null, { status: 302, headers: { Location: 'https://unexpected.test' } })
    }
    const status = refreshing ? this.refreshStatus : this.exchangeStatus
    if (status !== 200) {
      return Response.json({ error: 'invalid_scope', error_description: 'DO NOT EXPOSE PROVIDER BODY' }, { status })
    }
    const prefix = refreshing ? 'refreshed' : 'initial'
    return Response.json({
      access_token: `${prefix}-access-token`,
      refresh_token: `${prefix}-refresh-token`,
      token_type: this.malformedTokenStage === (refreshing ? 'refresh' : 'exchange') ? 'unexpected' : 'Bearer',
      expires_in: 604800,
      scope: grantedScopes.join(' '),
    })
  }

}

test('Discord OAuth requests the presence scopes and exchanges, inspects, refreshes and revokes grants', async () => {
  const fixture = new DiscordFixture()
  const client = fixture.client()
  const authorization = new URL(client.authorizationUrl('test-state'))
  assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/auth/discord/callback`)
  assert.equal(authorization.searchParams.get('scope'), grantedScopes.join(' '))
  assert.equal(authorization.searchParams.get('state'), 'test-state')
  const initial = await client.exchange('test-code')
  const inspected = await client.inspect(initial.accessToken)
  assert.deepEqual(inspected, { applicationId, userId: allowedUserId, scopes: grantedScopes, expiresAt: '2026-10-20T00:00:00Z' })
  const refreshed = await client.refresh(initial.refreshToken)
  await client.inspect(refreshed.accessToken)
  await client.revoke(refreshed.refreshToken)
  assert.deepEqual(fixture.requests, ['exchange', 'inspect', 'refresh', 'inspect', 'revoke'])
})

test('authorization from another application fails inspection', async () => {
  const fixture = new DiscordFixture()
  fixture.application = '345678901234567890'
  await assert.rejects(fixture.client().inspect('initial-access-token'), { operation: 'inspect', reason: 'invalid_authorization', status: 200 })
})

for (const stage of ['exchange', 'refresh'] as const) {
  test(`recognizable tokens in malformed ${stage} responses are revoked`, async () => {
    const fixture = new DiscordFixture()
    fixture.malformedTokenStage = stage
    await assert.rejects(fixture.client()[stage](stage === 'exchange' ? 'test-code' : 'initial-refresh-token'), { operation: stage, reason: 'invalid_token_response', status: 200, cleanup: { status: 'revoked' } })
    assert.deepEqual(fixture.requests, [stage, 'revoke'])
  })

  test(`failed cleanup of a malformed ${stage} retains both sanitized failures`, async () => {
    const fixture = new DiscordFixture()
    fixture.malformedTokenStage = stage
    fixture.revokeStatus = 401
    fixture.revokeError = 'invalid_client'
    await assert.rejects(fixture.client()[stage](stage === 'exchange' ? 'test-code' : 'initial-refresh-token'), { reason: 'invalid_token_response', cleanup: { status: 'failed', failure: { reason: 'invalid_client', status: 401 } } })
  })
}

test('scope rejection exposes only a recognized diagnostic', async () => {
  const fixture = new DiscordFixture()
  fixture.exchangeStatus = 400
  await assert.rejects(fixture.client().exchange('test-code'), { operation: 'exchange', reason: 'invalid_scope', status: 400 })
})

for (const [name, rateLimit, minimumWait] of [
  ['header', { headers: { 'Retry-After': '0.02' }, body: {} }, 20],
  ['body', { body: { retry_after: 0.01 } }, 10],
  ['conflicting delays', { headers: { 'Retry-After': '0.02' }, body: { retry_after: 0.01 } }, 20],
] as const) {
  test(`revocation honors the ${name} wait before one successful retry`, async () => {
    const fixture = new DiscordFixture()
    fixture.revokeRateLimits = [rateLimit]
    await fixture.client().revoke('initial-refresh-token')
    assert.equal(fixture.revocationsAt.length, 2)
    assert.ok(fixture.revocationsAt[1]! - fixture.revocationsAt[0]! >= minimumWait)
  })
}

test('a repeated revocation rate limit stops after one retry and retains the latest wait', async () => {
  const fixture = new DiscordFixture()
  fixture.revokeRateLimits = [
    { body: { retry_after: 0.001 } },
    { body: { retry_after: 60, global: false }, headers: { 'X-RateLimit-Scope': 'shared' } },
  ]
  await assert.rejects(fixture.client().revoke('initial-refresh-token'), { reason: 'rate_limited', status: 429, rateLimit: { responseFormat: 'json', retryAfterSeconds: 60, scope: 'shared', global: false } })
  assert.equal(fixture.revocationsAt.length, 2)
})

test('long waits are reported without retrying or exposing arbitrary response fields', async () => {
  const fixture = new DiscordFixture()
  fixture.revokeRateLimits = [{ headers: { 'Retry-After': '65', 'X-RateLimit-Scope': 'global', 'X-RateLimit-Global': 'true' }, body: { retry_after: 64.57, message: 'PRIVATE RATE LIMIT MESSAGE', token: 'private-provider-token' } }]
  await assert.rejects(fixture.client().revoke('initial-refresh-token'), error => {
    assert.deepEqual(describeDiscordFailure(error), { reason: 'rate_limited', status: 429, rateLimit: { responseFormat: 'json', retryAfterSeconds: 65, scope: 'global', global: true } })
    return true
  })
  assert.equal(fixture.revocationsAt.length, 1)
})

test('non-JSON rate limits do not invent a retry interval or expose provider bodies', async () => {
  const fixture = new DiscordFixture()
  fixture.revokeRateLimits = [{ body: '<html>PRIVATE UPSTREAM BLOCK</html>' }]
  await assert.rejects(fixture.client().revoke('initial-refresh-token'), { reason: 'rate_limited', status: 429, rateLimit: { responseFormat: 'other' } })
  assert.equal(fixture.revocationsAt.length, 1)
})

for (const retryAfter of [-1, '0.001', null, 'private-provider-token']) {
  test(`invalid retry delay ${retryAfter} never triggers a retry or leaks metadata`, async () => {
    const fixture = new DiscordFixture()
    fixture.revokeRateLimits = [{ headers: { 'Retry-After': '-1', 'X-RateLimit-Scope': 'private-provider-token' }, body: { retry_after: retryAfter, global: 'private-provider-token' } }]
    await assert.rejects(fixture.client().revoke('initial-refresh-token'), { reason: 'rate_limited', status: 429, rateLimit: { responseFormat: 'json' } })
    assert.equal(fixture.revocationsAt.length, 1)
  })
}

test('Discord redirects never forward grants or application credentials', async () => {
  const fixture = new DiscordFixture()
  fixture.redirectExchange = true
  fixture.redirectRevoke = true
  await assert.rejects(fixture.client().exchange('test-code'), { operation: 'exchange', reason: 'upstream_error', status: 302 })
  await assert.rejects(fixture.client().revoke('initial-refresh-token'), { operation: 'revoke', reason: 'upstream_error', status: 302 })
  assert.deepEqual(fixture.requests, ['exchange', 'revoke'])
})

test('revocation errors remain sanitized and an empty successful body completes cleanup', async () => {
  const fixture = new DiscordFixture()
  fixture.revokeStatus = 503
  await assert.rejects(fixture.client().revoke('initial-refresh-token'), { reason: 'upstream_error', status: 503 })
  fixture.revokeStatus = 204
  await fixture.client().revoke('initial-refresh-token')
})
