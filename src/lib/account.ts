export interface AccountView {
  userId: string
  lastfmUsername?: string
  enabled: boolean
  connected: boolean
  status: 'link_lastfm' | 'paused' | 'listening' | 'idle' | 'reconnecting' | 'reauthorize' | 'lastfm_reauthorize' | 'cleanup_pending'
  track: { title: string; artist: string; album: string } | null
  lastCheckedAt?: number
  failure?: string
}
