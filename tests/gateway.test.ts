import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { DiscordGatewayFailure, openDiscordPresence, type GatewayConnection } from '../src/lib/server/discord/gateway.ts'
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

const musicActivity = { name: 'Last.fm', type: 2 as const, details: 'Kid A', state: 'by Radiohead' }

async function openSession(context: TestContext, socket: GatewayFixture) {
  const session = await openDiscordPresence(async () => socket, authorization, { handshakeTimeoutMs: 20, heartbeatJitter: () => 0 })
  context.after(() => session.close())
  return session
}

function presenceFrames(socket: GatewayFixture) {
  return socket.frames.filter(frame => frame.op === 3)
}

test('the OAuth Gateway identifies, publishes music, heartbeats, clears, and closes', async context => {
  const socket = new GatewayFixture()
  const session = await openSession(context, socket)
  assert.equal(presenceFrames(socket).length, 0)
  session.update(musicActivity)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.ok(session.diagnostics().lastHeartbeatAcknowledgedAt)
  session.close()
  assert.deepEqual(await session.closed, {})
  assert.deepEqual(socket.frames[0], {
    op: 2,
    d: {
      token: 'Bearer private-test-oauth-token', intents: 0, compress: false,
      properties: { os: 'linux', browser: 'drmc', device: authorization.applicationId },
    },
  })
  assert.deepEqual(presenceFrames(socket), [
    updateGatewayPresence(musicActivity, authorization.applicationId),
    updateGatewayPresence(null),
  ])
  assert.ok(socket.frames.some(frame => frame.op === 1 && frame.d === 7))
  assert.deepEqual(socket.closeCodes, [1000])
  assert.equal(socket.listenerCount, 0)
  assert.throws(() => session.update(musicActivity), /gateway_closed/)
})

test('the Gateway account must match the inspected OAuth user before publishing', async context => {
  const socket = new GatewayFixture()
  socket.readyUserId = '345678901234567890'
  await assert.rejects(openSession(context, socket), { diagnostic: { reason: 'gateway_account_mismatch' } })
  assert.equal(presenceFrames(socket).length, 0)
  assert.equal(socket.listenerCount, 0)
})

test('missing HELLO and missing READY both time out and close without publishing', async context => {
  for (const stage of ['hello', 'ready']) {
    const socket = new GatewayFixture()
    if (stage === 'hello') socket.hello = null
    else socket.sendReady = false
    await assert.rejects(openSession(context, socket), { diagnostic: { reason: 'handshake_timeout' } })
    assert.equal(presenceFrames(socket).length, 0)
    assert.deepEqual(socket.closeCodes, [1000])
    assert.equal(socket.listenerCount, 0)
  }
})

test('a missed heartbeat acknowledgement closes the session and attempts to clear activity', async context => {
  const socket = new GatewayFixture()
  socket.acknowledgeHeartbeat = false
  const session = await openSession(context, socket)
  session.update(musicActivity)
  assert.deepEqual(await session.closed, { failure: { reason: 'heartbeat_timeout' } })
  assert.deepEqual(presenceFrames(socket).at(-1), updateGatewayPresence(null))
  assert.equal(session.diagnostics().lastHeartbeatAcknowledgedAt, undefined)
  assert.equal(socket.frames.filter(frame => frame.op === 1).length, 1)
})

for (const [frame, reason] of [
  [{ op: 7 }, 'reconnect_requested'],
  [{ op: 9, d: false }, 'invalid_session'],
] as const) {
  test(`${reason} closes the session without reusing the token in a reconnect loop`, async context => {
    const socket = new GatewayFixture()
    const session = await openSession(context, socket)
    socket.onActivity = () => queueMicrotask(() => socket.emit(frame))
    session.update(musicActivity)
    assert.deepEqual(await session.closed, { failure: { reason } })
    assert.deepEqual(presenceFrames(socket).at(-1), updateGatewayPresence(null))
    assert.equal(socket.frames.filter(frame => frame.op === 2).length, 1)
  })
}

