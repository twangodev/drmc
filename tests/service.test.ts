import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { test, type TestContext } from 'node:test'
import { Miniflare, Response as RuntimeResponse, WebSocketPair, type Request as RuntimeRequest } from 'miniflare'

const origin = 'https://drmc.test'
const userId = '234567890123456789'
const applicationId = '123456789012345678'
const apiKey = 'b'.repeat(32)
const encryptionKey = 'd'.repeat(64)

class Providers {
  playing = true
  lastfmFailure = false
  lastfmSessionRevoked = false
  revocationFailure = false
  discordExpires = Date.now() + 7 * 24 * 3600_000
  activity: Record<string, unknown> | null = null
  publications: Record<string, unknown>[] = []
  connections = 0
  refreshed = 0
  revoked = 0
  polls = 0
  lastfmExchanges = 0
  sockets: InstanceType<typeof WebSocketPair>[0][] = []

  async respond(request: RuntimeRequest): Promise<RuntimeResponse> {
    const url = new URL(request.url)
    if (url.origin === 'https://gateway.discord.gg') {
      this.connections++
      const [client, server] = Object.values(new WebSocketPair())
      this.sockets.push(server)
      server.accept()
      server.addEventListener('message', event => {
        const frame = JSON.parse(event.data as string)
        if (frame.op === 2) {
          assert.match(frame.d.token, /^Bearer (initial|refreshed)-access-token$/)
          server.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { user: { id: userId } } }))
        } else if (frame.op === 1) server.send(JSON.stringify({ op: 11, d: null }))
        else if (frame.op === 3) {
          this.activity = frame.d.activities[0] ?? null
          if (this.activity) this.publications.push(this.activity)
        }
      })
      server.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }))
      return new RuntimeResponse(null, { status: 101, webSocket: client })
    }
    if (url.origin === 'https://ws.audioscrobbler.com') {
      const parameters = new URLSearchParams(await request.text())
      assert.equal(parameters.get('api_key'), apiKey)
      if (parameters.get('method') === 'auth.getSession') {
        this.lastfmExchanges++
        assert.equal(parameters.get('token'), 'CallbackToken_Z'.repeat(3))
        return RuntimeResponse.json({ session: { name: 'twangodev', key: 'SessionKey_Z'.repeat(3) } })
      }
      if (parameters.get('method') === 'user.getInfo') return RuntimeResponse.json(this.lastfmSessionRevoked ? { error: 9 } : { user: { name: 'twangodev' } }, { status: this.lastfmSessionRevoked ? 403 : 200 })
      this.polls++
      if (this.lastfmFailure) return RuntimeResponse.json({ error: 29, message: 'PRIVATE PROVIDER ERROR' })
      return RuntimeResponse.json({ recenttracks: { track: this.playing ? [{ name: 'Kid A', artist: { name: 'Radiohead' }, album: { '#text': 'Kid A' }, image: [{ '#text': 'https://lastfm.freetls.fastly.net/i/u/300x300/cover.png' }], '@attr': { nowplaying: 'true' } }] : [] } })
    }
    assert.equal(url.origin, 'https://discord.com')
    if (url.pathname.endsWith('/external-assets')) return RuntimeResponse.json([{ external_asset_path: 'external/artwork.png' }])
    if (url.pathname === '/api/v10/oauth2/@me') return RuntimeResponse.json({ application: { id: applicationId }, user: { id: userId }, scopes: ['identify', 'openid', 'sdk.social_layer_presence'], expires: new Date(this.discordExpires).toISOString() })
    const parameters = new URLSearchParams(await request.text())
    if (url.pathname.endsWith('/revoke')) {
      this.revoked++
      return new RuntimeResponse(null, { status: this.revocationFailure ? 503 : 200 })
    }
    assert.equal(url.pathname, '/api/oauth2/token')
    const refresh = parameters.get('grant_type') === 'refresh_token'
    if (refresh) { this.refreshed++; this.discordExpires = Date.now() + 7 * 24 * 3600_000 }
    else assert.equal(parameters.get('redirect_uri'), `${origin}/auth/discord/callback`)
    return RuntimeResponse.json({ access_token: `${refresh ? 'refreshed' : 'initial'}-access-token`, refresh_token: `${refresh ? 'refreshed' : 'initial'}-refresh-token`, token_type: 'Bearer' })
  }
}

