import { gatewayObject } from '../discord/gateway-protocol'

export interface LastfmSession { username: string; key: string }
export interface ListeningTrack { title: string; artist: string; album: string; artwork?: string }

export class LastfmFailure extends Error {
  readonly reason: string
  constructor(reason: string) { super(reason); this.reason = reason }
}

export class LastfmClient {
  private readonly key: string
  private readonly secret: string
  constructor(key: string, secret: string) { this.key = key; this.secret = secret }

  authorizationUrl(callback: string): string {
    const url = new URL('https://www.last.fm/api/auth/')
    url.search = new URLSearchParams({ api_key: this.key, cb: callback }).toString()
    return url.toString()
  }

  async exchange(token: string): Promise<LastfmSession> {
    if (!isLastfmCredential(token)) throw new LastfmFailure('invalid_token')
    const parameters = { api_key: this.key, method: 'auth.getSession', token }
    const response = await this.send(new URLSearchParams({ ...parameters, api_sig: await lastfmSignature(parameters, this.secret), format: 'json' }))
    const session = gatewayObject(response.session)
    if (typeof session?.name !== 'string' || !/^[\w-]{1,64}$/.test(session.name) || !isLastfmCredential(session.key)) {
      throw new LastfmFailure('invalid_session_response')
    }
    return { username: session.name, key: session.key }
  }

  async nowPlaying(username: string): Promise<ListeningTrack | null> {
    const response = await this.send(new URLSearchParams({ api_key: this.key, method: 'user.getrecenttracks', user: username, limit: '1', extended: '1', format: 'json' }))
    const recent = gatewayObject(response.recenttracks)
    if (!recent || !('track' in recent)) throw new LastfmFailure('invalid_track_response')
    const tracks = Array.isArray(recent.track) ? recent.track : [recent.track]
    if (!tracks.length) return null
    const track = gatewayObject(tracks[0])
    if (!track) throw new LastfmFailure('invalid_track_response')
    if (gatewayObject(track['@attr'])?.nowplaying !== 'true') return null
    const artist = gatewayObject(track.artist)
    const title = boundedText(track.name)
    const artistName = boundedText(artist?.name ?? artist?.['#text'])
    if (!title || !artistName) throw new LastfmFailure('invalid_track_response')
    const images = Array.isArray(track.image) ? track.image : []
    const artwork = images.map(image => gatewayObject(image)?.['#text']).filter(isLastfmArtwork).at(-1)
    return { title, artist: artistName, album: boundedText(gatewayObject(track.album)?.['#text']) ?? '', ...(artwork ? { artwork } : {}) }
  }

  async verifySession(session: LastfmSession): Promise<void> {
    const parameters = { api_key: this.key, method: 'user.getInfo', sk: session.key }
    const response = await this.send(new URLSearchParams({ ...parameters, api_sig: await lastfmSignature(parameters, this.secret), format: 'json' }))
    if (gatewayObject(response.user)?.name !== session.username) throw new LastfmFailure('authorization_failed')
  }

  private async send(parameters: URLSearchParams): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetch('https://ws.audioscrobbler.com/2.0/', { method: 'POST', body: parameters, redirect: 'manual', signal: AbortSignal.timeout(8000) })
    } catch { throw new LastfmFailure('network_error') }
    let body: Record<string, unknown> | null
    try { body = gatewayObject(await response.json()) } catch {
      throw new LastfmFailure(response.ok ? 'invalid_response' : response.status === 429 ? 'rate_limited' : 'upstream_error')
    }
    if (!body) throw new LastfmFailure('invalid_response')
    if (typeof body.error === 'number') {
      throw new LastfmFailure(body.error === 29 ? 'rate_limited' : [4, 9, 14, 15].includes(body.error) ? 'authorization_failed' : 'upstream_error')
    }
    if (!response.ok) throw new LastfmFailure(response.status === 429 ? 'rate_limited' : 'upstream_error')
    return body
  }
}

export function isLastfmCredential(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7E]{1,1024}$/.test(value)
}

export async function lastfmSignature(parameters: Record<string, string>, secret: string): Promise<string> {
  const source = Object.keys(parameters).filter(key => !['format', 'callback', 'api_sig'].includes(key)).sort().map(key => key + parameters[key]).join('') + secret
  const digest = await crypto.subtle.digest('MD5', new TextEncoder().encode(source))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function boundedText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : null
}

function isLastfmArtwork(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'lastfm.freetls.fastly.net' && !url.username && !url.password } catch { return false }
}
