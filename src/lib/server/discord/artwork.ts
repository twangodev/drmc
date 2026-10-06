import { gatewayObject } from './gateway-protocol.ts'

export class DiscordArtwork {
  private readonly cache = new Map<string, string>()
  private registered?: { applicationId: string; expiresAt: number; assets: { logo?: string; heart?: string } }

  async applicationAssets(applicationId: string): Promise<{ logo?: string; heart?: string }> {
    if (this.registered?.applicationId === applicationId && this.registered.expiresAt > Date.now()) return this.registered.assets
    const assets: { logo?: string; heart?: string } = {}
    let lifetimeMs = 60_000
    try {
      const response = await fetch(`https://discord.com/api/v9/oauth2/applications/${applicationId}/assets`, {
        headers: { 'User-Agent': 'DiscordBot (https://github.com/twangodev/drmc, 1.0.0)' }, redirect: 'manual', signal: AbortSignal.timeout(8000),
      })
      if (response.ok) {
        const body: unknown = await response.json()
        if (Array.isArray(body)) {
          for (const entry of body) {
            const asset = gatewayObject(entry)
            if (typeof asset?.id !== 'string' || !/^\d{17,20}$/.test(asset.id)) continue
            if (asset.name === 'lfm_logo') assets.logo = asset.id
            if (asset.name === 'heart') assets.heart = asset.id
          }
          lifetimeMs = 15 * 60_000
        }
      }
    } catch {}
    this.registered = { applicationId, expiresAt: Date.now() + lifetimeMs, assets }
    return assets
  }

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
