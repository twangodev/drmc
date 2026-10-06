import type { DiscordApplication } from '../discord/oauth'

export interface ProbeSettings {
  APP_ORIGIN?: string
  PROBE_ENABLED?: string
  PROBE_ALLOWED_DISCORD_IDS?: string
  DISCORD_CLIENT_ID?: string
  DISCORD_CLIENT_SECRET?: string
  PROBE_ACCESS_KEY?: string
}

export interface ProbeConfiguration {
  origin: string
  application: DiscordApplication
  accessKey: string
  allowedUsers: ReadonlySet<string>
}

export class InvalidProbeConfiguration extends Error {
  constructor(readonly fields: string[]) {
    super('The Discord probe is not configured')
    this.name = 'InvalidProbeConfiguration'
  }
}

export function readProbeConfiguration(settings: ProbeSettings): ProbeConfiguration {
  const invalid: string[] = []
  const origin = validatedOrigin(settings.APP_ORIGIN)
  const allowedUsers = new Set((settings.PROBE_ALLOWED_DISCORD_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean))
  if (!origin) invalid.push('APP_ORIGIN')
  if (!/^\d{17,20}$/.test(settings.DISCORD_CLIENT_ID ?? '')) invalid.push('DISCORD_CLIENT_ID')
  if (!settings.DISCORD_CLIENT_SECRET?.trim()) invalid.push('DISCORD_CLIENT_SECRET')
  if ((settings.PROBE_ACCESS_KEY?.length ?? 0) < 32) invalid.push('PROBE_ACCESS_KEY')
  if (!allowedUsers.size || [...allowedUsers].some(id => !/^\d{17,20}$/.test(id))) invalid.push('PROBE_ALLOWED_DISCORD_IDS')
  if (invalid.length || !origin) throw new InvalidProbeConfiguration(invalid)

  return {
    origin,
    application: {
      clientId: settings.DISCORD_CLIENT_ID!,
      clientSecret: settings.DISCORD_CLIENT_SECRET!,
      redirectUri: `${origin}/probe/callback`,
    },
    accessKey: settings.PROBE_ACCESS_KEY!,
    allowedUsers,
  }
}

function validatedOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (
      url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && local))
    ) return null
    return url.origin
  } catch {
    return null
  }
}
