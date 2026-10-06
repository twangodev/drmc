import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readDeploymentConfiguration, resolveDeploymentOrigin } from '../scripts/deployment-configuration.ts'

test('hosted deployment requires a canonical HTTPS origin', () => {
  for (const APP_ORIGIN of [undefined, 'http://localhost:8787', 'https://user:password@drmc.test', 'https://drmc.test/probe', 'https://drmc.test?key=value', 'https://drmc.test#fragment']) {
    assert.throws(() => readDeploymentConfiguration({ APP_ORIGIN }), /APP_ORIGIN/)
  }
  assert.equal(readDeploymentConfiguration({ APP_ORIGIN: 'https://drmc.test/' }).origin, 'https://drmc.test')
})

test('first deployment disables the probe without requiring Discord credentials', () => {
  assert.deepEqual(readDeploymentConfiguration({ APP_ORIGIN: 'https://drmc.test' }), {
    origin: 'https://drmc.test',
    variables: { APP_ORIGIN: 'https://drmc.test', PROBE_ENABLED: 'false', DISCORD_CLIENT_ID: '', PROBE_ALLOWED_DISCORD_IDS: '' },
    secrets: {},
  })
  assert.throws(() => readDeploymentConfiguration({ APP_ORIGIN: 'https://drmc.test', PROBE_ENABLED: 'yes' }), /PROBE_ENABLED/)
})

test('enabling the hosted probe requires its credentials and explicit test-account admission', () => {
  const settings = {
    APP_ORIGIN: 'https://drmc.test', PROBE_ENABLED: 'true', DISCORD_CLIENT_ID: '123456789012345678',
    PROBE_ALLOWED_DISCORD_IDS: '234567890123456789', DISCORD_CLIENT_SECRET: 'test-client-secret',
    PROBE_ACCESS_KEY: 'test-operator-secret-at-least-32-characters',
  }
  const configuration = readDeploymentConfiguration(settings)
  assert.equal(configuration.variables.PROBE_ENABLED, 'true')
  assert.equal('DISCORD_CLIENT_SECRET' in configuration.variables, false)
  assert.equal('PROBE_ACCESS_KEY' in configuration.variables, false)
  assert.deepEqual(configuration.secrets, { DISCORD_CLIENT_SECRET: settings.DISCORD_CLIENT_SECRET, PROBE_ACCESS_KEY: settings.PROBE_ACCESS_KEY })
  for (const missing of ['DISCORD_CLIENT_ID', 'PROBE_ALLOWED_DISCORD_IDS', 'DISCORD_CLIENT_SECRET', 'PROBE_ACCESS_KEY'] as const) {
    assert.throws(() => readDeploymentConfiguration({ ...settings, [missing]: undefined }))
  }
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
