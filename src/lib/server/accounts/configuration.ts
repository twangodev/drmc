import type { ProbeSettings } from '../probe/configuration'

export interface ServiceSettings extends ProbeSettings {
  SERVICE_ENABLED?: string
  LASTFM_API_KEY?: string
  LASTFM_API_SECRET?: string
  TOKEN_ENCRYPTION_KEY?: string
}

export function requireServiceConfiguration(settings: ServiceSettings) {
  const origin = new URL(settings.APP_ORIGIN ?? '')
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname)
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !(origin.protocol === 'https:' || (local && origin.protocol === 'http:'))) throw new Error('Invalid APP_ORIGIN')
  if (!/^\d{17,20}$/.test(settings.DISCORD_CLIENT_ID ?? '') || !settings.DISCORD_CLIENT_SECRET) throw new Error('Discord credentials required')
  if (!settings.LASTFM_API_KEY || !settings.LASTFM_API_SECRET) throw new Error('Last.fm credentials required')
  if (!/^[a-f0-9]{64}$/.test(settings.TOKEN_ENCRYPTION_KEY ?? '')) throw new Error('Encryption key required')
  return {
    origin: origin.origin,
    encryptionKey: settings.TOKEN_ENCRYPTION_KEY!,
    lastfm: { key: settings.LASTFM_API_KEY!, secret: settings.LASTFM_API_SECRET! },
    discord: { clientId: settings.DISCORD_CLIENT_ID!, clientSecret: settings.DISCORD_CLIENT_SECRET!, redirectUri: `${origin.origin}/auth/discord/callback` },
  }
}
