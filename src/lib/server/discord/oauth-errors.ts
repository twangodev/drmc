const discordOAuthErrors = new Set([
  'access_denied', 'invalid_request', 'invalid_scope', 'invalid_client', 'invalid_grant',
  'unauthorized_client', 'unsupported_response_type', 'unsupported_grant_type',
  'server_error', 'temporarily_unavailable',
])

export function readDiscordOAuthError(value: unknown): string | null {
  return typeof value === 'string' && discordOAuthErrors.has(value) ? value : null
}
