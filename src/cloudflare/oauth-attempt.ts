import { DurableObject } from 'cloudflare:workers'
import type { AuthorizationAttempt, AuthorizationAttemptStore } from '../oauth/attempts'

export class OAuthAttempt extends DurableObject {
  async create(attempt: AuthorizationAttempt): Promise<void> {
    await this.ctx.storage.transaction(async storage => {
      await storage.put('attempt', attempt)
      await storage.setAlarm(attempt.expiresAt)
    })
  }

  async consume(browserBindingHash: string, now: number): Promise<boolean> {
    return this.ctx.storage.transaction(async storage => {
      const attempt = await storage.get<AuthorizationAttempt>('attempt')
      if (!attempt) return false
      if (attempt.expiresAt <= now) {
        await storage.delete('attempt')
        await storage.deleteAlarm()
        return false
      }
      if (attempt.browserBindingHash !== browserBindingHash) return false
      await storage.delete('attempt')
      await storage.deleteAlarm()
      return true
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

  async consume(state: string, browserBindingHash: string, now: number): Promise<boolean> {
    return this.forState(state).consume(browserBindingHash, now)
  }

  private forState(state: string) {
    return this.namespace.get(this.namespace.idFromName(state))
  }
}
