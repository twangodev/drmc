import type { ListeningStatusDisplay } from './music-preferences.ts'

export interface ListeningTrack {
  title: string
  artist: string
  album: string
  artwork?: string
  loved?: boolean
  startedAt?: number
  url?: string
}

export const musicObservationLifetimeMs = 120_000

export function listeningActivityName(track: Pick<ListeningTrack, 'title' | 'artist'>, display: ListeningStatusDisplay): string {
  return display === 'artist' ? track.artist : track.title
}

export function lastfmProfileUrl(username: string): string {
  return `https://www.last.fm/user/${encodeURIComponent(username)}`
}

export function lastfmTrackUrl(track: Pick<ListeningTrack, 'title' | 'artist'>): string {
  return `https://www.last.fm/music/${encodeURIComponent(track.artist)}/_/${encodeURIComponent(track.title)}`
}

export function musicText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : undefined
}

function musicLink(value: unknown, hosts: readonly string[]): string | undefined {
  if (typeof value !== 'string' || value.length > 1024) return undefined
  try {
    const url = new URL(value, 'https://www.last.fm')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !hosts.includes(url.hostname)) return undefined
    url.protocol = 'https:'
    return url.toString()
  } catch { return undefined }
}

export function lastfmArtwork(value: unknown): string | undefined {
  const url = musicLink(value, ['lastfm-img.freetls.fastly.net', 'lastfm.freetls.fastly.net'])
  return url && !url.includes('2a96cbd8b46e442fc41c2b86b821562f') ? url : undefined
}

export function lastfmMusicLink(value: unknown): string | undefined {
  const url = musicLink(value, ['www.last.fm', 'last.fm'])
  return url && new URL(url).pathname.startsWith('/music/') ? url : undefined
}

export function sameMusicTrack(first: ListeningTrack | null, second: ListeningTrack | null): boolean {
  return first?.title === second?.title && first?.artist === second?.artist && first?.album === second?.album
}
