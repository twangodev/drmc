import { CloudflareAuthorizationAttempts, type OAuthAttempt } from './cloudflare/oauth-attempt'
import type { ServiceSettings } from '../src/lib/server/accounts/configuration'
import { handleServiceRequest } from './application'
import type { MusicAccount } from './cloudflare/music-account'
import type { StatisticsSettings } from './cloudflare/community-statistics'
import { handleStatisticsRequest } from './statistics'

export { CommunityStatistics } from './cloudflare/community-statistics'

export { MusicAccount } from './cloudflare/music-account'

export { OAuthAttempt } from './cloudflare/oauth-attempt'

export interface Env extends ServiceSettings, StatisticsSettings {
  MUSIC_ACCOUNTS: DurableObjectNamespace<MusicAccount>
  ASSETS: Fetcher
  OAUTH_ATTEMPTS: DurableObjectNamespace<OAuthAttempt>
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/api/stats') return handleStatisticsRequest(request, env)
    if (path.startsWith('/auth/') || path.startsWith('/api/account')) {
      return handleServiceRequest(request, env, { attempts: new CloudflareAuthorizationAttempts(env.OAUTH_ATTEMPTS), accounts: env.MUSIC_ACCOUNTS })
    }
    if (path === '/health' || path.startsWith('/api/')) {
      const response = path === '/health' && request.method === 'GET'
        ? Response.json({ status: 'ok' })
        : Response.json({ error: 'not_found' }, { status: 404 })
      response.headers.set('Cache-Control', 'no-store')
      response.headers.set('Referrer-Policy', 'no-referrer')
      response.headers.set('X-Content-Type-Options', 'nosniff')
      response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
      return Promise.resolve(response)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
