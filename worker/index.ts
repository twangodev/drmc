import { CloudflareAuthorizationAttempts, type OAuthAttempt } from './cloudflare/oauth-attempt'
import { handleProbeRequest } from '../src/lib/server/probe/handler'
import type { ProbeSettings } from '../src/lib/server/probe/configuration'
import { DiscordGatewayPresence } from '../src/lib/server/discord/gateway'
import { connectDiscordGateway } from './cloudflare/discord-gateway'

export { OAuthAttempt } from './cloudflare/oauth-attempt'

export interface Env extends ProbeSettings {
  ASSETS: Fetcher
  OAUTH_ATTEMPTS: DurableObjectNamespace<OAuthAttempt>
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    if (!['/health', '/probe/start', '/probe/callback'].includes(path) && !path.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }
    return handleProbeRequest(request, env, {
      attempts: new CloudflareAuthorizationAttempts(env.OAUTH_ATTEMPTS),
      presence: new DiscordGatewayPresence(connectDiscordGateway),
    })
  },
} satisfies ExportedHandler<Env>
