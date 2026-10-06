export interface DiscordRateLimit {
  responseFormat: 'json' | 'other'
  retryAfterSeconds?: number
  scope?: 'user' | 'global' | 'shared'
  global?: boolean
}

export function readDiscordRateLimit(
  response: Response,
  body: Record<string, unknown> | null,
): DiscordRateLimit | undefined {
  if (response.status !== 429) return undefined

  const rateLimit: DiscordRateLimit = { responseFormat: body ? 'json' : 'other' }
  const delays = [
    headerDelay(response.headers.get('Retry-After')),
    numericDelay(body?.retry_after),
  ].filter((delay): delay is number => delay !== undefined)
  if (delays.length) rateLimit.retryAfterSeconds = Math.max(...delays)

  const scope = response.headers.get('X-RateLimit-Scope')
  if (scope === 'user' || scope === 'global' || scope === 'shared') rateLimit.scope = scope
  if (typeof body?.global === 'boolean') rateLimit.global = body.global
  if (response.headers.get('X-RateLimit-Global') === 'true') rateLimit.global = true
  return rateLimit
}

export function revocationRetryDelay(rateLimit: DiscordRateLimit | undefined): number | undefined {
  const seconds = rateLimit?.retryAfterSeconds
  return seconds !== undefined && seconds <= 5 ? Math.ceil(seconds * 1000) : undefined
}

function headerDelay(value: string | null): number | undefined {
  if (value === null || !/^\d+(?:\.\d+)?$/.test(value.trim())) return undefined
  return numericDelay(Number(value))
}

function numericDelay(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
