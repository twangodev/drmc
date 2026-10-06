export const authorizationLifetimeMs = 10 * 60 * 1000

export interface AuthorizationAttempt {
  browserBindingHash: string
  expiresAt: number
  experiment?: 'presence'
}

export interface AuthorizationAttemptStore {
  create(state: string, attempt: AuthorizationAttempt): Promise<void>
  consume(state: string, browserBindingHash: string, now: number): Promise<AuthorizationAttempt | null>
}

export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export function isAuthorizationToken(value: string | null): value is string {
  return value !== null && /^[a-f0-9]{64}$/.test(value)
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
