import { DurableObject } from 'cloudflare:workers'
import { scrobbleRefreshIntervalMs, type PlatformStatistics, type StatisticsReport } from '../../src/lib/platform-statistics'
import type { ServiceSettings } from '../../src/lib/server/accounts/configuration'
import { LastfmClient, LastfmFailure } from '../../src/lib/server/lastfm/client'

type ProfileRefresh = { username: string; next_check_at: number }

export interface StatisticsSettings extends ServiceSettings {
  COMMUNITY_STATISTICS: DurableObjectNamespace<CommunityStatistics>
}

export function communityStatistics(env: StatisticsSettings) {
  return env.COMMUNITY_STATISTICS.get(env.COMMUNITY_STATISTICS.idFromName('community'))
}

export class CommunityStatistics extends DurableObject<ServiceSettings> {
  constructor(ctx: DurableObjectState, env: ServiceSettings) {
    super(ctx, env)
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS members (
      account_id TEXT PRIMARY KEY, observed_at INTEGER NOT NULL, registered INTEGER NOT NULL,
      lastfm_username TEXT, sharing_until INTEGER NOT NULL
    )`)
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS profiles (
      username TEXT PRIMARY KEY, scrobbles INTEGER, measured_at INTEGER, next_check_at INTEGER NOT NULL
    )`)
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS profile_refresh ON profiles(next_check_at)')
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS member_profile ON members(lastfm_username)')
  }

  async report(report: StatisticsReport): Promise<void> {
    const profile = report.registered ? report.lastfmUsername?.toLowerCase() ?? null : null
    this.ctx.storage.transactionSync(() => {
      const changed = this.ctx.storage.sql.exec(`INSERT INTO members VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET observed_at=excluded.observed_at, registered=excluded.registered,
          lastfm_username=excluded.lastfm_username, sharing_until=excluded.sharing_until
        WHERE excluded.observed_at > members.observed_at RETURNING account_id`,
        report.accountId, report.observedAt, Number(report.registered), profile, report.registered ? report.sharingUntil : 0).toArray()
      if (!changed.length) return
      if (profile) this.ctx.storage.sql.exec('INSERT INTO profiles(username, next_check_at) VALUES (?, 0) ON CONFLICT DO NOTHING', profile)
      this.ctx.storage.sql.exec('DELETE FROM profiles WHERE NOT EXISTS (SELECT 1 FROM members WHERE lastfm_username=profiles.username AND registered=1)')
    })
    await this.scheduleRefresh()
  }

  read(): PlatformStatistics {
    const sampledAt = Date.now()
    const members = this.ctx.storage.sql.exec<{ members: number; sharingNow: number }>(`SELECT
      COUNT(*) AS members, COALESCE(SUM(sharing_until > ?), 0) AS sharingNow FROM members WHERE registered=1`, sampledAt).one()
    const totals = this.ctx.storage.sql.exec<{ lastfmAccounts: number; scrobbles: number | null; scrobblesUpdatedAt: number | null }>(`SELECT
      COUNT(*) AS lastfmAccounts,
      CASE WHEN COUNT(*)=COUNT(scrobbles) THEN COALESCE(SUM(scrobbles), 0) ELSE NULL END AS scrobbles,
      MIN(measured_at) AS scrobblesUpdatedAt FROM profiles`).one()
    return { ...members, ...totals, sampledAt }
  }

  async alarm(): Promise<void> {
    if (this.env.SERVICE_ENABLED !== 'true' || !this.env.LASTFM_API_KEY || !this.env.LASTFM_API_SECRET) return
    const client = new LastfmClient(this.env.LASTFM_API_KEY, this.env.LASTFM_API_SECRET)
    const profiles = this.ctx.storage.sql.exec<ProfileRefresh>('SELECT username, next_check_at FROM profiles WHERE next_check_at <= ? ORDER BY next_check_at LIMIT 5', Date.now()).toArray()
    for (const profile of profiles) {
      const checkedAt = Date.now()
      try {
        const scrobbles = await client.scrobbleCount(profile.username)
        this.ctx.storage.sql.exec('UPDATE profiles SET scrobbles=?, measured_at=?, next_check_at=? WHERE username=?',
          scrobbles, checkedAt, checkedAt + scrobbleRefreshIntervalMs, profile.username)
      } catch (error) {
        console.warn({ service: 'drmc', event: 'scrobble_statistics_unavailable', reason: error instanceof LastfmFailure ? error.reason : 'unavailable' })
        const retryAt = Date.now() + (error instanceof LastfmFailure ? error.retryAfterMs ?? 60_000 : 60_000)
        this.ctx.storage.sql.exec('UPDATE profiles SET next_check_at=? WHERE username=?', retryAt, profile.username)
        if (error instanceof LastfmFailure && ['rate_limited', 'network_error', 'upstream_error'].includes(error.reason)) {
          this.ctx.storage.sql.exec('UPDATE profiles SET next_check_at=MAX(next_check_at, ?)', retryAt)
          break
        }
      }
    }
    await this.scheduleRefresh()
  }

  private async scheduleRefresh(): Promise<void> {
    const { next } = this.ctx.storage.sql.exec<{ next: number | null }>('SELECT MIN(next_check_at) AS next FROM profiles').one()
    if (next === null) { await this.ctx.storage.deleteAlarm(); return }
    const alarm = await this.ctx.storage.getAlarm()
    const target = Math.max(Date.now() + 1000, next)
    if (alarm === null || Math.abs(alarm - target) > 1000) await this.ctx.storage.setAlarm(target)
  }
}
