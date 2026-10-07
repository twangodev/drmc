import assert from 'node:assert/strict'
import { setTimeout } from 'node:timers/promises'
import { deploymentOrigin } from './deployment-configuration.ts'
import { isPlatformStatistics } from '../src/lib/platform-statistics.ts'

const origin = deploymentOrigin(process.env.APP_ORIGIN ?? process.argv[2])

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, origin), { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) })
}

async function verifyDeployment(): Promise<void> {
  const health = await request('/health')
  assert.equal(health.status, 200, 'Health endpoint is unavailable')
  assert.deepEqual(await health.json(), { status: 'ok' })

  if (process.env.GITHUB_SHA) {
    const release = await request(`/release.json?revision=${process.env.GITHUB_SHA}`)
    assert.equal(release.status, 200, 'Release metadata is unavailable')
    assert.deepEqual(await release.json(), { revision: process.env.GITHUB_SHA }, 'Hosted source revision does not match the workflow')
  }

  for (const path of ['/', '/app']) {
    const response = await request(path)
    assert.equal(response.status, 200, `${path} is unavailable`)
    assert.match(response.headers.get('Content-Type') ?? '', /text\/html/)
    const referrerPolicies = response.headers.get('Referrer-Policy')?.split(',').map(policy => policy.trim())
    assert.equal(referrerPolicies?.at(-1), 'same-origin')
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY')
    assert.match(await response.text(), /drmc/)
  }

  const account = await request('/api/account')
  assert.ok([200, 401].includes(account.status), 'Account API is unavailable')
  assert.equal(account.headers.get('Cache-Control'), 'no-store')
  const accountStatus = await account.json() as { enabled: boolean; account: unknown }
  assert.equal(accountStatus.account, null, 'Anonymous requests cannot expose linked accounts')
  if (process.env.SERVICE_ENABLED === 'true') assert.equal(accountStatus.enabled, true)

  const statistics = await request('/api/stats')
  assert.equal(statistics.status, 200, 'Platform statistics are unavailable')
  assert.equal(statistics.headers.get('Cache-Control'), 'no-store')
  assert.ok(isPlatformStatistics(await statistics.json()), 'Hosted platform statistics are malformed')

  const missingApi = await request('/api/deployment-check-missing')
  assert.equal(missingApi.status, 404, 'Missing API route must return 404')
  assert.deepEqual(await missingApi.json(), { error: 'not_found' })

  console.log(`Verified ${origin}: pages, account API, platform statistics, and source revision`)
}

let lastFailure: unknown
for (let attempt = 0; attempt < 6; attempt++) {
  if (attempt) await setTimeout(5_000)
  try {
    await verifyDeployment()
    lastFailure = undefined
    break
  } catch (error) {
    lastFailure = error
    console.log(`Deployment check ${attempt + 1}/6 failed; waiting for the hosted release`)
  }
}
if (lastFailure) throw lastFailure
