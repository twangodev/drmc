import type { MusicPreferences } from '../../music-preferences.ts'
import { lastfmProfileUrl, lastfmTrackUrl, type ListeningTrack } from '../../music.ts'
import type { DiscordActivity } from './gateway-protocol.ts'

export interface MusicActivityAssets { logo?: string; heart?: string }

export function musicActivity(track: ListeningTrack | null, username: string, preferences: MusicPreferences, images: MusicActivityAssets): DiscordActivity | null {
  if (!track) return preferences.keepStatus ? { name: 'Last.fm', type: 0, details: 'DRMC', state: '1.0.0', ...(images.logo ? { assets: { large_image: images.logo } } : {}) } : null
  const buttons = [
    ...(preferences.showProfile ? [{ label: 'Visit last.fm Profile', url: lastfmProfileUrl(username) }] : []),
    { label: 'View scrobble on Last.fm', url: track.url || lastfmTrackUrl(track) },
  ].filter(button => button.url.length <= 512)
  const cover = track.artwork ?? images.logo
  const badge = preferences.showLoved && track.loved ? images.heart ?? images.logo : images.logo
  return {
    name: track.title, type: 2, details: track.title, state: `by ${track.artist}`.slice(0, 128),
    ...(preferences.showElapsed && track.startedAt ? { timestamps: { start: track.startedAt } } : {}),
    assets: {
      ...(preferences.showCovers && cover ? { large_image: cover, large_text: track.album || track.title } : {}),
      ...(badge ? { small_image: badge, small_text: 'DRMC • 1.0.0' } : {}),
    },
    buttons,
  }
}
