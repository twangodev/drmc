import { communityStatistics, type StatisticsSettings } from './cloudflare/community-statistics'

export async function handleStatisticsRequest(request: Request, env: StatisticsSettings): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" }
  if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } })
  try {
    return Response.json(await communityStatistics(env).read(), { headers })
  } catch {
    return Response.json({ error: 'statistics_unavailable' }, { status: 503, headers: { ...headers, 'Retry-After': '30' } })
  }
}
