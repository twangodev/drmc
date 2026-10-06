import { gatewayObject } from './gateway-protocol'

export class DiscordArtwork {
  private readonly cache = new Map<string, string>()

  async resolve(applicationId: string, accessToken: string, url: string): Promise<string | undefined> {
    const cached = this.cache.get(url)
    if (cached) return cached
    try {
      const response = await fetch(`https://discord.com/api/v9/applications/${applicationId}/external-assets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (https://github.com/twangodev/drmc, 1.0.0)' },
        body: JSON.stringify({ urls: [url] }), redirect: 'manual', signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) return undefined
      const body: unknown = await response.json()
      const path = Array.isArray(body) ? gatewayObject(body[0])?.external_asset_path : undefined
      if (typeof path !== 'string' || !/^[\w/.-]{1,1024}$/.test(path)) return undefined
      const asset = `mp:${path}`
      if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!)
      this.cache.set(url, asset)
      return asset
    } catch { return undefined }
  }
}
