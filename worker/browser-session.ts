import { CredentialVault } from '../src/lib/server/accounts/credentials'

export interface BrowserSession { userId: string; nonce: string; expiresAt: number }
export const browserSessionLifetimeSeconds = 30 * 24 * 60 * 60

export function readCookie(request: Request, name: string): string | null {
  const cookies = (request.headers.get('Cookie') ?? '').split(';').map(cookie => cookie.trim()).filter(cookie => cookie.startsWith(`${name}=`))
  return cookies.length === 1 ? cookies[0]!.slice(name.length + 1) : null
}

export function cookie(name: string, value: string, maxAge: number, origin: string, path = '/'): string {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`
}

export async function readBrowserSession(request: Request, vault: CredentialVault): Promise<BrowserSession | null> {
  const value = readCookie(request, 'drmc_session')
  if (!value || value.length > 4096) return null
  try {
    const session = await vault.open<BrowserSession>(value, 'browser-session')
    if (!/^\d{17,20}$/.test(session.userId) || !/^[a-f0-9]{64}$/.test(session.nonce) || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null
    return session
  } catch { return null }
}
