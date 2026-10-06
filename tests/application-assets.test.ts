import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DiscordApplicationAssets } from '../src/lib/server/discord/application-assets.ts'

const applicationId = '970003417277812736'

test('registered Discord assets resolve by name to IDs and are cached for the active application', async context => {
  let requests = 0
  context.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    requests++
    assert.equal(init.redirect, 'manual')
    assert.equal(new Headers(init.headers).has('Authorization'), false)
    assert.match(input, /\/oauth2\/applications\/\d+\/assets$/)
    return Response.json([{ name: 'lfm_logo', id: '970027358432161832' }, { name: 'heart', id: '970173669169053717' }, { name: 'heart', id: 'INVALID' }])
  })
  const applicationAssets = new DiscordApplicationAssets()
  const expected = { logo: '970027358432161832', heart: '970173669169053717' }
  assert.deepEqual(await applicationAssets.resolve(applicationId), expected)
  assert.deepEqual(await applicationAssets.resolve(applicationId), expected)
  assert.equal(requests, 1)
  assert.deepEqual(await applicationAssets.resolve('123456789012345678'), expected)
  assert.equal(requests, 2)
})

test('failed asset lookups degrade safely and do not retry on every music poll', async context => {
  let requests = 0
  context.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ error: 'PRIVATE FAILURE' }, { status: 503 }) })
  const applicationAssets = new DiscordApplicationAssets()
  assert.deepEqual(await applicationAssets.resolve(applicationId), {})
  assert.deepEqual(await applicationAssets.resolve(applicationId), {})
  assert.equal(requests, 1)
})
