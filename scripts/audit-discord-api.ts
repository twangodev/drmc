const specificationFiles = ['openapi.json', 'openapi_preview.json']
const writeMethods = new Set(['post', 'put', 'patch', 'delete'])

const specifications = await Promise.all(specificationFiles.map(async filename => {
  const source = `https://raw.githubusercontent.com/discord/discord-api-spec/main/specs/${filename}`
  const response = await fetch(source, { signal: AbortSignal.timeout(15000), redirect: 'error' })
  if (!response.ok) throw new Error(`Discord API specification returned HTTP ${response.status}`)
  const specification = await response.json() as { paths: Record<string, Record<string, unknown>> }
  if (!specification.paths || typeof specification.paths !== 'object') {
    throw new Error('Discord API specification has no paths')
  }
  const relevantPaths = Object.entries(specification.paths)
    .filter(([path]) => /presence|activit|oauth2\/@me/i.test(path))
    .map(([path, operations]) => ({
      path,
      methods: Object.keys(operations).filter(method => ['get', ...writeMethods].includes(method)).sort(),
    }))
  return {
    source,
    relevantPaths,
    writeCandidates: relevantPaths.filter(route => route.methods.some(method => writeMethods.has(method))),
  }
}))

console.log(JSON.stringify({
  observedAt: new Date().toISOString(),
  gate: 'unverified',
  specifications,
}, null, 2))
