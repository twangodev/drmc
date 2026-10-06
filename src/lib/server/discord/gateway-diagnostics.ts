import type { DiscordPresenceActivity, DiscordPresenceDiagnostics, DiscordPresenceDispatch, DiscordPresenceEvent } from '../../discord-presence.ts'
import { gatewayObject, type DiscordActivity } from './gateway-protocol.ts'

export class DiscordGatewayDiagnostics {
  private readonly state: DiscordPresenceDiagnostics = { dispatches: [] }
  private activity?: DiscordActivity | null
  private readonly userId: string
  private readonly observe?: (event: DiscordPresenceEvent) => void

  constructor(userId: string, observe?: (event: DiscordPresenceEvent) => void) {
    this.userId = userId
    this.observe = observe
  }

  snapshot(): DiscordPresenceDiagnostics {
    return structuredClone(this.state)
  }

  ready(): void {
    this.state.connectedAt = Date.now()
    this.emit({ event: 'gateway_ready', at: this.state.connectedAt })
  }

  heartbeatSent(): void { this.state.lastHeartbeatSentAt = Date.now() }

  activitySent(activity: DiscordActivity | null): void {
    this.activity = activity
    this.state.lastActivitySentAt = Date.now()
    delete this.state.activityObservedAt
    this.emit({
      event: 'gateway_activity_sent', at: this.state.lastActivitySentAt,
      activityFields: activity ? Object.keys(activity).filter(key => ['name', 'type', 'details', 'state', 'timestamps', 'assets', 'buttons'].includes(key)) : [],
      largeImage: imageKind(activity?.assets?.large_image), smallImage: imageKind(activity?.assets?.small_image), buttons: activity?.buttons?.length ?? 0,
    })
  }

  received(frame: Record<string, unknown>): void {
    const at = Date.now()
    if (frame.op === 11) {
      const firstAcknowledgement = !this.state.lastHeartbeatAcknowledgedAt
      this.state.lastHeartbeatAcknowledgedAt = at
      if (firstAcknowledgement) this.emit({ event: 'gateway_heartbeat_acknowledged', at })
    }
    if (frame.op !== 0) return
    const event = typeof frame.t === 'string' && /^[A-Z_]{1,64}$/.test(frame.t) ? frame.t : 'UNKNOWN'
    const code = gatewayObject(frame.d)?.code
    const data = gatewayObject(frame.d)
    const activities = this.ownActivities(event, frame.d).slice(0, 8).map(value => activitySummary(value, this.activity))
    const dispatch: DiscordPresenceDispatch = {
      at, event, ...(typeof code === 'number' && Number.isSafeInteger(code) ? { code } : {}),
      dataShape: Array.isArray(frame.d) ? 'array' : data ? 'object' : 'other',
      dataFields: data ? Object.keys(data).filter(key => ['sessions', 'activities', 'user', 'user_id', 'code', 'status', 'message'].includes(key)) : [],
      ...(['SESSIONS_REPLACE', 'PRESENCE_UPDATE'].includes(event) ? { activities } : {}),
    }
    this.state.dispatches = [...this.state.dispatches, dispatch].slice(-8)
    const observed = this.ownActivities(event, frame.d).some(value => {
      const activity = gatewayObject(value)
      return this.activity && activity?.details === this.activity.details && activity?.state === this.activity.state
    })
    if (observed) this.state.activityObservedAt = at
    this.emit({ event: 'gateway_dispatch', at, dispatch: event, ...(dispatch.code !== undefined ? { code: dispatch.code } : {}),
      activityObserved: observed, dataShape: dispatch.dataShape, dataFields: dispatch.dataFields, activities: dispatch.activities,
      ...(dispatch.activities ? { activityCount: dispatch.activities.length } : {}),
    })
  }

  closed(reason?: string, code?: number): void {
    this.emit({ event: 'gateway_closed', at: Date.now(),
      ...(reason && /^[a-z_]{1,64}$/.test(reason) ? { reason } : {}),
      ...(typeof code === 'number' && Number.isSafeInteger(code) ? { code } : {}),
    })
  }

  private ownActivities(event: string, data: unknown): unknown[] {
    const sessions = Array.isArray(data) ? data : gatewayObject(data)?.sessions
    if (event === 'SESSIONS_REPLACE' && Array.isArray(sessions)) return sessions.flatMap(session => {
      const activities = gatewayObject(session)?.activities
      return Array.isArray(activities) ? activities : []
    })
    const presence = gatewayObject(data)
    if (event !== 'PRESENCE_UPDATE' || (gatewayObject(presence?.user)?.id ?? presence?.user_id) !== this.userId) return []
    return Array.isArray(presence?.activities) ? presence.activities : []
  }

  private emit(event: DiscordPresenceEvent): void {
    try { this.observe?.(event) } catch {}
  }
}

function activitySummary(value: unknown, requested?: DiscordActivity | null): DiscordPresenceActivity {
  const activity = gatewayObject(value)
  const buttons = Array.isArray(activity?.buttons) ? activity.buttons : []
  return {
    fields: activity ? Object.keys(activity).filter(key => ['name', 'type', 'application_id', 'details', 'state', 'timestamps', 'assets', 'buttons', 'metadata'].includes(key)) : [],
    ...(typeof activity?.type === 'number' && Number.isSafeInteger(activity.type) ? { type: activity.type } : {}),
    nameMatches: Boolean(requested && activity?.name === requested.name),
    detailsMatch: Boolean(requested && activity?.details === requested.details),
    stateMatches: Boolean(requested && activity?.state === requested.state),
    buttons: !buttons.length ? 'none' : buttons.every(button => typeof button === 'string') ? 'labels' : buttons.every(button => gatewayObject(button)) ? 'objects' : 'mixed',
  }
}

function imageKind(image?: string): DiscordPresenceEvent['largeImage'] {
  if (!image) return 'none'
  if (/^\d{17,20}$/.test(image)) return 'registered'
  if (image.startsWith('mp:')) return 'proxy'
  if (image.startsWith('https://')) return 'external'
  return 'unknown'
}
