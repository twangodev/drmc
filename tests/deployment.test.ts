import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readDeploymentConfiguration, resolveDeploymentOrigin } from '../scripts/deployment-configuration.ts'

test('hosted deployment requires a canonical HTTPS origin', () => {
  for (const APP_ORIGIN of [undefined, 'http://localhost:8787', 'https://user:password@drmc.test', 'https://drmc.test/probe', 'https://drmc.test?key=value', 'https://drmc.test#fragment']) {
    assert.throws(() => readDeploymentConfiguration({ APP_ORIGIN }), /APP_ORIGIN/)
  }
  assert.equal(readDeploymentConfiguration({ APP_ORIGIN: 'https://drmc.test/' }).origin, 'https://drmc.test')
})

test('a disabled service can deploy without provider credentials', () => {
  assert.deepEqual(readDeploymentConfiguration({ APP_ORIGIN: 'https://drmc.test' }), {
    origin: 'https://drmc.test',
    variables: { SERVICE_ENABLED: 'false', APP_ORIGIN: 'https://drmc.test', DISCORD_CLIENT_ID: '' },
    secrets: {},
  })
})

test('default origin is discovered with the target account and never follows credential-bearing redirects', async () => {
  const account = 'a'.repeat(32)
  const origin = await resolveDeploymentOrigin({ CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: 'test-token' }, 'drmc', async (url, init) => {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`)
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token')
    assert.equal(init?.redirect, 'error')
    return Response.json({ success: true, result: { subdomain: 'test-account' } })
  })
  assert.equal(origin, 'https://drmc.test-account.workers.dev')
})

test('invalid subdomain responses fail without exposing provider bodies or secrets', async () => {
  const settings = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'test-token' }
  for (const body of [{ success: false }, { success: true, result: { subdomain: 'evil.test/path' } }]) {
    await assert.rejects(resolveDeploymentOrigin(settings, 'drmc', async () => Response.json(body)), /workers.dev subdomain/)
  }
  await assert.rejects(resolveDeploymentOrigin(settings, 'drmc', async () => new Response('private-provider-error', { status: 403 })), /HTTP 403/)
  assert.equal(await resolveDeploymentOrigin({ APP_ORIGIN: 'https://drmc.test' }, 'drmc', async () => { throw new Error('must not fetch') }), 'https://drmc.test')
})


test('production account linking validates provider secrets and keeps them out of Worker variables', () => {
  const settings = { APP_ORIGIN: 'https://drmc.test', SERVICE_ENABLED: 'true', DISCORD_CLIENT_ID: '123456789012345678', DISCORD_CLIENT_SECRET: 'test-secret', LASTFM_API_KEY: 'a'.repeat(32), LASTFM_API_SECRET: 'b'.repeat(32), TOKEN_ENCRYPTION_KEY: 'c'.repeat(64) }
  const configuration = readDeploymentConfiguration(settings)
  assert.equal(configuration.variables.SERVICE_ENABLED, 'true')
  for (const key of ['LASTFM_API_KEY', 'LASTFM_API_SECRET', 'TOKEN_ENCRYPTION_KEY', 'DISCORD_CLIENT_SECRET'] as const) {
    assert.equal(key in configuration.variables, false)
    assert.equal(configuration.secrets[key], settings[key])
    assert.throws(() => readDeploymentConfiguration({ ...settings, [key]: undefined }))
  }
  assert.throws(() => readDeploymentConfiguration({ ...settings, SERVICE_ENABLED: 'yes' }), /SERVICE_ENABLED/)
})