function createRuntime(context: TestContext) {
  const providers = new Providers()
  const runtime = new Miniflare({ telemetry: { enabled: false }, cf: false, workers: [{ config: {
    name: 'drmc', compatibilityDate: '2026-10-05',
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: readFileSync('dist/index.js', 'utf8') } } },
    exports: { OAuthAttempt: { type: 'durable-object', storage: 'sqlite' }, MusicAccount: { type: 'durable-object', storage: 'sqlite' } },
    env: {
      OAUTH_ATTEMPTS: { type: 'durable-object', worker: 'drmc', exportName: 'OAuthAttempt' }, MUSIC_ACCOUNTS: { type: 'durable-object', worker: 'drmc', exportName: 'MusicAccount' },
      ...Object.fromEntries(Object.entries({ APP_ORIGIN: origin, SERVICE_ENABLED: 'true', DISCORD_CLIENT_ID: applicationId, DISCORD_CLIENT_SECRET: 'test-secret', LASTFM_API_KEY: apiKey, LASTFM_API_SECRET: 'e'.repeat(32), TOKEN_ENCRYPTION_KEY: encryptionKey }).map(([name, value]) => [name, { type: 'text', value }])),
    },
  }, dev: { outboundService: { type: 'fetcher', handler: (request: RuntimeRequest) => providers.respond(request) } } }] })
  context.after(async () => {
    for (const socket of providers.sockets) { try { socket.close(1000) } catch {} }
    await runtime.dispose()
  })
  return { runtime, providers }
}

function cookies(response: { headers: { getSetCookie(): string[] } }): string[] {
  return response.headers.getSetCookie().map(value => value.split(';')[0]!)
}
function post(runtime: Miniflare, path: string, browserCookies: string[] = []) {
  return runtime.dispatchFetch(origin + path, { method: 'POST', redirect: 'manual', headers: { Origin: origin, Cookie: browserCookies.join('; ') } })
}
async function signIn(runtime: Miniflare) {
  const start = await post(runtime, '/auth/discord/start')
  assert.equal(start.status, 303)
  const authorization = new URL(start.headers.get('Location')!)
  const callback = `${origin}/auth/discord/callback?state=${authorization.searchParams.get('state')}&code=test-code`
  const result = await runtime.dispatchFetch(callback, { redirect: 'manual', headers: { Cookie: cookies(start).join('; ') } })
  assert.equal(result.headers.get('Location'), '/app')
  assert.ok(result.headers.get('Set-Cookie')?.includes('HttpOnly'))
  return { cookies: cookies(result).filter(value => value.startsWith('drmc_session=')), callback, binding: cookies(start) }
}
async function linkLastfm(runtime: Miniflare, session: string[]) {
  const start = await post(runtime, '/auth/lastfm/start', session)
  const authorization = new URL(start.headers.get('Location')!)
  const callback = new URL(authorization.searchParams.get('cb')!)
  callback.searchParams.set('token', 'CallbackToken_Z'.repeat(3))
  const result = await runtime.dispatchFetch(callback.toString(), { redirect: 'manual', headers: { Cookie: [...session, ...cookies(start)].join('; ') } })
  assert.equal(result.headers.get('Location'), '/app')
}
async function account(runtime: Miniflare, session: string[]) {
  const response = await runtime.dispatchFetch(`${origin}/api/account`, { headers: { Cookie: session.join('; ') } })
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  return await response.json() as { account: { status: string; connected: boolean; track: unknown; enabled: boolean; lastfmUsername?: string } | null }
}
async function eventually(condition: () => boolean | Promise<boolean>, timeout = 6000) {
  const deadline = Date.now() + timeout
  while (!await condition()) { assert.ok(Date.now() < deadline, 'Account lifecycle did not reach expected state'); await delay(50) }
}

