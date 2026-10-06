import { DurableObject } from 'cloudflare:workers'
import type { AccountView, SyncEvent } from '../../src/lib/account'
import { defaultMusicPreferences, type MusicPreferences } from '../../src/lib/music-preferences'
import { musicObservationLifetimeMs, sameMusicTrack } from '../../src/lib/music'
import { CredentialVault } from '../../src/lib/server/accounts/credentials'
import { requireServiceConfiguration, type ServiceSettings } from '../../src/lib/server/accounts/configuration'
import { randomToken } from '../../src/lib/server/oauth/attempts'
import { DiscordOAuthClient, DiscordOAuthFailure, discordPresenceScopes, type DiscordAuthorization, type DiscordTokens } from '../../src/lib/server/discord/oauth'
import { openDiscordPresence, DiscordGatewayFailure, type LiveDiscordPresence } from '../../src/lib/server/discord/gateway'
import { DiscordApplicationAssets } from '../../src/lib/server/discord/application-assets'
import { musicActivity } from '../../src/lib/server/discord/music-activity'
import { LastfmClient, LastfmFailure, type LastfmSession, type ListeningTrack } from '../../src/lib/server/lastfm/client'
import { connectDiscordGateway } from './discord-gateway'

interface Credentials { discord: DiscordTokens; lastfm?: LastfmSession }
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
  preferences?: MusicPreferences
  nextCheckAt?: number
  publishedAt?: number
  events?: SyncEvent[]
  pollNotBefore?: number
}

export class MusicAccount extends DurableObject<ServiceSettings> {
  private record?: AccountRecord
  private live?: LiveDiscordPresence
  private queue: Promise<unknown> = Promise.resolve()
  private readonly applicationAssets = new DiscordApplicationAssets()
  private published?: string

