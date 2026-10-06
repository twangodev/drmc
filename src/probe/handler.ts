import { DiscordOAuthClient } from '../discord/oauth'
import {
  authorizationLifetimeMs,
  hashToken,
  isAuthorizationToken,
  randomToken,
  type AuthorizationAttemptStore,
} from '../oauth/attempts'
import {
  InvalidProbeConfiguration,
  readProbeConfiguration,
  type ProbeConfiguration,
  type ProbeSettings,
} from './configuration'
import { inspectDiscordAccess } from './report'

export interface ProbeDependencies {
  attempts: AuthorizationAttemptStore
  request?: typeof fetch
  now?: () => number
}

class ProbeRequestFailure extends Error {
  constructor(readonly status: number, readonly reason: string) {
    super(reason)
  }
}

export async function handleProbeRequest(
  request: Request,
  settings: ProbeSettings,
  dependencies: ProbeDependencies,
): Promise<Response> {
  const url = new URL(request.url)
  let response: Response
  try {
    if (url.pathname === '/health' && request.method === 'GET') {
      response = Response.json({ status: 'ok', feasibility: 'unverified' })
    } else if (['/', '/probe'].includes(url.pathname) && request.method === 'GET') {
      response = probePage(settings.PROBE_ENABLED === 'true')
    } else if (url.pathname === '/probe/start' && request.method === 'POST') {
      response = await startProbe(request, requireEnabledProbe(settings), dependencies)
    } else if (url.pathname === '/probe/callback' && request.method === 'GET') {
      response = await completeProbe(request, requireEnabledProbe(settings), dependencies)
    } else {
      response = Response.json({ error: 'not_found' }, { status: 404 })
    }
  } catch (error) {
    if (error instanceof ProbeRequestFailure) {
      response = Response.json({ error: error.reason }, { status: error.status })
    } else if (error instanceof InvalidProbeConfiguration) {
      response = Response.json({ error: 'probe_not_configured', fields: error.fields }, { status: 503 })
    } else {
      response = Response.json({ error: 'probe_unavailable' }, { status: 503 })
    }
  }
  if (url.pathname === '/probe/callback') {
    response.headers.set('Set-Cookie', browserCookie('', 0, url.protocol === 'https:'))
  }
  return protectResponse(response)
}

function requireEnabledProbe(settings: ProbeSettings): ProbeConfiguration {
  if (settings.PROBE_ENABLED !== 'true') throw new ProbeRequestFailure(404, 'probe_disabled')
  return readProbeConfiguration(settings)
}

async function startProbe(
  request: Request,
  configuration: ProbeConfiguration,
  dependencies: ProbeDependencies,
): Promise<Response> {
  requireCanonicalOrigin(request, configuration.origin)
  if (request.headers.get('Origin') !== configuration.origin) throw new ProbeRequestFailure(403, 'invalid_origin')
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded') {
    throw new ProbeRequestFailure(415, 'invalid_content_type')
  }
  const form = new URLSearchParams(await limitedRequestText(request, 4096))
  const suppliedKey = form.get('access_key') ?? ''
  if (!(await secretMatches(suppliedKey, configuration.accessKey))) throw new ProbeRequestFailure(403, 'invalid_access_key')

  const state = randomToken()
  const browserBinding = randomToken()
  const now = dependencies.now?.() ?? Date.now()
  await dependencies.attempts.create(state, {
    browserBindingHash: await hashToken(browserBinding),
    expiresAt: now + authorizationLifetimeMs,
  })
  const client = new DiscordOAuthClient(configuration.application, dependencies.request)
  return new Response(null, {
    status: 303,
    headers: {
      Location: client.authorizationUrl(state),
      'Set-Cookie': browserCookie(browserBinding, authorizationLifetimeMs / 1000, configuration.origin.startsWith('https:')),
    },
  })
}

async function completeProbe(
  request: Request,
  configuration: ProbeConfiguration,
  dependencies: ProbeDependencies,
): Promise<Response> {
  requireCanonicalOrigin(request, configuration.origin)
  const parameters = new URL(request.url).searchParams
  const state = parameters.get('state')
  const browserBinding = readBrowserBinding(request)
  if (!isAuthorizationToken(state) || !isAuthorizationToken(browserBinding)) {
    throw new ProbeRequestFailure(400, 'invalid_authorization_state')
  }
  const consumed = await dependencies.attempts.consume(
    state,
    await hashToken(browserBinding),
    dependencies.now?.() ?? Date.now(),
  )
  if (!consumed) throw new ProbeRequestFailure(400, 'invalid_authorization_state')
  if (parameters.has('error')) throw new ProbeRequestFailure(400, 'authorization_denied')
  const code = parameters.get('code')
  if (!code || code.length > 4096) throw new ProbeRequestFailure(400, 'invalid_authorization_code')

  const report = await inspectDiscordAccess(
    new DiscordOAuthClient(configuration.application, dependencies.request),
    code,
    configuration.allowedUsers,
  )
  return Response.json(report, {
    status: report.cleanup === 'failed' ? 502 : report.failure?.operation === 'admission' ? 403 : report.oauth === 'verified' ? 200 : 502,
  })
}

function requireCanonicalOrigin(request: Request, origin: string): void {
  if (new URL(request.url).origin !== origin) throw new ProbeRequestFailure(403, 'invalid_origin')
}

function readBrowserBinding(request: Request): string | null {
  const cookies = (request.headers.get('Cookie') ?? '').split(';').map(cookie => cookie.trim())
  const binding = cookies.find(cookie => cookie.startsWith('drmc_probe='))
  return binding?.slice('drmc_probe='.length) ?? null
}

function browserCookie(value: string, maxAge: number, secure: boolean): string {
  return `drmc_probe=${value}; Path=/probe; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

async function secretMatches(supplied: string, expected: string): Promise<boolean> {
  const [suppliedHash, expectedHash] = await Promise.all([hashToken(supplied), hashToken(expected)])
  let difference = 0
  for (let index = 0; index < expectedHash.length; index++) {
    difference |= suppliedHash.charCodeAt(index) ^ expectedHash.charCodeAt(index)
  }
  return difference === 0
}

async function limitedRequestText(request: Request, maximumBytes: number): Promise<string> {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > maximumBytes) {
      await reader.cancel()
      throw new ProbeRequestFailure(413, 'request_too_large')
    }
    chunks.push(chunk.value)
  }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return new TextDecoder().decode(body)
}

function protectResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
  return response
}

function probePage(enabled: boolean): Response {
  return new Response(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DRMC Discord feasibility probe</title>
<h1>Discord access probe</h1>
<p>This development probe checks OAuth scope access, token refresh, and revocation.
Presence publishing remains unverified.</p>
<p>It requests Discord identity and Social SDK presence access. The presence scope
also covers social features; review Discord's consent screen before authorizing.</p>
${enabled ? `<form action="/probe/start" method="post">
<label>Operator access key <input name="access_key" type="password" required autocomplete="off"></label>
<button type="submit">Check Discord access</button>
</form>` : '<p>The operator has disabled the probe.</p>'}
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
