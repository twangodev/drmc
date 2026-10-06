import {
  gatewayHeartbeat,
  gatewayObject,
  identifyGateway,
  presenceProbeDurationMs,
  updateGatewayPresence,
} from './gateway-protocol.ts'

export interface GatewayConnection {
  accept(): void
  send(message: string): void
  close(code: number): void
  onMessage(listener: (message: unknown) => void): () => void
  onClose(listener: (code: number) => void): () => void
  onError(listener: () => void): () => void
}

export interface PresenceProbeAuthorization {
  applicationId: string
  userId: string
  accessToken: string
}

export interface GatewayFailureDiagnostic {
  reason: string
  status?: number
  closeCode?: number
}

export interface GatewayProbeReport {
  connected: boolean
  heartbeatAcknowledged: boolean
  activitySent: boolean
  clearSent: boolean
  heldForSeconds: number
  failure?: GatewayFailureDiagnostic
}

export interface DiscordPresencePublisher {
  testPresence(authorization: PresenceProbeAuthorization): Promise<GatewayProbeReport>
}

export class DiscordGatewayFailure extends Error {
  readonly diagnostic: GatewayFailureDiagnostic

  constructor(diagnostic: GatewayFailureDiagnostic) {
    super(`Discord Gateway failed: ${diagnostic.reason}`)
    this.diagnostic = diagnostic
  }
}

export class DiscordGatewayPresence implements DiscordPresencePublisher {
  private readonly connect: () => Promise<GatewayConnection>
  private readonly timing: GatewayProbeTiming

  constructor(connect: () => Promise<GatewayConnection>, timing: GatewayProbeTiming = {}) {
    this.connect = connect
    this.timing = timing
  }

  async testPresence(authorization: PresenceProbeAuthorization): Promise<GatewayProbeReport> {
    try {
      const socket = await this.connect()
      return await new GatewayProbeSession(socket, authorization, this.timing).run()
    } catch (error) {
      return { ...emptyGatewayReport(), failure: describeGatewayFailure(error) }
    }
  }
}

interface GatewayProbeTiming {
  holdMs?: number
  handshakeTimeoutMs?: number
  heartbeatJitter?: () => number
}

class GatewayProbeSession {
  private readonly socket: GatewayConnection
  private readonly authorization: PresenceProbeAuthorization
  private readonly timing: GatewayProbeTiming
  private readonly report = emptyGatewayReport()
  private readonly unsubscribe: (() => void)[] = []
  private heartbeatTimer?: ReturnType<typeof setTimeout>
  private deadlineTimer?: ReturnType<typeof setTimeout>
  private sequence: number | null = null
  private heartbeatInterval = 0
  private awaitingHeartbeat = false
  private identified = false
  private startedAt?: number
  private finished = false
  private disconnected = false
  private resolve?: (report: GatewayProbeReport) => void

  constructor(socket: GatewayConnection, authorization: PresenceProbeAuthorization, timing: GatewayProbeTiming) {
    this.socket = socket
    this.authorization = authorization
    this.timing = timing
  }

  run(): Promise<GatewayProbeReport> {
    return new Promise(resolve => {
      this.resolve = resolve
      this.unsubscribe.push(
        this.socket.onMessage(message => this.receive(message)),
        this.socket.onClose(code => {
          this.disconnected = true
          this.finish({ reason: 'gateway_closed', closeCode: code })
        }),
        this.socket.onError(() => this.finish({ reason: 'network_error' })),
      )
      this.deadlineTimer = setTimeout(() => this.finish({ reason: 'handshake_timeout' }), this.timing.handshakeTimeoutMs ?? 10_000)
      try {
        this.socket.accept()
      } catch {
        this.finish({ reason: 'network_error' })
      }
    })
  }

