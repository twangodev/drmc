import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { Miniflare } from 'miniflare'
import type { AuthorizationAttempt } from '../src/lib/server/oauth/attempts.ts'

const origin = 'https://drmc.test'

function createRuntime(context: TestContext) {
  const runtime = new Miniflare({
    telemetry: { enabled: false }, cf: false,
    workers: [{ config: {
      name: 'drmc', compatibilityDate: '2026-10-05',
      assets: { directory: new URL('../build/', import.meta.url).pathname, hasUserWorker: true, runWorkerFirst: ['/api/*', '/auth/*', '/health'], notFoundHandling: '404-page' },
      manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8') } } },
      exports: { OAuthAttempt: { type: 'durable-object', storage: 'sqlite' } },
      env: { ASSETS: { type: 'assets' }, OAUTH_ATTEMPTS: { type: 'durable-object', worker: 'drmc', exportName: 'OAuthAttempt' } },
    } }],
  })
  context.after(() => runtime.dispose())
  return runtime
}

test('health works without provider credentials and unknown API routes return uncached JSON', async context => {
  const runtime = createRuntime(context)
  const health = await runtime.dispatchFetch(`${origin}/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })
  assert.equal(health.headers.get('Cache-Control'), 'no-store')
  for (const path of ['/api/missing', '/api/probe']) {
    const missing = await runtime.dispatchFetch(`${origin}${path}`)
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { error: 'not_found' })
    assert.equal(missing.headers.get('Cache-Control'), 'no-store')
  }
})

test('prerendered pages preserve security headers and removed probe routes return 404', async context => {
  const runtime = createRuntime(context)
  for (const path of ['/', '/app']) {
    const response = await runtime.dispatchFetch(`${origin}${path}`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('Content-Type')!, /text\/html/)
    const html = await response.text()
    assert.match(html, /drmc/)
    assert.match(html, /content-security-policy/i)
    assert.equal(response.headers.get('Referrer-Policy'), 'same-origin')
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY')
  }
  for (const path of ['/probe', '/probe/start', '/probe/callback']) {
    assert.equal((await runtime.dispatchFetch(`${origin}${path}`)).status, 404)
  }
})

async function attemptStore(runtime: Miniflare, state: string) {
  const namespace = await runtime.getDurableObjectNamespace('OAUTH_ATTEMPTS')
  return namespace.get(namespace.idFromName(state)) as unknown as {
    create(attempt: AuthorizationAttempt): Promise<void>
    consume(browserBindingHash: string, now: number): Promise<AuthorizationAttempt | null>
  }
}

test('durable authorization attempts reject another browser and concurrent consumption succeeds once', async context => {
  const store = await attemptStore(createRuntime(context), 'one-time-state')
  const attempt: AuthorizationAttempt = { purpose: 'discord_link', browserBindingHash: 'bound-browser', expiresAt: Date.now() + 60_000 }
  await store.create(attempt)
  assert.equal(await store.consume('another-browser', Date.now()), null)
  const results = await Promise.all([store.consume('bound-browser', Date.now()), store.consume('bound-browser', Date.now())])
  assert.equal(results.filter(Boolean).length, 1)
  const consumed = results.find(Boolean)!
  assert.equal(await consumed.purpose, attempt.purpose)
  assert.equal(await consumed.browserBindingHash, attempt.browserBindingHash)
  assert.equal(await consumed.expiresAt, attempt.expiresAt)
  assert.equal(await store.consume('bound-browser', Date.now()), null)
})

test('expired durable authorization attempts cannot be consumed', async context => {
  const store = await attemptStore(createRuntime(context), 'expired-state')
  await store.create({ purpose: 'lastfm_link', browserBindingHash: 'bound-browser', expiresAt: Date.now() - 1 })
  assert.equal(await store.consume('bound-browser', Date.now()), null)
})
