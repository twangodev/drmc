import { readProbeConfiguration } from '../src/lib/server/probe/configuration.ts'
import { requireServiceConfiguration, type ServiceSettings } from '../src/lib/server/accounts/configuration.ts'

export interface DeploymentConfiguration {
  origin: string
  variables: Record<string, string>
  secrets: Record<string, string>
}

export async function resolveDeploymentOrigin(
  settings: { APP_ORIGIN?: string; CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string },
  workerName: string,
  request: typeof fetch = fetch,
): Promise<string> {
  if (settings.APP_ORIGIN) return deploymentOrigin(settings.APP_ORIGIN)
  if (!/^[a-f0-9]{32}$/.test(settings.CLOUDFLARE_ACCOUNT_ID ?? '')) throw new Error('CLOUDFLARE_ACCOUNT_ID is required')
  if (!settings.CLOUDFLARE_API_TOKEN) throw new Error('Set APP_ORIGIN or provide CLOUDFLARE_API_TOKEN to discover the workers.dev address')
  const response = await request(`https://api.cloudflare.com/client/v4/accounts/${settings.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${settings.CLOUDFLARE_API_TOKEN}` },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Workers subdomain lookup failed with HTTP ${response.status}`)
  const result = await response.json() as { success?: boolean; result?: { subdomain?: string } }
  const subdomain = result.result?.subdomain
  const hostnameLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
  if (result.success !== true || !subdomain || !hostnameLabel.test(subdomain) || !hostnameLabel.test(workerName)) {
    throw new Error('Configure a workers.dev subdomain in Cloudflare or set APP_ORIGIN explicitly')
  }
  return `https://${workerName}.${subdomain}.workers.dev`
}

export function readDeploymentConfiguration(settings: ServiceSettings): DeploymentConfiguration {
  const origin = deploymentOrigin(settings.APP_ORIGIN)
  const enabled = settings.PROBE_ENABLED ?? 'false'
  if (!['true', 'false'].includes(enabled)) throw new Error('PROBE_ENABLED must be true or false')
  const serviceEnabled = settings.SERVICE_ENABLED ?? 'false'
  if (!['true', 'false'].includes(serviceEnabled)) throw new Error('SERVICE_ENABLED must be true or false')
  const variables = {
    SERVICE_ENABLED: serviceEnabled,
    APP_ORIGIN: origin,
    PROBE_ENABLED: enabled,
    DISCORD_CLIENT_ID: settings.DISCORD_CLIENT_ID ?? '',
    PROBE_ALLOWED_DISCORD_IDS: settings.PROBE_ALLOWED_DISCORD_IDS ?? '',
  }
  const secrets = Object.fromEntries(
    Object.entries({ DISCORD_CLIENT_SECRET: settings.DISCORD_CLIENT_SECRET, PROBE_ACCESS_KEY: settings.PROBE_ACCESS_KEY, LASTFM_API_KEY: settings.LASTFM_API_KEY, LASTFM_API_SECRET: settings.LASTFM_API_SECRET, TOKEN_ENCRYPTION_KEY: settings.TOKEN_ENCRYPTION_KEY })
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  )
  if (serviceEnabled === 'true') requireServiceConfiguration({ ...variables, ...secrets })
  if (enabled === 'true') readProbeConfiguration({ ...variables, ...secrets })
  return { origin, variables, secrets }
}

export function deploymentOrigin(value: string | undefined): string {
  try {
    const url = new URL(value ?? '')
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/') {
      return url.origin
    }
  } catch {}
  throw new Error('APP_ORIGIN must be the hosted HTTPS origin, without a path, query, or credentials')
}