for (const message of ['PRIVATE NON-JSON FRAME', new Uint8Array([1]), JSON.stringify({ op: 'private-provider-token' })]) {
  test('malformed Gateway frames fail without returning the raw provider payload', async context => {
    const socket = new GatewayFixture()
    const session = await openSession(context, socket)
    socket.onActivity = () => queueMicrotask(() => socket.emitRaw(message))
    session.update(musicActivity)
    assert.deepEqual(await session.closed, { failure: { reason: 'invalid_frame' } })
    assert.equal(socket.listenerCount, 0)
  })
}

test('invalid HELLO intervals fail before any authentication frame is sent', async context => {
  for (const interval of [0, -1, 'private', 120_001]) {
    const socket = new GatewayFixture()
    socket.hello = { op: 10, d: { heartbeat_interval: interval } }
    await assert.rejects(openSession(context, socket), { diagnostic: { reason: 'invalid_hello' } })
    assert.deepEqual(socket.frames, [])
  }
})

test('server-requested heartbeats use the latest dispatch sequence', async context => {
  const socket = new GatewayFixture()
  const session = await openSession(context, socket)
  socket.emit({ op: 0, t: 'USER_UPDATE', s: 8, d: {} })
  socket.emit({ op: 1, d: null })
  assert.ok(socket.frames.some(frame => frame.op === 1 && frame.d === 8))
})

test('Gateway authentication close codes are returned without a close reason or token', async context => {
  const socket = new GatewayFixture()
  socket.sendReady = false
  const opened = openSession(context, socket)
  queueMicrotask(() => socket.disconnect(4004))
  await assert.rejects(opened, { diagnostic: { reason: 'gateway_closed', closeCode: 4004 } })
  assert.equal(presenceFrames(socket).length, 0)
})

test('a failed clear remains visible and the connection still closes', async context => {
  const socket = new GatewayFixture()
  const session = await openSession(context, socket)
  session.update(musicActivity)
  socket.failClear = true
  session.close()
  assert.deepEqual(await session.closed, { failure: { reason: 'network_error' } })
  assert.deepEqual(socket.closeCodes, [1000])
  assert.equal(presenceFrames(socket).length, 1)
})

test('a disconnected socket cannot claim an activity clear was sent', async context => {
  const socket = new GatewayFixture()
  const session = await openSession(context, socket)
  session.update(musicActivity)
  socket.disconnect(1006)
  assert.deepEqual(await session.closed, { failure: { reason: 'gateway_closed', closeCode: 1006 } })
  assert.equal(presenceFrames(socket).length, 1)
})

test('upgrade failures are sanitized before they reach the account', async () => {
  await assert.rejects(openDiscordPresence(async () => { throw new DiscordGatewayFailure({ reason: 'upgrade_failed', status: 429 }) }, authorization), { diagnostic: { reason: 'upgrade_failed', status: 429 } })
  await assert.rejects(openDiscordPresence(async () => { throw new Error('private-token-in-error') }, authorization), { diagnostic: { reason: 'network_error' } })
})

test('a persistent OAuth session accepts track changes and explicit idle clears', async context => {
  const socket = new GatewayFixture()
  const session = await openSession(context, socket)
  session.update({ ...musicActivity, timestamps: { start: 1234 } })
  session.update({ ...musicActivity, details: 'Morning Bell', timestamps: { start: 5678 } })
  assert.equal(session.diagnostics().activityObservedAt, undefined)
  session.update(null)
  session.close()
  assert.deepEqual(await session.closed, {})
  assert.deepEqual(presenceFrames(socket).slice(0, 3), [
    updateGatewayPresence({ ...musicActivity, timestamps: { start: 1234 } }, authorization.applicationId),
    updateGatewayPresence({ ...musicActivity, details: 'Morning Bell', timestamps: { start: 5678 } }, authorization.applicationId),
    updateGatewayPresence(null),
  ])
  assert.equal(socket.listenerCount, 0)
})
