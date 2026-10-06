import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DiscordGatewayFailure, DiscordGatewayPresence, type GatewayConnection } from '../src/lib/server/discord/gateway.ts'
import { updateGatewayPresence } from '../src/lib/server/discord/gateway-protocol.ts'

const authorization = {
  applicationId: '123456789012345678',
  userId: '234567890123456789',
  accessToken: 'private-test-oauth-token',
}

test('Gateway activity buttons use aligned labels and URL metadata without changing the music activity', () => {
  const activity = {
    name: 'Last.fm', type: 2 as const, details: 'Track', state: 'by Artist',
    assets: { small_image: '970027358432161832' }, timestamps: { start: 1_700_000_000_000 },
    buttons: [{ label: 'Profile', url: 'https://www.last.fm/user/listener' }, { label: 'Track', url: 'https://www.last.fm/music/Artist/_/Track' }],
  }
  const original = structuredClone(activity)
  const sent = updateGatewayPresence(activity, authorization.applicationId).d.activities[0]!
  assert.equal(sent.application_id, authorization.applicationId)
  assert.deepEqual(sent.buttons, ['Profile', 'Track'])
  assert.deepEqual(sent.metadata, { button_urls: activity.buttons.map(button => button.url) })
  assert.deepEqual(sent.assets, activity.assets)
  assert.deepEqual(sent.timestamps, activity.timestamps)
  assert.deepEqual(activity, original)
  for (const buttons of [undefined, []]) {
    const withoutButtons = updateGatewayPresence({ ...activity, buttons }).d.activities[0]!
    assert.equal('buttons' in withoutButtons, false)
    assert.equal('metadata' in withoutButtons, false)
  }
})

class GatewayFixture implements GatewayConnection {
  frames: { op: number; d: unknown }[] = []
  closeCodes: number[] = []
  hello: unknown = { op: 10, d: { heartbeat_interval: 10 } }
  readyUserId = authorization.userId
  sendReady = true
  acknowledgeHeartbeat = true
  failClear = false
  onActivity?: () => void
  private readonly messages = new Set<(message: unknown) => void>()
  private readonly closes = new Set<(code: number) => void>()
  private readonly errors = new Set<() => void>()

  accept(): void {
    if (this.hello !== null) this.emit(this.hello)
  }

  send(message: string): void {
    const frame = JSON.parse(message) as { op: number; d: { activities?: unknown[] } }
    if (this.failClear && frame.op === 3 && frame.d.activities?.length === 0) throw new Error('PRIVATE SOCKET FAILURE')
    this.frames.push(frame)
    if (frame.op === 2 && this.sendReady) {
      queueMicrotask(() => this.emit({ op: 0, t: 'READY', s: 7, d: { user: { id: this.readyUserId }, session_id: 'private-session' } }))
    } else if (frame.op === 1 && this.acknowledgeHeartbeat) {
      queueMicrotask(() => this.emit({ op: 11, d: null }))
    } else if (frame.op === 3 && frame.d.activities?.length) this.onActivity?.()
  }

  close(code: number): void { this.closeCodes.push(code) }
  onMessage(listener: (message: unknown) => void) { this.messages.add(listener); return () => this.messages.delete(listener) }
  onClose(listener: (code: number) => void) { this.closes.add(listener); return () => this.closes.delete(listener) }
  onError(listener: () => void) { this.errors.add(listener); return () => this.errors.delete(listener) }
  emit(frame: unknown): void { for (const listener of this.messages) listener(JSON.stringify(frame)) }
  emitRaw(message: unknown): void { for (const listener of this.messages) listener(message) }
  disconnect(code: number): void { for (const listener of this.closes) listener(code) }
  networkError(): void { for (const listener of this.errors) listener() }
  get listenerCount(): number { return this.messages.size + this.closes.size + this.errors.size }
}

function publisher(socket: GatewayFixture) {
  return new DiscordGatewayPresence(async () => socket, { holdMs: 30, handshakeTimeoutMs: 20, heartbeatJitter: () => 0 })
}