test('accounts link, publish from an alarm, pause, resume, logout without stopping music, and disconnect', async context => {
  const { runtime, providers } = createRuntime(context)
  const signedIn = await signIn(runtime)
  assert.equal((await account(runtime, signedIn.cookies)).account!.status, 'link_lastfm')
  await linkLastfm(runtime, signedIn.cookies)
  await eventually(() => providers.activity !== null)
  assert.equal(providers.activity!.details, 'Kid A')
  assert.equal(providers.activity!.state, 'by Radiohead')
  assert.equal((providers.activity!.assets as { large_image: string }).large_image, 'mp:external/artwork.png')
  assert.equal((await account(runtime, signedIn.cookies)).account!.lastfmUsername, 'twangodev')
  const publicResponse = JSON.stringify(await account(runtime, signedIn.cookies))
  assert.equal(/access-token|refresh-token|credentials|session|PRIVATE/.test(publicResponse), false)
  await post(runtime, '/api/account/pause', signedIn.cookies)
  await eventually(() => providers.activity === null)
  assert.equal((await account(runtime, signedIn.cookies)).account!.status, 'paused')
  await post(runtime, '/api/account/resume', signedIn.cookies)
  await eventually(() => providers.activity !== null)
  assert.equal(providers.connections, 2)
  await post(runtime, '/api/account/logout', signedIn.cookies)
  assert.equal((await account(runtime, signedIn.cookies)).account, null)
  assert.notEqual(providers.activity, null)
  const relogin = await signIn(runtime)
  await eventually(() => providers.activity !== null)
  await post(runtime, '/api/account/disconnect', relogin.cookies)
  assert.equal(providers.revoked, 1)
  assert.equal((await account(runtime, relogin.cookies)).account, null)
  await eventually(() => providers.activity === null)
})

test('browser authorization rejects cross-site mutations, state replay, altered cookies, and cross-provider callbacks', async context => {
  const { runtime } = createRuntime(context)
  const rejected = await runtime.dispatchFetch(origin + '/auth/discord/start', { method: 'POST', headers: { Origin: 'https://attacker.test' } })
  assert.equal(rejected.status, 403)
  const signedIn = await signIn(runtime)
  const replay = await runtime.dispatchFetch(signedIn.callback, { redirect: 'manual', headers: { Cookie: signedIn.binding.join('; ') } })
  assert.equal(replay.headers.get('Location'), '/app?error=invalid_authorization_state')
  assert.equal((await account(runtime, [signedIn.cookies[0]!.slice(0, -4) + 'AAAA'])).account, null)
  const start = await post(runtime, '/auth/lastfm/start', signedIn.cookies)
  const callback = new URL(new URL(start.headers.get('Location')!).searchParams.get('cb')!)
  callback.pathname = '/auth/discord/callback'
  callback.searchParams.set('code', 'test-code')
  const crossed = await runtime.dispatchFetch(callback.toString(), { redirect: 'manual', headers: { Cookie: [...signedIn.cookies, ...cookies(start)].join('; ') } })
  assert.equal(crossed.headers.get('Location'), '/app?error=invalid_authorization_state')
})

test('an expiring Discord grant refreshes before the persistent connection identifies', async context => {
  const { runtime, providers } = createRuntime(context)
  providers.discordExpires = Date.now() + 60_000
  const session = await signIn(runtime)
  await linkLastfm(runtime, session.cookies)
  await eventually(() => providers.activity !== null)
  assert.equal(providers.refreshed, 1)
  await post(runtime, '/api/account/pause', session.cookies)
})

