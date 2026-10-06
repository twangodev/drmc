import { DurableObject } from 'cloudflare:workers'
import type { AccountView } from '../../src/lib/account'
import { CredentialVault } from '../../src/lib/server/accounts/credentials'
import { requireServiceConfiguration, type ServiceSettings } from '../../src/lib/server/accounts/configuration'
import { randomToken } from '../../src/lib/server/oauth/attempts'
import { DiscordOAuthClient, DiscordOAuthFailure, discordPresenceScopes, type DiscordAuthorization, type DiscordTokens } from '../../src/lib/server/discord/oauth'
import { openDiscordPresence, DiscordGatewayFailure, type LiveDiscordPresence } from '../../src/lib/server/discord/gateway'
import { DiscordArtwork } from '../../src/lib/server/discord/artwork'
import { LastfmClient, LastfmFailure, type LastfmSession, type ListeningTrack } from '../../src/lib/server/lastfm/client'
import { connectDiscordGateway } from './discord-gateway'

interface Credentials { discord: DiscordTokens; lastfm?: LastfmSession }
const musicPollIntervalMs = 15_000
const presenceStaleAfterMs = 120_000
const lastfmVerificationIntervalMs = 15 * 60_000
interface AccountRecord {
  userId: string
  session: string
  credentials: string
  expiresAt: number
  lastfmUsername?: string
  enabled: boolean
  status: AccountView['status']
  track: ListeningTrack | null
  trackStartedAt?: number
  lastCheckedAt?: number
  lastfmVerifiedAt?: number
  failure?: string
  failures: number
}

export class MusicAccount extends DurableObject<ServiceSettings> {
  private record?: AccountRecord
  private live?: LiveDiscordPresence
  private queue: Promise<unknown> = Promise.resolve()
  private readonly artwork = new DiscordArtwork()
  private published?: string

