import { CloudflareAuthorizationAttempts, type OAuthAttempt } from './cloudflare/oauth-attempt'
import { handleProbeRequest } from '../src/lib/server/probe/handler'
import type { ServiceSettings } from '../src/lib/server/accounts/configuration'
import { handleServiceRequest } from './application'
import type { MusicAccount } from './cloudflare/music-account'
import { DiscordGatewayPresence } from '../src/lib/server/discord/gateway'
import { connectDiscordGateway } from './cloudflare/discord-gateway'
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
    if (!['/health', '/probe/start', '/probe/callback'].includes(path) && !path.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }
    return handleProbeRequest(request, env, {
      attempts: new CloudflareAuthorizationAttempts(env.OAUTH_ATTEMPTS),
      presence: new DiscordGatewayPresence(connectDiscordGateway),
    })
  },
} satisfies ExportedHandler<Env>