test('temporary Last.fm failures preserve a recent track and a successful idle poll clears it', async context => {
  const { runtime, providers } = createRuntime(context)
  const session = await signIn(runtime)
  await linkLastfm(runtime, session.cookies)
  await eventually(() => providers.activity !== null)
  providers.lastfmFailure = true
  await eventually(() => providers.polls >= 2, 22_000)
  assert.notEqual(providers.activity, null)
  assert.equal((await account(runtime, session.cookies)).account!.status, 'reconnecting')
  providers.lastfmFailure = false
  providers.playing = false
  await eventually(() => providers.activity === null, 38_000)
  assert.equal((await account(runtime, session.cookies)).account!.status, 'idle')
})

test('failed Discord revocation retains a retryable cleanup record while invalidating the browser session', async context => {
  const { runtime, providers } = createRuntime(context)
  const session = await signIn(runtime)
  providers.revocationFailure = true
  await post(runtime, '/api/account/disconnect', session.cookies)
  assert.equal(providers.revoked, 1)
  assert.equal((await account(runtime, session.cookies)).account, null)
  providers.revocationFailure = false
  await eventually(() => providers.revoked === 2, 70_000)
})


test('a disconnected music object restores its connection and track timestamp after eviction', async context => {
  const { runtime, providers } = createRuntime(context)
  const session = await signIn(runtime)
  await linkLastfm(runtime, session.cookies)
  await eventually(() => providers.activity !== null)
  const startedAt = (providers.activity!.timestamps as { start: number }).start
  providers.sockets[0]!.close(1000)
  await eventually(async () => !(await account(runtime, session.cookies)).account!.connected)
  await runtime.unsafeEvictDurableObject('drmc', 'MusicAccount', { name: userId, webSockets: 'close' })
  await eventually(() => providers.connections >= 2, 23_000)
  await eventually(() => providers.publications.length >= 2)
  assert.equal((providers.activity!.timestamps as { start: number }).start, startedAt)
  await post(runtime, '/api/account/pause', session.cookies)
})

test('revoked Last.fm authorization stops sharing and asks to reconnect Last.fm', async context => {
  const { runtime, providers } = createRuntime(context)
  providers.lastfmSessionRevoked = true
  const session = await signIn(runtime)
  await linkLastfm(runtime, session.cookies)
  await eventually(async () => (await account(runtime, session.cookies)).account!.status === 'lastfm_reauthorize')
  assert.equal(providers.activity, null)
  assert.equal(providers.connections, 0)
  await post(runtime, '/api/account/pause', session.cookies)
})

test('incomplete Last.fm callbacks are distinguished from explicit cancellation without exchanging a grant', async context => {
  const { runtime, providers } = createRuntime(context)
  const session = await signIn(runtime)
  for (const [token, providerError, expected] of [
    [null, null, 'lastfm_authorization_incomplete'],
    ['', null, 'lastfm_authorization_incomplete'],
    ['invalid token', null, 'lastfm_authorization_incomplete'],
    ['Z'.repeat(1025), null, 'lastfm_authorization_incomplete'],
    [null, 'access_denied', 'lastfm_authorization_denied'],
    [null, 'invalid_request', 'lastfm_authorization_failed'],
  ]) {
    const start = await post(runtime, '/auth/lastfm/start', session.cookies)
    const callback = new URL(new URL(start.headers.get('Location')!).searchParams.get('cb')!)
    if (token !== null) callback.searchParams.set('token', token!)
    if (providerError !== null) callback.searchParams.set('error', providerError!)
    const response = await runtime.dispatchFetch(callback.toString(), { redirect: 'manual', headers: { Cookie: [...session.cookies, ...cookies(start)].join('; ') } })
    assert.equal(response.headers.get('Location'), `/app?error=${expected}`)
  }
  assert.equal(providers.lastfmExchanges, 0)
  assert.equal((await account(runtime, session.cookies)).account!.status, 'link_lastfm')
})
