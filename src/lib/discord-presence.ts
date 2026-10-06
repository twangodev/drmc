export interface DiscordPresenceDispatch {
  at: number
  event: string
  code?: number
}

export interface DiscordPresenceDiagnostics {
  connectedAt?: number
  lastHeartbeatSentAt?: number
  lastHeartbeatAcknowledgedAt?: number
  lastActivitySentAt?: number
  activityObservedAt?: number
  dispatches: DiscordPresenceDispatch[]
}

export interface DiscordPresenceEvent {
  event: 'gateway_ready' | 'gateway_dispatch' | 'gateway_heartbeat_acknowledged' | 'gateway_activity_sent' | 'gateway_closed'
  at: number
  dispatch?: string
  code?: number
  reason?: string
  activityObserved?: boolean
  activityFields?: string[]
  largeImage?: 'none' | 'registered' | 'external' | 'proxy' | 'unknown'
  smallImage?: 'none' | 'registered' | 'external' | 'proxy' | 'unknown'
  buttons?: number
}
