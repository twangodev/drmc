import { requireServiceConfiguration, type ServiceSettings } from '../src/lib/server/accounts/configuration.ts'

export interface DeploymentConfiguration {
  origin: string
  variables: Record<string, string>
  secrets: Record<string, string>
}

export function readDeploymentConfiguration(settings: ServiceSettings): DeploymentConfiguration {
  const origin = deploymentOrigin(settings.APP_ORIGIN)
  const serviceEnabled = settings.SERVICE_ENABLED ?? 'false'
  if (!['true', 'false'].includes(serviceEnabled)) throw new Error('SERVICE_ENABLED must be true or false')
  const variables = {
    SERVICE_ENABLED: serviceEnabled,
    APP_ORIGIN: origin,
    DISCORD_CLIENT_ID: settings.DISCORD_CLIENT_ID ?? '',
  }
  const secrets = Object.fromEntries(
    Object.entries({ DISCORD_CLIENT_SECRET: settings.DISCORD_CLIENT_SECRET, LASTFM_API_KEY: settings.LASTFM_API_KEY, LASTFM_API_SECRET: settings.LASTFM_API_SECRET, TOKEN_ENCRYPTION_KEY: settings.TOKEN_ENCRYPTION_KEY })
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  )
  if (serviceEnabled === 'true') requireServiceConfiguration({ ...variables, ...secrets })
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
