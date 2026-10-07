export interface PlatformStatistics {
  members: number
  sharingNow: number
  lastfmAccounts: number
  scrobbles: number | null
  scrobblesUpdatedAt: number | null
  sampledAt: number
}

export interface StatisticsReport {
  accountId: string
  observedAt: number
  registered: boolean
  lastfmUsername?: string
  sharingUntil: number
}

export const statisticsRefreshIntervalMs = 30_000
export const scrobbleRefreshIntervalMs = 5 * 60_000

export function isPlatformStatistics(value: unknown): value is PlatformStatistics {
  if (!value || typeof value !== 'object') return false
  const statistics = value as Record<string, unknown>
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  return ['members', 'sharingNow', 'lastfmAccounts', 'sampledAt'].every(key => count(statistics[key]))
    && (statistics.scrobbles === null || count(statistics.scrobbles))
    && (statistics.scrobblesUpdatedAt === null || count(statistics.scrobblesUpdatedAt))
}
