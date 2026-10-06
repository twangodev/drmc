import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DiscordArtwork } from '../src/lib/server/discord/artwork.ts'

const applicationId = '970003417277812736'

test('registered Discord assets resolve by name to IDs and are cached separately for each application', async context => {
  let requests = 0
  context.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    requests++
    assert.equal(init.redirect, 'manual')
    assert.equal(new Headers(init.headers).has('Authorization'), false)
    assert.match(input, /\/oauth2\/applications\/\d+\/assets$/)
    return Response.json([{ name: 'lfm_logo', id: '970027358432161832' }, { name: 'heart', id: '970173669169053717' }, { name: 'heart', id: 'INVALID' }])
  })
  const artwork = new DiscordArtwork()
  const expected = { logo: '970027358432161832', heart: '970173669169053717' }
  assert.deepEqual(await artwork.applicationAssets(applicationId), expected)
  assert.deepEqual(await artwork.applicationAssets(applicationId), expected)
  assert.equal(requests, 1)
  assert.deepEqual(await artwork.applicationAssets('123456789012345678'), expected)
  assert.equal(requests, 2)
})

test('failed asset lookups degrade safely and do not retry on every music poll', async context => {
  let requests = 0
  context.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ error: 'PRIVATE FAILURE' }, { status: 503 }) })
  const artwork = new DiscordArtwork()
  assert.deepEqual(await artwork.applicationAssets(applicationId), {})
  assert.deepEqual(await artwork.applicationAssets(applicationId), {})
  assert.equal(requests, 1)
})

test('external album covers use the OAuth media proxy and cache only valid returned paths', async context => {
  let requests = 0
  let path = 'external/cover.png'
  const url = 'https://lastfm.freetls.fastly.net/i/u/300x300/cover.png'
  context.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    requests++
    assert.equal(input, `https://discord.com/api/v9/applications/${applicationId}/external-assets`)
    assert.equal(init.redirect, 'manual')
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer private-oauth-grant')
    assert.deepEqual(JSON.parse(init.body as string), { urls: [requests <= 1 ? url : url + '?invalid'] })
    return Response.json([{ external_asset_path: path }])
  })
  const artwork = new DiscordArtwork()
  assert.equal(await artwork.resolve(applicationId, 'private-oauth-grant', url), 'mp:external/cover.png')
  assert.equal(await artwork.resolve(applicationId, 'private-oauth-grant', url), 'mp:external/cover.png')
  assert.equal(requests, 1)
  path = 'https://evil.example/PRIVATE'
  assert.equal(await artwork.resolve(applicationId, 'private-oauth-grant', url + '?invalid'), undefined)
})
