import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DiscordPresenceEvent } from '../src/lib/discord-presence.ts'
import { DiscordGatewayDiagnostics } from '../src/lib/server/discord/gateway-diagnostics.ts'

const userId = '234567890123456789'
const activity = { name: 'Last.fm', type: 2 as const, details: 'PRIVATE TRACK', state: 'PRIVATE ARTIST' }

test('delivery diagnostics distinguish sent activities, acknowledged heartbeats, and matching self-presence echoes', () => {
  const events: DiscordPresenceEvent[] = []
  const diagnostics = new DiscordGatewayDiagnostics(userId, event => events.push(event))
  diagnostics.ready()
  diagnostics.heartbeatSent()
  diagnostics.received({ op: 11, d: null })
  diagnostics.activitySent(activity)
  const sent = diagnostics.snapshot()
  assert.ok(sent.connectedAt)
  assert.ok(sent.lastHeartbeatSentAt)
  assert.ok(sent.lastHeartbeatAcknowledgedAt)
  assert.ok(sent.lastActivitySentAt)
  assert.equal(sent.activityObservedAt, undefined)
  diagnostics.received({ op: 0, t: 'PRESENCE_UPDATE', d: { user: { id: 'another-user' }, activities: [activity] } })
  assert.equal(diagnostics.snapshot().activityObservedAt, undefined)
  diagnostics.received({ op: 0, t: 'PRESENCE_UPDATE', d: { user: { id: userId }, activities: [{ ...activity, details: 'another track' }] } })
  assert.equal(diagnostics.snapshot().activityObservedAt, undefined)
  diagnostics.received({ op: 0, t: 'PRESENCE_UPDATE', d: { user: { id: userId }, activities: [activity], token: 'PRIVATE TOKEN' } })
  assert.ok(diagnostics.snapshot().activityObservedAt)
  assert.equal(events.at(-1)!.activityObserved, true)
  assert.equal(events.at(-1)!.activityCount, 1)
  diagnostics.activitySent(null)
  assert.equal(diagnostics.snapshot().activityObservedAt, undefined)
  assert.equal(JSON.stringify(events).includes('PRIVATE'), false)
})

test('session echoes and bounded dispatch codes are captured without exposing provider messages or session IDs', () => {
  const events: DiscordPresenceEvent[] = []
  const diagnostics = new DiscordGatewayDiagnostics(userId, event => events.push(event))
  diagnostics.activitySent({ ...activity, assets: { large_image: 'https://lastfm.freetls.fastly.net/PRIVATE-COVER', small_image: '970173669169053717' }, buttons: [{ label: 'PRIVATE LABEL', url: 'https://www.last.fm/PRIVATE-PROFILE' }] })
  assert.deepEqual(events[0]!.activityFields, ['name', 'type', 'details', 'state', 'assets', 'buttons'])
  assert.equal(events[0]!.largeImage, 'external')
  assert.equal(events[0]!.smallImage, 'registered')
  assert.equal(events[0]!.buttons, 1)
  diagnostics.received({ op: 0, t: 'SESSIONS_REPLACE', d: [{ session_id: 'PRIVATE SESSION', activities: [activity] }] })
  assert.ok(diagnostics.snapshot().activityObservedAt)
  assert.deepEqual(events.at(-1)!.activities, [{ fields: ['name', 'type', 'details', 'state'], type: 2, nameMatches: true, detailsMatch: true, stateMatches: true, buttons: 'none', applicationPresent: false, largeImage: 'none', smallImage: 'none' }])
  diagnostics.received({ op: 0, t: 'SESSIONS_REPLACE', d: { sessions: [{ session_id: 'PRIVATE SESSION', activities: [{ ...activity, buttons: ['PRIVATE LABEL'] }] }] } })
  assert.equal(events.at(-1)!.dataShape, 'object')
  assert.deepEqual(events.at(-1)!.dataFields, ['sessions'])
  assert.equal(events.at(-1)!.activities![0]!.buttons, 'labels')
  diagnostics.received({ op: 0, t: 'SESSIONS_REPLACE', d: [{ activities: [{ ...activity, application_id: '123456789012345678', assets: { large_image: 'mp:external/PRIVATE-PATH', small_image: '970027358432161832' } }] }] })
  assert.equal(events.at(-1)!.activities![0]!.applicationPresent, true)
  assert.equal(events.at(-1)!.activities![0]!.largeImage, 'proxy')
  assert.equal(events.at(-1)!.activities![0]!.smallImage, 'registered')
  for (let code = 0; code < 12; code++) diagnostics.received({ op: 0, t: 'ERROR', d: { code, message: 'PRIVATE TOKEN' } })
  assert.equal(diagnostics.snapshot().dispatches.length, 8)
  assert.deepEqual(diagnostics.snapshot().dispatches.map(dispatch => dispatch.code), [4, 5, 6, 7, 8, 9, 10, 11])
  const snapshot = diagnostics.snapshot()
  snapshot.dispatches[0]!.event = 'CHANGED'
  assert.equal(diagnostics.snapshot().dispatches[0]!.event, 'ERROR')
  assert.equal(JSON.stringify(events).includes('PRIVATE'), false)
})

test('diagnostic observers cannot interrupt the presence connection', () => {
  const diagnostics = new DiscordGatewayDiagnostics(userId, () => { throw new Error('observer failed') })
  assert.doesNotThrow(() => {
    diagnostics.ready()
    diagnostics.activitySent(activity)
    diagnostics.received({ op: 11, d: null })
    diagnostics.closed('gateway_closed', 4004)
  })
  assert.ok(diagnostics.snapshot().lastHeartbeatAcknowledgedAt)
})
