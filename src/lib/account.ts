import type { ListeningTrack } from './music'
import type { MusicPreferences } from './music-preferences'

export interface SyncEvent {
  at: number
  event: 'poll' | 'published' | 'connected' | 'disconnected' | 'failed' | 'recovered' | 'preferences_saved' | 'paused' | 'resumed'
  reason?: string
}

export interface AccountView {
  userId: string
  lastfmUsername?: string
  enabled: boolean
  connected: boolean
  status: 'link_lastfm' | 'paused' | 'listening' | 'idle' | 'reconnecting' | 'reauthorize' | 'lastfm_reauthorize' | 'cleanup_pending'
  track: ListeningTrack | null
  preferences: MusicPreferences
  lastCheckedAt?: number
  nextCheckAt?: number
  publishedAt?: number
  consecutiveFailures: number
  events: SyncEvent[]
  failure?: string
}
