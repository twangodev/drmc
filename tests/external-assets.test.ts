import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DiscordExternalAssets } from '../src/lib/server/discord/external-assets.ts'

const applicationId = '970003417277812736'
const artwork = 'https://lastfm-img.freetls.fastly.net/i/u/300x300/cover.png'
const proxyPath = 'external/image-hash/https/lastfm-img.freetls.fastly.net/i/u/300x300/cover.png'

test('Last.fm album URLs resolve to Discord media references and are cached per application', async context => {
  let requests = 0
  context.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    requests++
    assert.match(input, /\/applications\/\d+\/external-assets$/)
    assert.equal(init.method, 'POST')
    assert.equal(init.redirect, 'manual')
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer private-token')
    assert.match(new Headers(init.headers).get('User-Agent')!, /^DiscordBot /)
    assert.deepEqual(JSON.parse(init.body as string), { urls: [artwork] })
    return Response.json([{ url: artwork, external_asset_path: proxyPath }])
  })
  const assets = new DiscordExternalAssets()
  assert.equal(await assets.resolve(applicationId, 'private-token', artwork), `mp:${proxyPath}`)
  assert.equal(await assets.resolve(applicationId, 'rotated-private-token', artwork), `mp:${proxyPath}`)
  assert.equal(requests, 1)
  await assets.resolve('123456789012345678', 'private-token', artwork)
  assert.equal(requests, 2)
})

test('failed registrations back off and recover without falling back to an unresolved URL', async context => {
  let requests = 0
  let now = Date.now()
  const logs: unknown[] = []
  context.mock.method(Date, 'now', () => now)
  context.mock.method(console, 'warn', (event: unknown) => logs.push(event))
  context.mock.method(globalThis, 'fetch', async () => {
    requests++
    return requests === 1 ? Response.json({ error: 'PRIVATE TOKEN' }, { status: 429 }) : Response.json([{ external_asset_path: proxyPath }])
  })
  const assets = new DiscordExternalAssets()
  assert.equal(await assets.resolve(applicationId, 'private-token', artwork), undefined)
  assert.equal(await assets.resolve(applicationId, 'private-token', artwork), undefined)
  assert.equal(requests, 1)
  assert.deepEqual(logs, [{ service: 'drmc', event: 'album_art_unavailable', status: 429 }])
  now += 60_001
  assert.equal(await assets.resolve(applicationId, 'private-token', artwork), `mp:${proxyPath}`)
  assert.equal(requests, 2)
})

test('foreign images and malformed proxy responses cannot enter music activities', async context => {
  let requests = 0
  context.mock.method(console, 'warn', () => {})
  context.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json([{ url: 'https://different.example/cover.png', external_asset_path: proxyPath }]) })
  const assets = new DiscordExternalAssets()
  assert.equal(await assets.resolve(applicationId, 'private-token', 'https://foreign.example/cover.png'), undefined)
  assert.equal(await assets.resolve(applicationId, 'private-token', 'https://lastfm-img.freetls.fastly.net/i/u/2a96cbd8b46e442fc41c2b86b821562f.png'), undefined)
  assert.equal(requests, 0)
  assert.equal(await assets.resolve(applicationId, 'private-token', artwork), undefined)
  context.mock.method(globalThis, 'fetch', async () => Response.json([{ external_asset_path: 'https://foreign.example/cover.png' }]))
  assert.equal(await assets.resolve('123456789012345678', 'private-token', artwork), undefined)
})
