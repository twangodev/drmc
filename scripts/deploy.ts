import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDeploymentConfiguration, resolveDeploymentOrigin } from './deployment-configuration.ts'

if (!process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('CLOUDFLARE_ACCOUNT_ID is required')
if (process.env.CI === 'true' && !process.env.CLOUDFLARE_API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is required in CI')
const release = JSON.parse(readFileSync('build/release.json', 'utf8')) as { revision?: string }
if (!release.revision || !/^[a-f0-9]{40,64}$/.test(release.revision)) throw new Error('Run bun run build:release before deployment')
if (process.env.GITHUB_SHA && release.revision !== process.env.GITHUB_SHA) throw new Error('Release does not match this workflow revision')
const project = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }
const origin = await resolveDeploymentOrigin(process.env, project.name)
const configuration = readDeploymentConfiguration({ ...process.env, APP_ORIGIN: origin })

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'drmc-deploy-'))
try {
  const arguments_ = [
    'node_modules/wrangler/bin/wrangler.js', 'deploy', 'dist/index.js', '--no-bundle',
    '--tag', release.revision.slice(0, 12), '--message', `DRMC ${release.revision}`,
    ...Object.entries(configuration.variables).flatMap(([name, value]) => ['--var', `${name}:${value}`]),
  ]
  if (Object.keys(configuration.secrets).length) {
    const secretsFile = join(temporaryDirectory, 'secrets.json')
    writeFileSync(secretsFile, JSON.stringify(configuration.secrets), { mode: 0o600 })
    arguments_.push('--secrets-file', secretsFile)
  }
  const result = spawnSync(process.execPath, arguments_, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Wrangler deployment failed with exit code ${result.status}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `origin=${configuration.origin}\n`)
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
