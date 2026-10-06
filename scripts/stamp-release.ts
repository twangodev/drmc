import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const revision = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error('A valid source revision is required')
writeFileSync('build/release.json', `${JSON.stringify({ revision })}\n`)
console.log(`Release built from ${revision}`)