  private receive(message: unknown): void {
    if (this.finished) return
    try {
      if (typeof message !== 'string' || message.length > 1_048_576) {
        throw new DiscordGatewayFailure({ reason: 'invalid_frame' })
      }
      const frame = gatewayObject(JSON.parse(message))
      if (!frame || !Number.isInteger(frame.op)) throw new DiscordGatewayFailure({ reason: 'invalid_frame' })
      if (typeof frame.s === 'number' && Number.isSafeInteger(frame.s) && frame.s >= 0) this.sequence = frame.s
      if (frame.op === 10) this.identify(frame.d)
      else if (frame.op === 0 && frame.t === 'READY') this.ready(frame.d)
      else if (frame.op === 11) {
        this.awaitingHeartbeat = false
        this.report.heartbeatAcknowledged = true
      } else if (frame.op === 1) this.heartbeat(false)
      else if (frame.op === 7) this.finish({ reason: 'reconnect_requested' })
      else if (frame.op === 9) this.finish({ reason: 'invalid_session' })
    } catch (error) {
      this.finish(error instanceof DiscordGatewayFailure ? error.diagnostic : { reason: 'invalid_frame' })
    }
  }

  private identify(data: unknown): void {
    const interval = gatewayObject(data)?.heartbeat_interval
    if (this.identified || typeof interval !== 'number' || !Number.isSafeInteger(interval) || interval <= 0 || interval > 120_000) {
      throw new DiscordGatewayFailure({ reason: 'invalid_hello' })
    }
    this.heartbeatInterval = interval
    this.identified = true
    this.send(identifyGateway(this.authorization.applicationId, this.authorization.accessToken))
    const jitter = this.timing.heartbeatJitter?.() ?? Math.random()
    this.heartbeatTimer = setTimeout(() => this.heartbeat(true), Math.floor(interval * jitter))
  }

  private ready(data: unknown): void {
    if (!this.identified || this.report.connected) throw new DiscordGatewayFailure({ reason: 'unexpected_ready' })
    const user = gatewayObject(gatewayObject(data)?.user)
    if (user?.id !== this.authorization.userId) throw new DiscordGatewayFailure({ reason: 'gateway_account_mismatch' })
    this.report.connected = true
    this.send(updateGatewayPresence(true))
    this.report.activitySent = true
    this.startedAt = Date.now()
    if (this.deadlineTimer !== undefined) clearTimeout(this.deadlineTimer)
    this.deadlineTimer = setTimeout(() => this.finish(), this.timing.holdMs ?? presenceProbeDurationMs)
  }

  private heartbeat(scheduled: boolean): void {
    if (this.finished) return
    if (!this.identified) return this.finish({ reason: 'unexpected_heartbeat' })
    if (scheduled && this.awaitingHeartbeat) return this.finish({ reason: 'heartbeat_timeout' })
    try {
      this.awaitingHeartbeat = true
      this.send(gatewayHeartbeat(this.sequence))
      if (scheduled) this.heartbeatTimer = setTimeout(() => this.heartbeat(true), this.heartbeatInterval)
    } catch {
      this.finish({ reason: 'network_error' })
    }
  }

  private send(frame: unknown): void {
    try {
      this.socket.send(JSON.stringify(frame))
    } catch {
      throw new DiscordGatewayFailure({ reason: 'network_error' })
    }
  }

  private finish(failure?: GatewayFailureDiagnostic): void {
    if (this.finished) return
    this.finished = true
    if (this.heartbeatTimer !== undefined) clearTimeout(this.heartbeatTimer)
    if (this.deadlineTimer !== undefined) clearTimeout(this.deadlineTimer)
    if (failure) this.report.failure = failure
    if (this.startedAt !== undefined) this.report.heldForSeconds = Math.round((Date.now() - this.startedAt) / 1000)
    if (this.report.activitySent && !this.disconnected) {
      try {
        this.send(updateGatewayPresence(false))
        this.report.clearSent = true
      } catch (error) {
        this.report.failure ??= describeGatewayFailure(error)
      }
    }
    for (const unsubscribe of this.unsubscribe) unsubscribe()
    try {
      this.socket.close(1000)
    } catch {
      this.report.failure ??= { reason: 'close_failed' }
    }
    this.resolve?.(this.report)
  }
}

export function describeGatewayFailure(error: unknown): GatewayFailureDiagnostic {
  return error instanceof DiscordGatewayFailure ? error.diagnostic : { reason: 'network_error' }
}

function emptyGatewayReport(): GatewayProbeReport {
  return { connected: false, heartbeatAcknowledged: false, activitySent: false, clearSent: false, heldForSeconds: 0 }
}