test('the OAuth Gateway identifies, holds a Listening activity, heartbeats, clears, and closes', async () => {
  const socket = new GatewayFixture()
  const report = await publisher(socket).testPresence(authorization)
  assert.equal(report.connected, true)
  assert.equal(report.heartbeatAcknowledged, true)
  assert.equal(report.activitySent, true)
  assert.equal(report.clearSent, true)
  assert.equal(report.failure, undefined)
  assert.deepEqual(socket.frames[0], {
    op: 2,
    d: {
      token: 'Bearer private-test-oauth-token', intents: 0, compress: false,
      properties: { os: 'linux', browser: 'drmc', device: authorization.applicationId },
    },
  })
  const presence = socket.frames.filter(frame => frame.op === 3)
  assert.deepEqual(presence, [
    { op: 3, d: { since: 0, status: 'online', afk: false, activities: [{ name: 'DRMC test', type: 2, details: 'Cloudflare presence test', state: 'Testing Discord OAuth presence' }] } },
    { op: 3, d: { since: 0, status: 'online', afk: false, activities: [] } },
  ])
  assert.ok(socket.frames.some(frame => frame.op === 1 && frame.d === 7))
  assert.deepEqual(socket.closeCodes, [1000])
  assert.equal(socket.listenerCount, 0)
  assert.equal(JSON.stringify(report).includes('private'), false)
})

test('the Gateway account must match the inspected OAuth user before publishing', async () => {
  const socket = new GatewayFixture()
  socket.readyUserId = '345678901234567890'
  const report = await publisher(socket).testPresence(authorization)
  assert.deepEqual(report.failure, { reason: 'gateway_account_mismatch' })
  assert.equal(report.activitySent, false)
  assert.equal(socket.frames.some(frame => frame.op === 3), false)
  assert.equal(socket.listenerCount, 0)
})

test('missing HELLO and missing READY both time out and close without publishing', async () => {
  for (const stage of ['hello', 'ready']) {
    const socket = new GatewayFixture()
    if (stage === 'hello') socket.hello = null
    else socket.sendReady = false
    const report = await publisher(socket).testPresence(authorization)
    assert.deepEqual(report.failure, { reason: 'handshake_timeout' })
    assert.equal(report.activitySent, false)
    assert.deepEqual(socket.closeCodes, [1000])
    assert.equal(socket.listenerCount, 0)
  }
})

test('a missed heartbeat acknowledgement ends the probe and attempts to clear activity', async () => {
  const socket = new GatewayFixture()
  socket.acknowledgeHeartbeat = false
  const report = await publisher(socket).testPresence(authorization)
  assert.deepEqual(report.failure, { reason: 'heartbeat_timeout' })
  assert.equal(report.clearSent, true)
  assert.equal(report.heartbeatAcknowledged, false)
  assert.equal(socket.frames.filter(frame => frame.op === 1).length, 1)
})

for (const [frame, reason] of [
  [{ op: 7 }, 'reconnect_requested'],
  [{ op: 9, d: false }, 'invalid_session'],
] as const) {
  test(`${reason} ends the bounded probe without reusing the token in a reconnect loop`, async () => {
    const socket = new GatewayFixture()
    socket.onActivity = () => queueMicrotask(() => socket.emit(frame))
    const report = await publisher(socket).testPresence(authorization)
    assert.deepEqual(report.failure, { reason })
    assert.equal(report.clearSent, true)
    assert.equal(socket.frames.filter(frame => frame.op === 2).length, 1)
  })
}

for (const message of ['PRIVATE NON-JSON FRAME', new Uint8Array([1]), JSON.stringify({ op: 'private-provider-token' })]) {
  test('malformed Gateway frames fail without returning the raw provider payload', async () => {
    const socket = new GatewayFixture()
    socket.onActivity = () => queueMicrotask(() => socket.emitRaw(message))
    const report = await publisher(socket).testPresence(authorization)
    assert.deepEqual(report.failure, { reason: 'invalid_frame' })
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false)
    assert.equal(JSON.stringify(report).includes('private-provider-token'), false)
    assert.equal(socket.listenerCount, 0)
  })
}

