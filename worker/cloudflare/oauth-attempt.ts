import { DurableObject } from 'cloudflare:workers'
import type { AuthorizationAttempt, AuthorizationAttemptStore } from '../../src/lib/server/oauth/attempts'

export class OAuthAttempt extends DurableObject {
  async create(attempt: AuthorizationAttempt): Promise<void> {
    await this.ctx.storage.transaction(async storage => {
      await storage.put('attempt', attempt)
      await storage.setAlarm(attempt.expiresAt)
    })
  }

  async consume(browserBindingHash: string, now: number): Promise<AuthorizationAttempt | null> {
    return this.ctx.storage.transaction(async storage => {
      const attempt = await storage.get<AuthorizationAttempt>('attempt')
      if (!attempt) return null
      if (attempt.expiresAt <= now) {
        await storage.delete('attempt')
        await storage.deleteAlarm()
        return null
      }
      if (attempt.browserBindingHash !== browserBindingHash) return null
      await storage.delete('attempt')
      await storage.deleteAlarm()
      return attempt
    })
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }
}

export class CloudflareAuthorizationAttempts implements AuthorizationAttemptStore {
  constructor(private readonly namespace: DurableObjectNamespace<OAuthAttempt>) {}

  async create(state: string, attempt: AuthorizationAttempt): Promise<void> {
    await this.forState(state).create(attempt)
  }

  async consume(state: string, browserBindingHash: string, now: number): Promise<AuthorizationAttempt | null> {
    return this.forState(state).consume(browserBindingHash, now)
  }

  private forState(state: string) {
    return this.namespace.get(this.namespace.idFromName(state))
  }
}
