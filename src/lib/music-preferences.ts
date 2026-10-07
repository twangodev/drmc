export type ListeningStatusDisplay = 'song' | 'artist'

export interface MusicPreferences {
  refreshInterval: number
  statusDisplay: ListeningStatusDisplay
  showProfile: boolean
  showLoved: boolean
  showCovers: boolean
  showElapsed: boolean
  keepStatus: boolean
  debug: boolean
}

export const defaultMusicPreferences: Readonly<MusicPreferences> = Object.freeze({
  refreshInterval: 10, statusDisplay: 'song', showProfile: true, showLoved: false, showCovers: true,
  showElapsed: true, keepStatus: false, debug: false,
})

export class InvalidMusicPreferences extends Error {
  constructor() { super('invalid_music_preferences') }
}

export function readMusicPreferences(parameters: URLSearchParams): MusicPreferences {
  const interval = parameters.get('refreshInterval') ?? ''
  if (!/^\d{1,4}$/.test(interval)) throw new InvalidMusicPreferences()
  const refreshInterval = Number(interval)
  if (refreshInterval < 1 || refreshInterval > 3600) throw new InvalidMusicPreferences()
  const preferences: MusicPreferences = { ...defaultMusicPreferences, refreshInterval }
  const statusDisplay = parameters.get('statusDisplay') ?? defaultMusicPreferences.statusDisplay
  if (statusDisplay !== 'song' && statusDisplay !== 'artist') throw new InvalidMusicPreferences()
  preferences.statusDisplay = statusDisplay
  for (const key of ['showProfile', 'showLoved', 'showCovers', 'showElapsed', 'keepStatus', 'debug'] as const) {
    const value = parameters.get(key)
    if (value !== null && value !== 'on') throw new InvalidMusicPreferences()
    preferences[key] = value === 'on'
  }
  return preferences
}
