import { CloudflareAuthorizationAttempts, type OAuthAttempt } from './cloudflare/oauth-attempt'
import { handleProbeRequest } from './probe/handler'
import type { ProbeSettings } from './probe/configuration'

export { OAuthAttempt } from './cloudflare/oauth-attempt'

export interface Env extends ProbeSettings {
  OAUTH_ATTEMPTS: DurableObjectNamespace<OAuthAttempt>
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleProbeRequest(request, env, {
      attempts: new CloudflareAuthorizationAttempts(env.OAUTH_ATTEMPTS),
    })
  },
} satisfies ExportedHandler<Env>