  constructor(ctx: DurableObjectState, env: ServiceSettings) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => { this.record = await ctx.storage.get<AccountRecord>('account') })
  }

  linkDiscord(authorization: DiscordAuthorization, tokens: DiscordTokens): Promise<string> {
    return this.serial(async () => {
      this.stopPresence()
      const previous = this.record && this.record.userId === authorization.userId ? await this.readCredentials() : undefined
      const previousRecord = previous?.lastfm ? this.record : undefined
      const nonce = randomToken()
      this.record = {
        userId: authorization.userId, session: nonce,
        credentials: await this.vault().seal({ discord: tokens, ...(previous?.lastfm ? { lastfm: previous.lastfm } : {}) }, `credentials:${authorization.userId}`),
        expiresAt: Date.parse(authorization.expiresAt), lastfmUsername: previous?.lastfm?.username,
        enabled: this.record?.enabled ?? true, status: this.record?.enabled === false ? 'paused' : previous?.lastfm ? 'reconnecting' : 'link_lastfm',
        track: previousRecord?.track ?? null, trackStartedAt: previousRecord?.trackStartedAt, lastCheckedAt: previousRecord?.lastCheckedAt,
        lastfmVerifiedAt: previousRecord?.lastfmVerifiedAt, pollNotBefore: previousRecord?.pollNotBefore, failures: 0,
        preferences: this.preferences(),
        events: previousRecord?.events, publishedAt: previousRecord?.publishedAt,
      }
      if (previous?.lastfm && this.record.enabled) await this.schedule(1)
      await this.save()
      return nonce
    })
  }

  linkLastfm(nonce: string, session: LastfmSession): Promise<void> {
    return this.serial(async () => {
      this.requireSession(nonce)
      const credentials = await this.readCredentials()
      credentials.lastfm = session
      await this.storeCredentials(credentials)
      this.stopPresence()
      this.record!.track = null
      delete this.record!.trackStartedAt
      this.record!.lastfmUsername = session.username
      this.record!.status = this.record!.enabled ? 'reconnecting' : 'paused'
      this.record!.failures = 0
      delete this.record!.lastfmVerifiedAt
      delete this.record!.pollNotBefore
      delete this.record!.failure
      if (this.record!.enabled) await this.schedule(1)
      await this.save()
    })
  }

  view(nonce: string): Promise<AccountView | null> {
    return this.serial(async () => this.validSession(nonce) ? this.publicView() : null)
  }

  updatePreferences(nonce: string, preferences: MusicPreferences): Promise<void> {
    return this.serial(async () => {
      this.requireSession(nonce)
      const record = this.record!
      record.preferences = preferences
      if (!preferences.debug) record.events = []
      this.observe('preferences_saved')
      if (record.enabled && record.lastfmUsername && !['reauthorize', 'lastfm_reauthorize', 'cleanup_pending'].includes(record.status)) await this.schedule(1)
      await this.save()
    })
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
        this.observe(record.enabled ? 'resumed' : 'paused')
        if (!record.enabled) { this.stopPresence(); record.track = null; delete record.trackStartedAt; delete record.nextCheckAt; await this.ctx.storage.deleteAlarm() }
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
    if (await this.deferLastfmRetry()) return
    delete record.pollNotBefore
    let retryMs = this.preferences().refreshInterval * 1000
    try {
      const credentials = await this.refreshDiscordGrant()
      this.rememberMusic(await this.readCurrentMusic(credentials))
      await this.publishMusic(credentials.discord.accessToken)
      record.status = record.track ? 'listening' : 'idle'
      if (record.failures) this.observe('recovered')
      record.failures = 0
      delete record.failure
    } catch (error) { retryMs = this.retryFailedSync(error) }
    if (record.enabled && !['reauthorize', 'lastfm_reauthorize'].includes(record.status)) await this.schedule(retryMs)
    else { delete record.nextCheckAt; await this.ctx.storage.deleteAlarm() }
    await this.save()
  }

  private async deferLastfmRetry(): Promise<boolean> {
    const record = this.record!
    if (!record.pollNotBefore || record.pollNotBefore <= Date.now()) return false
    if (Date.now() - (record.lastCheckedAt ?? 0) >= musicObservationLifetimeMs) this.clearMusic()
    const delay = record.pollNotBefore - Date.now()
    await this.schedule(this.live ? Math.min(delay, this.timeUntilMusicExpires()) : delay)
    await this.save()
    return true
  }

  private async refreshDiscordGrant(): Promise<Credentials> {
    const credentials = await this.readCredentials()
    const record = this.record!
    if (record.expiresAt > Date.now() + 120_000) return credentials
    this.stopPresence()
    credentials.discord = await this.oauth().refresh(credentials.discord.refreshToken)
    await this.storeCredentials(credentials)
    const authorization = await this.oauth().inspect(credentials.discord.accessToken)
    if (!discordPresenceScopes.every(scope => authorization.scopes.includes(scope))) throw new DiscordOAuthFailure('inspect', 403, 'presence_scope_missing')
    if (authorization.userId !== record.userId) throw new DiscordOAuthFailure('inspect', 403, 'account_mismatch')
    record.expiresAt = Date.parse(authorization.expiresAt)
    await this.save()
    return credentials
  }

  private async readCurrentMusic(credentials: Credentials): Promise<ListeningTrack | null> {
    const record = this.record!
    const configuration = requireServiceConfiguration(this.env)
    const lastfm = new LastfmClient(configuration.lastfm.key, configuration.lastfm.secret)
    if (Date.now() - (record.lastfmVerifiedAt ?? 0) >= lastfmVerificationIntervalMs) {
      if (!credentials.lastfm) throw new LastfmFailure('authorization_failed')
      await lastfm.verifySession(credentials.lastfm)
      record.lastfmVerifiedAt = Date.now()
    }
    return lastfm.nowPlaying(record.lastfmUsername!)
  }

  private rememberMusic(track: ListeningTrack | null): void {
    const record = this.record!
    const checkedAt = Date.now()
    const changed = !sameMusicTrack(track, record.track) || checkedAt - (record.lastCheckedAt ?? 0) >= musicObservationLifetimeMs
    record.lastCheckedAt = checkedAt
    if (changed || !record.trackStartedAt) record.trackStartedAt = track ? checkedAt : undefined
    if (track) track.startedAt = record.trackStartedAt
    record.track = track
    this.observe('poll')
  }

  private async publishMusic(accessToken: string): Promise<void> {
    const record = this.record!
    const preferences = this.preferences()
    if (!record.track && !preferences.keepStatus) { this.stopPresence(); return }
    await this.ensurePresence(accessToken)
    const applicationId = requireServiceConfiguration(this.env).discord.clientId
    const images = await this.applicationAssets.resolve(applicationId)
    const activity = musicActivity(record.track, record.lastfmUsername!, preferences, images)!
    const payload = JSON.stringify(activity)
    if (this.published === payload) return
    this.live!.update(activity)
    this.published = payload
    record.publishedAt = Date.now()
    this.observe('published')
  }

  private retryFailedSync(error: unknown): number {
    const record = this.record!
    record.failures++
    record.failure = error instanceof LastfmFailure ? `lastfm_${error.reason}` : error instanceof DiscordOAuthFailure ? `discord_${error.reason}` : error instanceof DiscordGatewayFailure ? `discord_${error.diagnostic.reason}` : 'sync_unavailable'
    this.observe('failed', record.failure)
    const denied = error instanceof DiscordOAuthFailure && [400, 401, 403].includes(error.status ?? 0) && error.reason !== 'rate_limited'
      || error instanceof DiscordGatewayFailure && (error.diagnostic.closeCode === 4004 || error.diagnostic.reason === 'gateway_account_mismatch')
    const lastfmDenied = error instanceof LastfmFailure && error.reason === 'authorization_failed'
    record.status = denied ? 'reauthorize' : lastfmDenied ? 'lastfm_reauthorize' : 'reconnecting'
    if (denied || lastfmDenied || Date.now() - (record.lastCheckedAt ?? 0) >= musicObservationLifetimeMs) this.clearMusic()
    let delay = Math.min(60_000, 15_000 * 2 ** Math.min(record.failures, 3)) + Math.floor(Math.random() * 3000)
    if (error instanceof LastfmFailure && error.retryAfterMs) {
      record.pollNotBefore = Date.now() + error.retryAfterMs
      delay = Math.max(delay, error.retryAfterMs)
    }
    return this.live ? Math.min(delay, this.timeUntilMusicExpires()) : delay
  }

  private timeUntilMusicExpires(): number { return Math.max(1000, (this.record!.lastCheckedAt ?? 0) + musicObservationLifetimeMs - Date.now()) }
  private clearMusic(): void { this.stopPresence(); this.record!.track = null; delete this.record!.trackStartedAt }

  private async ensurePresence(accessToken: string): Promise<void> {
    if (this.live) return
    const live = await openDiscordPresence(connectDiscordGateway, { applicationId: this.env.DISCORD_CLIENT_ID!, userId: this.record!.userId, accessToken }, event => console.info({ service: 'drmc', ...event }))
    this.live = live
    this.published = undefined
    this.observe('connected')
    this.ctx.waitUntil(live.closed.then(report => this.serial(async () => {
      if (this.live !== live) return
      this.live = undefined
      this.published = undefined
      if (!this.record?.enabled) return
      this.record.status = report.failure?.closeCode === 4004 ? 'reauthorize' : 'reconnecting'
      this.record.failure = `discord_${report.failure?.reason ?? 'gateway_closed'}`
      this.observe('disconnected', this.record.failure)
      if (this.record.status !== 'reauthorize') await this.schedule(this.preferences().refreshInterval * 1000)
      else { delete this.record.nextCheckAt; await this.ctx.storage.deleteAlarm() }
      await this.save()
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
      track: record.track, preferences: this.preferences(),
      lastCheckedAt: record.lastCheckedAt, nextCheckAt: record.nextCheckAt, publishedAt: record.publishedAt,
      consecutiveFailures: record.failures, events: this.preferences().debug ? record.events ?? [] : [], failure: record.failure,
      presence: this.live?.diagnostics() }
  }
  private preferences(): MusicPreferences { return { ...defaultMusicPreferences, ...this.record?.preferences } }
  private observe(event: SyncEvent['event'], reason?: string): void {
    if (['failed', 'disconnected'].includes(event) && reason && /^[a-z_]{1,64}$/.test(reason)) console.warn({ service: 'drmc', event, reason })
    if (!this.record || !this.preferences().debug) return
    const entry: SyncEvent = { at: Date.now(), event, ...(reason && /^[a-z_]{1,64}$/.test(reason) ? { reason } : {}) }
    this.record.events = [...(this.record.events ?? []), entry].slice(-20)
  }
  private validSession(nonce: string): boolean { return Boolean(this.record && this.record.session === nonce) }
  private requireSession(nonce: string): void { if (!this.validSession(nonce)) throw new Error('Invalid browser session') }
  private vault(): CredentialVault { return new CredentialVault(this.env.TOKEN_ENCRYPTION_KEY!) }
  private oauth(): DiscordOAuthClient { return new DiscordOAuthClient(requireServiceConfiguration(this.env).discord) }
  private readCredentials(): Promise<Credentials> { return this.vault().open(this.record!.credentials, `credentials:${this.record!.userId}`) }
  private async storeCredentials(credentials: Credentials): Promise<void> { this.record!.credentials = await this.vault().seal(credentials, `credentials:${this.record!.userId}`) }
  private save(): Promise<void> { return this.ctx.storage.put('account', this.record!) }
  private async schedule(delay: number): Promise<void> {
    this.record!.nextCheckAt = Date.now() + delay
    await this.ctx.storage.setAlarm(this.record!.nextCheckAt)
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }
}
