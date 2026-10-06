import {
  DiscordOAuthFailure,
  discordPresenceScopes,
  type DiscordAuthorization,
  type DiscordOAuthClient,
  type DiscordOperation,
  type DiscordTokens,
} from '../discord/oauth'

export interface ProbeReport {
  gate: 'unverified'
  publication: 'not_tested'
  oauth: 'verified' | 'failed'
  requestedScopes: readonly string[]
  authorization?: DiscordAuthorization
  refreshed?: boolean
  failure?: { operation: DiscordOperation | 'admission'; reason: string; status: number | null }
  cleanup: 'revoked' | 'failed' | 'not_obtained'
}

export async function inspectDiscordAccess(
  client: DiscordOAuthClient,
  code: string,
  allowedUsers: ReadonlySet<string>,
): Promise<ProbeReport> {
  const report: ProbeReport = {
    gate: 'unverified',
    publication: 'not_tested',
    oauth: 'failed',
    requestedScopes: discordPresenceScopes,
    cleanup: 'not_obtained',
  }
  let tokens: DiscordTokens | undefined
  try {
    tokens = await client.exchange(code)
    const authorization = await client.inspect(tokens.accessToken)
    if (!allowedUsers.has(authorization.userId)) {
      report.failure = { operation: 'admission', reason: 'account_not_allowed', status: null }
      return report
    }
    report.authorization = authorization
    tokens = await client.refresh(tokens.refreshToken)
    const refreshed = await client.inspect(tokens.accessToken)
    if (refreshed.userId !== authorization.userId) {
      throw new DiscordOAuthFailure('inspect', null, 'account_changed_after_refresh')
    }
    report.authorization = refreshed
    report.refreshed = true
    report.oauth = 'verified'
  } catch (error) {
    report.failure = error instanceof DiscordOAuthFailure
      ? { operation: error.operation, reason: error.reason, status: error.status }
      : { operation: 'inspect', reason: 'unexpected_error', status: null }
    if (error instanceof DiscordOAuthFailure && error.cleanup) report.cleanup = error.cleanup
  } finally {
    if (tokens && report.cleanup === 'not_obtained') {
      try {
        await client.revoke(tokens.refreshToken)
        report.cleanup = 'revoked'
      } catch {
        report.cleanup = 'failed'
      }
    }
  }
  return report
}
