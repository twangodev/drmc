import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { Miniflare, Response as RuntimeResponse, type Request as RuntimeRequest } from 'miniflare'
import type { PlatformStatistics, StatisticsReport } from '../src/lib/platform-statistics.ts'

function statisticsRuntime(context: TestContext) {
  let playcount: unknown = '100'
  let rateLimited = false
  const runtime = new Miniflare({ telemetry: { enabled: false }, cf: false, workers: [{ config: {
    name: 'statistics', compatibilityDate: '2026-10-05',
    manifest: { mainModule: 'fixture.js', modules: {
      'index.js': { type: 'esm', contents: readFileSync('dist/index.js', 'utf8') },
      'fixture.js': { type: 'esm', contents: `
        import worker, {CommunityStatistics} from './index.js';
        export class StatisticsFixture extends CommunityStatistics {
          async refreshProfiles() { this.ctx.storage.sql.exec('UPDATE profiles SET next_check_at=0'); await this.alarm(); }
        }
        export default {async fetch(request, env) {
          const actor=env.COMMUNITY_STATISTICS.get(env.COMMUNITY_STATISTICS.idFromName('community'));
          const path=new URL(request.url).pathname;
          if(path==='/fixture/report') { await actor.report(await request.json()); return Response.json(await actor.read()); }
          if(path==='/fixture/refresh') { await actor.refreshProfiles(); return Response.json(await actor.read()); }
          return worker.fetch(request, env);
        }};` },
    } },
    exports: { StatisticsFixture: { type: 'durable-object', storage: 'sqlite' } },
    env: { COMMUNITY_STATISTICS: { type: 'durable-object', worker: 'statistics', exportName: 'StatisticsFixture' },
      SERVICE_ENABLED: { type: 'text', value: 'true' }, LASTFM_API_KEY: { type: 'text', value: 'b'.repeat(32) }, LASTFM_API_SECRET: { type: 'text', value: 'c'.repeat(32) } },
  }, dev: { outboundService: { type: 'fetcher', handler: async (request: RuntimeRequest) => {
    assert.equal(request.url, 'https://ws.audioscrobbler.com/2.0/')
    const parameters = new URLSearchParams(await request.text())
    assert.equal(parameters.get('method'), 'user.getInfo')
    assert.equal(parameters.has('sk'), false)
    return rateLimited ? RuntimeResponse.json({ error: 29 }, { status: 429, headers: { 'Retry-After': '60' } })
      : RuntimeResponse.json({ user: { name: parameters.get('user'), playcount } })
  } } } }] })
  context.after(() => runtime.dispose())
  const report = async (value: StatisticsReport) => (await runtime.dispatchFetch('https://stats.test/fixture/report', { method: 'POST', body: JSON.stringify(value) })).json() as Promise<PlatformStatistics>
  const refresh = async () => (await runtime.dispatchFetch('https://stats.test/fixture/refresh')).json() as Promise<PlatformStatistics>
  return { runtime, report, refresh, setCount: (value: unknown) => { playcount = value }, limit: () => { rateLimited = true } }
}

test('public statistics deduplicate Last.fm profiles, expire activity, ignore old reports, and remove disconnected profiles', async context => {
  const { runtime, report, refresh } = statisticsRuntime(context)
  const now = Date.now()
  const first: StatisticsReport = { accountId: 'account-a', observedAt: now, registered: true, lastfmUsername: 'TwangoDev', sharingUntil: now + 120_000 }
  await report(first)
  await report({ ...first, accountId: 'account-b', lastfmUsername: 'twangodev', sharingUntil: now - 1 })
  const result = await refresh()
  assert.equal(result.members, 2)
  assert.equal(result.sharingNow, 1)
  assert.equal(result.lastfmAccounts, 1)
  assert.equal(result.scrobbles, 100)
  assert.ok(result.scrobblesUpdatedAt)
  await report({ ...first, observedAt: now + 1, registered: false })
  assert.equal((await report(first)).members, 1)
  assert.equal((await report(first)).sharingNow, 0)
  const response = await runtime.dispatchFetch('https://stats.test/api/stats')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  const body = await response.text()
  assert.equal(/account-a|account-b|twangodev|username|token|credential/i.test(body), false)
  await report({ ...first, accountId: 'account-b', observedAt: now + 1, registered: false })
  assert.deepEqual({ ...await report(first), sampledAt: 0 }, { members: 0, sharingNow: 0, lastfmAccounts: 0, scrobbles: 0, scrobblesUpdatedAt: null, sampledAt: 0 })
  const mutation = await runtime.dispatchFetch('https://stats.test/api/stats', { method: 'POST' })
  assert.equal(mutation.status, 405)
  assert.equal(mutation.headers.get('Allow'), 'GET')
})

test('statistics refresh paused profiles, accept falling totals, and preserve known totals through malformed responses and rate limits', async context => {
  const { report, refresh, setCount, limit } = statisticsRuntime(context)
  await report({ accountId: 'paused', observedAt: Date.now(), registered: true, lastfmUsername: 'paused-user', sharingUntil: 0 })
  const initial = await refresh()
  assert.equal(initial.scrobbles, 100)
  assert.equal(initial.sharingNow, 0)
  setCount('90')
  assert.equal((await refresh()).scrobbles, 90)
  setCount('PRIVATE INVALID COUNT')
  const malformed = await refresh()
  assert.equal(malformed.scrobbles, 90)
  assert.ok(malformed.scrobblesUpdatedAt)
  limit()
  assert.equal((await refresh()).scrobbles, 90)
})

test('unknown scrobble counts stay unknown instead of appearing as zero', async context => {
  const { report, refresh, limit } = statisticsRuntime(context)
  limit()
  await report({ accountId: 'unknown', observedAt: Date.now(), registered: true, lastfmUsername: 'unknown-user', sharingUntil: 0 })
  assert.equal((await refresh()).scrobbles, null)
})
