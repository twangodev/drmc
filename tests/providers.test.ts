import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { Miniflare, Response as RuntimeResponse, type Request as RuntimeRequest } from 'miniflare'

const token = 'Z'.repeat(32)
const apiKey = 'b'.repeat(32)
const apiSecret = 'c'.repeat(32)

test('Last.fm web authentication and AES credentials run in workerd without exposing secrets', async context => {
  let providerMode = 'playing'
  const modules: Record<string, { type: 'esm'; contents: string }> = {}
  for (const name of ['lastfm/client', 'accounts/credentials', 'discord/gateway-protocol']) {
    const path = `src/lib/server/${name}.js`
    modules[path] = { type: 'esm', contents: stripTypeScriptTypes(readFileSync(`src/lib/server/${name}.ts`, 'utf8')).replace("'../discord/gateway-protocol'", "'../discord/gateway-protocol.js'") }
  }
  modules['index.js'] = { type: 'esm', contents: `
    import {LastfmClient,lastfmSignature} from './src/lib/server/lastfm/client.js';
    import {CredentialVault} from './src/lib/server/accounts/credentials.js';
    const client = new LastfmClient('${apiKey}','${apiSecret}');
    export default {async fetch(request) {
      const path = new URL(request.url).pathname;
      if(path==='/signature')return Response.json(await lastfmSignature({token:'${token}',method:'auth.getSession',api_key:'${apiKey}',format:'json'},'${apiSecret}'));
      if(path==='/vault'){
        const vault = new CredentialVault('d'.repeat(64));
        const first=await vault.seal({token:'secret-value'},'account:1');
        const second=await vault.seal({token:'secret-value'},'account:1');
        const opened=await vault.open(first,'account:1');
        let rejected=false;try{await vault.open(first,'account:2')}catch{rejected=true}
        let tamperRejected=false;try{await vault.open(first.slice(0,-4)+'AAAA','account:1')}catch{tamperRejected=true}
        return Response.json({distinct:first!==second,encrypted:!first.includes('secret-value'),opened,rejected,tamperRejected});
      }
      if(path==='/session')return Response.json(await client.exchange('${token}'));
      try{return Response.json({track:await client.nowPlaying('twangodev')})}catch(error){return Response.json({reason:error.reason},{status:502})}
    }};` }
  const runtime = new Miniflare({ telemetry: { enabled: false }, cf: false, workers: [{ config: { name: 'providers', compatibilityDate: '2026-10-05', manifest: { mainModule: 'index.js', modules } }, dev: { outboundService: { type: 'fetcher', handler: async (request: RuntimeRequest) => {
    assert.equal(request.url, 'https://ws.audioscrobbler.com/2.0/')
    const parameters = new URLSearchParams(await request.text())
    assert.equal(parameters.get('api_key'), apiKey)
    if (parameters.get('method') === 'auth.getSession') {
      const expected = createHash('md5').update(`api_key${apiKey}methodauth.getSessiontoken${token}${apiSecret}`).digest('hex')
      assert.equal(parameters.get('api_sig'), expected)
      return RuntimeResponse.json({ session: { name: 'twangodev', key: token } })
    }
    assert.equal(parameters.get('method'), 'user.getrecenttracks')
    assert.equal(parameters.get('user'), 'twangodev')
    if (providerMode === 'failure') return RuntimeResponse.json({ error: 29, message: 'PRIVATE PROVIDER BODY' })
    if (providerMode === 'malformed') return RuntimeResponse.json({ recenttracks: {} })
    if (providerMode === 'idle') return RuntimeResponse.json({ recenttracks: { track: [] } })
    return RuntimeResponse.json({ recenttracks: { track: [{ name: 'Everything In Its Right Place', artist: { name: 'Radiohead' }, album: { '#text': 'Kid A' }, image: [{ '#text': 'https://lastfm.freetls.fastly.net/i/u/300x300/cover.png' }], '@attr': { nowplaying: 'true' } }] } })
  } } } }] })
  context.after(() => runtime.dispose())
  const fetchJson = async (path: string) => { const response = await runtime.dispatchFetch(`https://providers.test${path}`); const body = await response.text(); assert.ok(response.headers.get('Content-Type')?.includes('application/json'), path + ': ' + body); return JSON.parse(body) }
  assert.equal(await fetchJson('/signature'), createHash('md5').update(`api_key${apiKey}methodauth.getSessiontoken${token}${apiSecret}`).digest('hex'))
  assert.deepEqual(await fetchJson('/session'), { username: 'twangodev', key: token })
  assert.deepEqual(await fetchJson('/vault'), { distinct: true, encrypted: true, opened: { token: 'secret-value' }, rejected: true, tamperRejected: true })
  assert.deepEqual(await fetchJson('/track'), { track: { title: 'Everything In Its Right Place', artist: 'Radiohead', album: 'Kid A', artwork: 'https://lastfm.freetls.fastly.net/i/u/300x300/cover.png' } })
  providerMode = 'idle'; assert.deepEqual(await fetchJson('/track'), { track: null })
  providerMode = 'malformed'; assert.deepEqual(await fetchJson('/track'), { reason: 'invalid_track_response' })
  providerMode = 'failure'; assert.deepEqual(await fetchJson('/track'), { reason: 'rate_limited' })
})
