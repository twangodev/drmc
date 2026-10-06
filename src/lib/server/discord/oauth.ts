import { readDiscordOAuthError } from './oauth-errors'

export const discordPresenceScopes = ['identify', 'openid', 'sdk.social_layer_presence'] as const

export interface DiscordApplication {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface DiscordTokens {
  accessToken: string
  refreshToken: string
}

export interface DiscordAuthorization {
  applicationId: string
  userId: string
  scopes: string[]
  expiresAt: string
}

export type DiscordOperation = 'exchange' | 'inspect' | 'refresh' | 'revoke'

export class DiscordOAuthFailure extends Error {
  constructor(
    readonly operation: DiscordOperation,
    readonly status: number | null,
    readonly reason: string,
    readonly cleanup?: 'revoked' | 'failed',
  ) {
    super(`Discord ${operation} failed: ${reason}`)
    this.name = 'DiscordOAuthFailure'
  }
}

export class DiscordOAuthClient {
  constructor(
    private readonly application: DiscordApplication,
    private readonly request: typeof fetch = fetch.bind(globalThis),
  ) {}

  authorizationUrl(state: string): string {
    const url = new URL('https://discord.com/oauth2/authorize')
    url.search = new URLSearchParams({
      client_id: this.application.clientId,
      response_type: 'code',
      redirect_uri: this.application.redirectUri,
      scope: discordPresenceScopes.join(' '),
      state,
      prompt: 'consent',
    }).toString()
    return url.toString()
  }

  async exchange(code: string): Promise<DiscordTokens> {
    return this.requestTokens('exchange', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.application.redirectUri,
    })
  }

  async refresh(refreshToken: string): Promise<DiscordTokens> {
    return this.requestTokens('refresh', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
  }

  async inspect(accessToken: string): Promise<DiscordAuthorization> {
    const response = await this.send('inspect', 'https://discord.com/api/v10/oauth2/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const body = await this.readObject(response, 'inspect')
    const application = asObject(body.application)
    const user = asObject(body.user)
    if (
      application?.id !== this.application.clientId ||
      typeof user?.id !== 'string' || !/^\d{17,20}$/.test(user.id) ||
      !Array.isArray(body.scopes) || !body.scopes.every(scope => typeof scope === 'string') ||
      typeof body.expires !== 'string' || !Number.isFinite(Date.parse(body.expires))
    ) throw new DiscordOAuthFailure('inspect', response.status, 'invalid_authorization')

    return {
      applicationId: application.id as string,
      userId: user.id,
      scopes: body.scopes as string[],
      expiresAt: body.expires,
    }
  }

  async revoke(token: string, tokenType: 'refresh_token' | 'access_token' = 'refresh_token'): Promise<void> {
    const response = await this.send('revoke', 'https://discord.com/api/oauth2/token/revoke', {
      method: 'POST',
      body: this.authenticatedForm({ token, token_type_hint: tokenType }),
    })
    await response.body?.cancel()
  }

  private async requestTokens(
    operation: 'exchange' | 'refresh',
    parameters: Record<string, string>,
  ): Promise<DiscordTokens> {
    const response = await this.send(operation, 'https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: this.authenticatedForm(parameters),
    })
    const body = await this.readObject(response, operation)
    if (
      typeof body.access_token !== 'string' || !body.access_token ||
      typeof body.refresh_token !== 'string' || !body.refresh_token ||
      body.token_type !== 'Bearer'
    ) {
      const cleanup = await this.revokeRecognizableToken(body)
      throw new DiscordOAuthFailure(operation, response.status, 'invalid_token_response', cleanup)
    }
    return { accessToken: body.access_token, refreshToken: body.refresh_token }
  }

  private async revokeRecognizableToken(body: Record<string, unknown>): Promise<'revoked' | 'failed' | undefined> {
    const refreshToken = typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null
    const accessToken = typeof body.access_token === 'string' && body.access_token ? body.access_token : null
    const token = refreshToken ?? accessToken
    if (!token) return undefined
    try {
      await this.revoke(token, refreshToken ? 'refresh_token' : 'access_token')
      return 'revoked'
    } catch {
      return 'failed'
    }
  }

  private authenticatedForm(parameters: Record<string, string>): URLSearchParams {
    return new URLSearchParams({
      ...parameters,
      client_id: this.application.clientId,
      client_secret: this.application.clientSecret,
    })
  }

  private async send(operation: DiscordOperation, url: string, init: RequestInit): Promise<Response> {
    let response: Response
    try {
      response = await this.request(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      })
    } catch {
      throw new DiscordOAuthFailure(operation, null, 'network_error')
    }
    if (!response.ok) {
      const reason = await discordFailureReason(response)
      throw new DiscordOAuthFailure(operation, response.status, reason)
    }
    return response
  }

  private async readObject(response: Response, operation: DiscordOperation): Promise<Record<string, unknown>> {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new DiscordOAuthFailure(operation, response.status, 'invalid_json')
    }
    const object = asObject(body)
    if (!object) throw new DiscordOAuthFailure(operation, response.status, 'invalid_response')
    return object
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

async function discordFailureReason(response: Response): Promise<string> {
  try {
    const body = asObject(await response.json())
    const reason = readDiscordOAuthError(body?.error)
    if (reason) return reason
  } catch {}
  return response.status === 429 ? 'rate_limited' : 'upstream_error'
}