test('invalid HELLO intervals fail before any authentication frame is sent', async () => {
  for (const interval of [0, -1, 'private', 120_001]) {
    const socket = new GatewayFixture()
    socket.hello = { op: 10, d: { heartbeat_interval: interval } }
    const report = await publisher(socket).testPresence(authorization)
    assert.deepEqual(report.failure, { reason: 'invalid_hello' })
    assert.deepEqual(socket.frames, [])
  }
})

test('server-requested heartbeats use the latest dispatch sequence', async () => {
  const socket = new GatewayFixture()
  socket.onActivity = () => queueMicrotask(() => {
    socket.emit({ op: 0, t: 'USER_UPDATE', s: 8, d: {} })
    socket.emit({ op: 1, d: null })
  })
  const report = await publisher(socket).testPresence(authorization)
  assert.equal(report.failure, undefined)
  assert.ok(socket.frames.some(frame => frame.op === 1 && frame.d === 8))
})

test('Gateway authentication close codes are returned without any close reason or token', async () => {
  const socket = new GatewayFixture()
  socket.sendReady = false
  const run = publisher(socket).testPresence(authorization)
  queueMicrotask(() => socket.disconnect(4004))
  const report = await run
  assert.deepEqual(report.failure, { reason: 'gateway_closed', closeCode: 4004 })
  assert.equal(report.activitySent, false)
})

test('a failed clear remains visible and the connection still closes', async () => {
  const socket = new GatewayFixture()
  socket.failClear = true
  const report = await publisher(socket).testPresence(authorization)
  assert.equal(report.activitySent, true)
  assert.equal(report.clearSent, false)
  assert.deepEqual(report.failure, { reason: 'network_error' })
  assert.deepEqual(socket.closeCodes, [1000])
  assert.equal(JSON.stringify(report).includes('PRIVATE SOCKET'), false)
})

test('a disconnected socket cannot claim an activity clear was sent', async () => {
  const socket = new GatewayFixture()
  socket.onActivity = () => queueMicrotask(() => socket.disconnect(1006))
  const report = await publisher(socket).testPresence(authorization)
  assert.equal(report.activitySent, true)
  assert.equal(report.clearSent, false)
  assert.deepEqual(report.failure, { reason: 'gateway_closed', closeCode: 1006 })
  assert.equal(socket.frames.filter(frame => frame.op === 3).length, 1)
})

test('upgrade failures are sanitized before they reach the probe report', async () => {
  const rejected = new DiscordGatewayPresence(async () => { throw new DiscordGatewayFailure({ reason: 'upgrade_failed', status: 429 }) })
  assert.deepEqual((await rejected.testPresence(authorization)).failure, { reason: 'upgrade_failed', status: 429 })
  const network = new DiscordGatewayPresence(async () => { throw new Error('private-token-in-error') })
  assert.deepEqual((await network.testPresence(authorization)).failure, { reason: 'network_error' })
})

test('a persistent OAuth session accepts track changes and explicit idle clears', async () => {
  const { openDiscordPresence } = await import('../src/lib/server/discord/gateway.ts')
  const socket = new GatewayFixture()
  const session = await openDiscordPresence(async () => socket, authorization)
  assert.equal(socket.frames.some(frame => frame.op === 3), false)
  session.update({ name: 'Last.fm', type: 2, details: 'Kid A', state: 'by Radiohead', timestamps: { start: 1234 } })
  assert.equal((socket.frames.find(frame => frame.op === 3)!.d as { activities: { application_id: string }[] }).activities[0]!.application_id, authorization.applicationId)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.ok(session.diagnostics().lastHeartbeatAcknowledgedAt)
  assert.ok(session.diagnostics().lastActivitySentAt)
  assert.equal(session.diagnostics().activityObservedAt, undefined)
  session.update(null)
  session.close()
  const report = await session.closed
  assert.equal(report.heartbeatAcknowledged, true)
  assert.equal(report.clearSent, true)
  assert.equal(socket.listenerCount, 0)
})
