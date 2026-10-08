import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readDeploymentConfiguration } from '../scripts/deployment-configuration.ts'

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
