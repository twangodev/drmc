import { CredentialVault } from '../src/lib/server/accounts/credentials'
import { requireServiceConfiguration, type ServiceSettings } from '../src/lib/server/accounts/configuration'
import { DiscordOAuthClient, discordPresenceScopes, type DiscordTokens } from '../src/lib/server/discord/oauth'
import { LastfmClient, isLastfmCredential } from '../src/lib/server/lastfm/client'
import { randomToken, hashToken, isAuthorizationToken, authorizationLifetimeMs, type AuthorizationAttempt, type AuthorizationAttemptStore } from '../src/lib/server/oauth/attempts'
import type { MusicAccount } from './cloudflare/music-account'
import { readBrowserSession, readCookie, cookie, browserSessionLifetimeSeconds, type BrowserSession } from './browser-session'
import { InvalidMusicPreferences, readMusicPreferences } from '../src/lib/music-preferences'

interface ServiceDependencies {
  attempts: AuthorizationAttemptStore
  accounts: DurableObjectNamespace<MusicAccount>
}

class BrowserRequestFailure extends Error {
  readonly status: number
  constructor(status: number, reason: string) { super(reason); this.status = status }
}

export async function handleServiceRequest(request: Request, settings: ServiceSettings, dependencies: ServiceDependencies): Promise<Response> {
  const url = new URL(request.url)
  let response: Response
  try {
    if (settings.SERVICE_ENABLED !== 'true') {
      response = url.pathname === '/api/account' && request.method === 'GET' ? Response.json({ enabled: false, account: null }) : Response.json({ error: 'service_disabled' }, { status: 503 })
    } else {
      const configuration = requireServiceConfiguration(settings)
      if (url.origin !== configuration.origin) throw new BrowserRequestFailure(403, 'invalid_origin')
      if (request.method === 'POST' && request.headers.get('Origin') !== configuration.origin) throw new BrowserRequestFailure(403, 'invalid_origin')
      const vault = new CredentialVault(configuration.encryptionKey)
      const session = await readBrowserSession(request, vault)
      const actor = (userId: string) => dependencies.accounts.get(dependencies.accounts.idFromName(userId))
      const account = session ? await actor(session.userId).view(session.nonce) : null
      if (url.pathname === '/api/account' && request.method === 'GET') {
        response = Response.json({ enabled: true, account }, { status: account ? 200 : 401 })
      } else if (url.pathname === '/auth/discord/start' && request.method === 'POST') {
        const state = randomToken()
        const binding = randomToken()
        await dependencies.attempts.create(state, { purpose: 'discord_link', browserBindingHash: await hashToken(binding), expiresAt: Date.now() + authorizationLifetimeMs })
        response = redirect(new DiscordOAuthClient(configuration.discord).authorizationUrl(state))
        response.headers.append('Set-Cookie', cookie('drmc_auth', binding, authorizationLifetimeMs / 1000, configuration.origin, '/auth'))
      } else if (url.pathname === '/auth/discord/callback' && request.method === 'GET') {
        await consumeAttempt(request, dependencies.attempts, 'discord_link')
        if (url.searchParams.has('error')) throw new BrowserRequestFailure(400, 'discord_authorization_denied')
        const code = url.searchParams.get('code')
        if (!code || code.length > 4096) throw new BrowserRequestFailure(400, 'invalid_authorization_code')
        const client = new DiscordOAuthClient(configuration.discord)
        let tokens: DiscordTokens | undefined
        try {
          tokens = await client.exchange(code)
          const authorization = await client.inspect(tokens.accessToken)
          if (!discordPresenceScopes.every(scope => authorization.scopes.includes(scope))) throw new BrowserRequestFailure(403, 'discord_presence_scope_missing')
          const nonce = await actor(authorization.userId).linkDiscord(authorization, tokens)
          const claims: BrowserSession = { userId: authorization.userId, nonce, expiresAt: Date.now() + browserSessionLifetimeSeconds * 1000 }
          response = redirect('/app')
          response.headers.append('Set-Cookie', cookie('drmc_session', await vault.seal(claims, 'browser-session'), browserSessionLifetimeSeconds, configuration.origin))
        } catch (error) {
          if (tokens) { try { await client.revoke(tokens.refreshToken) } catch {} }
          throw error
        }
      } else if (url.pathname === '/auth/lastfm/start' && request.method === 'POST') {
        if (!session || !account) throw new BrowserRequestFailure(401, 'sign_in_required')
        const state = randomToken()
        const binding = randomToken()
        await dependencies.attempts.create(state, { purpose: 'lastfm_link', userId: session.userId, session: session.nonce, browserBindingHash: await hashToken(binding), expiresAt: Date.now() + authorizationLifetimeMs })
        const callback = `${configuration.origin}/auth/lastfm/callback?state=${state}`
        response = redirect(new LastfmClient(configuration.lastfm.key, configuration.lastfm.secret).authorizationUrl(callback))
        response.headers.append('Set-Cookie', cookie('drmc_auth', binding, authorizationLifetimeMs / 1000, configuration.origin, '/auth'))
      } else if (url.pathname === '/auth/lastfm/callback' && request.method === 'GET') {
        const attempt = await consumeAttempt(request, dependencies.attempts, 'lastfm_link')
        if (!session || !account || attempt.userId !== session.userId || attempt.session !== session.nonce) throw new BrowserRequestFailure(401, 'sign_in_required')
        if (url.searchParams.has('error')) {
          throw new BrowserRequestFailure(400, url.searchParams.get('error') === 'access_denied' ? 'lastfm_authorization_denied' : 'lastfm_authorization_failed')
        }
        const token = url.searchParams.get('token')
        if (!isLastfmCredential(token)) throw new BrowserRequestFailure(400, 'lastfm_authorization_incomplete')
        const lastfm = await new LastfmClient(configuration.lastfm.key, configuration.lastfm.secret).exchange(token)
        await actor(session.userId).linkLastfm(session.nonce, lastfm)
        response = redirect('/app')
      } else if (request.method === 'POST' && url.pathname === '/api/account/preferences') {
        if (!session || !account) throw new BrowserRequestFailure(401, 'sign_in_required')
        const body = await request.text()
        if (body.length > 2048) throw new BrowserRequestFailure(400, 'invalid_music_preferences')
        await actor(session.userId).updatePreferences(session.nonce, readMusicPreferences(new URLSearchParams(body)))
        response = redirect('/app?saved=preferences')
      } else if (request.method === 'POST' && /^\/api\/account\/(pause|resume|disconnect|logout)$/.test(url.pathname)) {
        if (!session || !account) throw new BrowserRequestFailure(401, 'sign_in_required')
        const action = url.pathname.split('/').at(-1)! as 'pause' | 'resume' | 'disconnect' | 'logout'
        const result = await actor(session.userId).control(session.nonce, action)
        response = redirect(result?.status === 'cleanup_pending' ? '/app?error=discord_cleanup_pending' : '/app')
        if (action === 'disconnect' || action === 'logout') response.headers.append('Set-Cookie', cookie('drmc_session', '', 0, configuration.origin))
      } else response = Response.json({ error: 'not_found' }, { status: 404 })
    }
  } catch (error) {
    const reason = error instanceof BrowserRequestFailure ? error.message : error instanceof InvalidMusicPreferences ? error.message : url.pathname.startsWith('/auth/lastfm/') ? 'lastfm_authorization_failed' : url.pathname.startsWith('/auth/discord/') ? 'discord_authorization_failed' : 'service_unavailable'
    response = url.pathname.endsWith('/callback') || url.pathname === '/api/account/preferences' ? redirect(`/app?error=${reason}`) : Response.json({ error: reason }, { status: error instanceof BrowserRequestFailure ? error.status : 503 })
  }
  if (url.pathname.endsWith('/callback')) response.headers.append('Set-Cookie', cookie('drmc_auth', '', 0, url.origin, '/auth'))
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
  return response
}

async function consumeAttempt(request: Request, attempts: AuthorizationAttemptStore, purpose: AuthorizationAttempt['purpose']): Promise<AuthorizationAttempt> {
  const state = new URL(request.url).searchParams.get('state')
  const binding = readCookie(request, 'drmc_auth')
  if (!isAuthorizationToken(state) || !isAuthorizationToken(binding)) throw new BrowserRequestFailure(400, 'invalid_authorization_state')
  const attempt = await attempts.consume(state, await hashToken(binding), Date.now())
  if (!attempt || attempt.purpose !== purpose) throw new BrowserRequestFailure(400, 'invalid_authorization_state')
  return attempt
}

function redirect(location: string): Response { return new Response(null, { status: 303, headers: { Location: location } }) }