  constructor(ctx: DurableObjectState, env: ServiceSettings) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => { this.record = await ctx.storage.get<AccountRecord>('account') })
  }

  linkDiscord(authorization: DiscordAuthorization, tokens: DiscordTokens): Promise<string> {
    return this.serial(async () => {
      this.stopPresence()
      const previous = this.record && this.record.userId === authorization.userId ? await this.readCredentials() : undefined
      const nonce = randomToken()
      this.record = {
        userId: authorization.userId, session: nonce,
        credentials: await this.vault().seal({ discord: tokens, ...(previous?.lastfm ? { lastfm: previous.lastfm } : {}) }, `credentials:${authorization.userId}`),
        expiresAt: Date.parse(authorization.expiresAt), lastfmUsername: previous?.lastfm?.username,
        enabled: this.record?.enabled ?? true, status: this.record?.enabled === false ? 'paused' : previous?.lastfm ? 'reconnecting' : 'link_lastfm', track: null, failures: 0,
      }
      await this.save()
      if (previous?.lastfm && this.record.enabled) await this.schedule(1)
      return nonce
    })
  }

  linkLastfm(nonce: string, session: LastfmSession): Promise<void> {
    return this.serial(async () => {
      this.requireSession(nonce)
      const credentials = await this.readCredentials()
      credentials.lastfm = session
      await this.storeCredentials(credentials)
      this.record!.lastfmUsername = session.username
      this.record!.status = this.record!.enabled ? 'reconnecting' : 'paused'
      this.record!.failures = 0
      delete this.record!.lastfmVerifiedAt
      delete this.record!.failure
      await this.save()
      if (this.record!.enabled) await this.schedule(1)
    })
  }

  view(nonce: string): Promise<AccountView | null> {
    return this.serial(async () => this.validSession(nonce) ? this.publicView() : null)
  }

  control(nonce: string, action: 'pause' | 'resume' | 'disconnect' | 'logout'): Promise<AccountView | null> {
    return this.serial(async () => {
      this.requireSession(nonce)
      const record = this.record!
      if (action === 'logout') {
        record.session = randomToken()
      } else if (action === 'disconnect') {
        this.stopPresence()
        record.enabled = false
        record.session = randomToken()
        record.track = null
        delete record.lastfmUsername
        const credentials = await this.readCredentials()
        delete credentials.lastfm
        await this.storeCredentials(credentials)
        record.status = 'cleanup_pending'
        await this.save()
        await this.revokeDisconnectedAccount()
        return this.record ? this.publicView() : null
      } else {
        record.enabled = action === 'resume'
        record.status = record.enabled ? (record.lastfmUsername ? 'reconnecting' : 'link_lastfm') : 'paused'
        record.failures = 0
        delete record.failure
        if (!record.enabled) { this.stopPresence(); record.track = null; await this.ctx.storage.deleteAlarm() }
        else if (record.lastfmUsername) await this.schedule(1)
      }
      await this.save()
      return this.publicView()
    })
  }

  alarm(): Promise<void> {
    return this.serial(async () => {
      if (!this.record) return
      if (this.record.status === 'cleanup_pending') { await this.revokeDisconnectedAccount(); return }
      if (!this.record.enabled || !this.record.lastfmUsername || ['reauthorize', 'lastfm_reauthorize'].includes(this.record.status)) return
      await this.synchronize()
    })
  }

  private async synchronize(): Promise<void> {
    const record = this.record!
    let retryMs = musicPollIntervalMs + Math.floor(Math.random() * 3000)
    try {
      const credentials = await this.readCredentials()
      if (record.expiresAt <= Date.now() + 120_000) {
        this.stopPresence()
        credentials.discord = await this.oauth().refresh(credentials.discord.refreshToken)
        await this.storeCredentials(credentials)
        const authorization = await this.oauth().inspect(credentials.discord.accessToken)
        if (!discordPresenceScopes.every(scope => authorization.scopes.includes(scope))) throw new DiscordOAuthFailure('inspect', 403, 'presence_scope_missing')
        if (authorization.userId !== record.userId) throw new DiscordOAuthFailure('inspect', 403, 'account_mismatch')
        record.expiresAt = Date.parse(authorization.expiresAt)
        await this.save()
      }
      const configuration = requireServiceConfiguration(this.env)
      const lastfm = new LastfmClient(configuration.lastfm.key, configuration.lastfm.secret)
      if (Date.now() - (record.lastfmVerifiedAt ?? 0) >= lastfmVerificationIntervalMs) {
        if (!credentials.lastfm) throw new LastfmFailure('authorization_failed')
        await lastfm.verifySession(credentials.lastfm)
        record.lastfmVerifiedAt = Date.now()
      }
      const track = await lastfm.nowPlaying(record.lastfmUsername!)
      const changed = track?.title !== record.track?.title || track?.artist !== record.track?.artist || track?.album !== record.track?.album
      record.lastCheckedAt = Date.now()
      if (changed) record.trackStartedAt = track ? Date.now() : undefined
      record.track = track
      if (track) {
        await this.ensurePresence(credentials.discord.accessToken)
        const asset = track.artwork ? await this.artwork.resolve(configuration.discord.clientId, credentials.discord.accessToken, track.artwork) : undefined
        const activity = {
          name: 'Last.fm', type: 2 as const, details: track.title, state: `by ${track.artist}`.slice(0, 128),
          timestamps: { start: record.trackStartedAt ?? Date.now() },
          ...(asset ? { assets: { large_image: asset, large_text: track.album || track.title } } : {}),
        }
        const payload = JSON.stringify(activity)
        if (this.published !== payload) { this.live!.update(activity); this.published = payload }
        record.status = 'listening'
      } else { this.stopPresence(); record.status = 'idle' }
      record.failures = 0
      delete record.failure
    } catch (error) {
      record.failures++
      record.failure = error instanceof LastfmFailure ? `lastfm_${error.reason}` : error instanceof DiscordOAuthFailure ? `discord_${error.reason}` : error instanceof DiscordGatewayFailure ? `discord_${error.diagnostic.reason}` : 'sync_unavailable'
      const denied = error instanceof DiscordOAuthFailure && [400, 401, 403].includes(error.status ?? 0) && error.reason !== 'rate_limited'
        || error instanceof DiscordGatewayFailure && (error.diagnostic.closeCode === 4004 || error.diagnostic.reason === 'gateway_account_mismatch')
      const lastfmDenied = error instanceof LastfmFailure && error.reason === 'authorization_failed'
      record.status = denied ? 'reauthorize' : lastfmDenied ? 'lastfm_reauthorize' : 'reconnecting'
      if (denied || lastfmDenied || Date.now() - (record.lastCheckedAt ?? 0) >= presenceStaleAfterMs) { this.stopPresence(); record.track = null }
      retryMs = Math.min(60_000, 15_000 * 2 ** Math.min(record.failures, 3)) + Math.floor(Math.random() * 3000)
      if (record.track && record.lastCheckedAt) retryMs = Math.min(retryMs, Math.max(1000, record.lastCheckedAt + presenceStaleAfterMs - Date.now()))
    }
    await this.save()
    if (record.enabled && !['reauthorize', 'lastfm_reauthorize'].includes(record.status)) await this.schedule(retryMs)
  }

  private async ensurePresence(accessToken: string): Promise<void> {
    if (this.live) return
    const live = await openDiscordPresence(connectDiscordGateway, { applicationId: this.env.DISCORD_CLIENT_ID!, userId: this.record!.userId, accessToken })
    this.live = live
    this.published = undefined
    this.ctx.waitUntil(live.closed.then(report => this.serial(async () => {
      if (this.live !== live) return
      this.live = undefined
      this.published = undefined
      if (!this.record?.enabled) return
      this.record.status = report.failure?.closeCode === 4004 ? 'reauthorize' : 'reconnecting'
      this.record.failure = `discord_${report.failure?.reason ?? 'gateway_closed'}`
      await this.save()
      if (this.record.status !== 'reauthorize') await this.schedule(15_000)
    })))
  }

  private stopPresence(): void {
    const live = this.live
    this.live = undefined
    this.published = undefined
    live?.close()
  }

  private async revokeDisconnectedAccount(): Promise<void> {
    try {
      await this.oauth().revoke((await this.readCredentials()).discord.refreshToken)
      this.record = undefined
      await this.ctx.storage.deleteAll()
      await this.ctx.storage.deleteAlarm()
    } catch {
      this.record!.failure = 'discord_cleanup_pending'
      await this.save()
      await this.schedule(60_000)
    }
  }

  private publicView(): AccountView {
    const record = this.record!
    return { userId: record.userId, lastfmUsername: record.lastfmUsername, enabled: record.enabled, connected: Boolean(this.live), status: record.status,
      track: record.track ? { title: record.track.title, artist: record.track.artist, album: record.track.album } : null,
      lastCheckedAt: record.lastCheckedAt, failure: record.failure }
  }
  private validSession(nonce: string): boolean { return Boolean(this.record && this.record.session === nonce) }
  private requireSession(nonce: string): void { if (!this.validSession(nonce)) throw new Error('Invalid browser session') }
  private vault(): CredentialVault { return new CredentialVault(this.env.TOKEN_ENCRYPTION_KEY!) }
  private oauth(): DiscordOAuthClient { return new DiscordOAuthClient(requireServiceConfiguration(this.env).discord) }
  private readCredentials(): Promise<Credentials> { return this.vault().open(this.record!.credentials, `credentials:${this.record!.userId}`) }
  private async storeCredentials(credentials: Credentials): Promise<void> { this.record!.credentials = await this.vault().seal(credentials, `credentials:${this.record!.userId}`) }
  private save(): Promise<void> { return this.ctx.storage.put('account', this.record!) }
  private schedule(delay: number): Promise<void> { return this.ctx.storage.setAlarm(Date.now() + delay) }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }
}
