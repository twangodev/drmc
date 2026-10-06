import { lastfmArtwork } from '../../music.ts'
import { gatewayObject } from './gateway-protocol.ts'

interface CachedImage { image?: string; expiresAt: number }

export class DiscordExternalAssets {
  private readonly images = new Map<string, CachedImage>()

  async resolve(applicationId: string, accessToken: string, artwork: string): Promise<string | undefined> {
    if (!lastfmArtwork(artwork)) return undefined
    const key = JSON.stringify([applicationId, artwork])
    const cached = this.images.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.image
    let image: string | undefined
    let status: number | undefined
    try {
      const response = await fetch(`https://discord.com/api/v9/applications/${applicationId}/external-assets`, {
        method: 'POST', headers: {
          Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json',
          'User-Agent': 'DiscordBot (https://github.com/twangodev/drmc, 1.0.0)',
        },
        body: JSON.stringify({ urls: [artwork] }), redirect: 'manual', signal: AbortSignal.timeout(8000),
      })
      status = response.status
      if (response.ok) {
        const body: unknown = await response.json()
        const asset = Array.isArray(body) && body.length === 1 ? gatewayObject(body[0]) : null
        const path = asset?.external_asset_path
        if ((asset?.url === undefined || asset.url === artwork) && typeof path === 'string' && /^external\/[A-Za-z0-9_./%=-]{1,2048}$/.test(path)) image = `mp:${path}`
      }
    } catch {}
    if (!image) console.warn({ service: 'drmc', event: 'album_art_unavailable', ...(status ? { status } : {}) })
    if (this.images.size >= 128) this.images.delete(this.images.keys().next().value!)
    this.images.set(key, { image, expiresAt: Date.now() + (image ? 60 * 60_000 : 60_000) })
    return image
  }
}
