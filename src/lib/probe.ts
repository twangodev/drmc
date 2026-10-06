import type { ProbeStatus } from './server/probe/status'

export async function fetchProbeStatus(signal: AbortSignal): Promise<ProbeStatus> {
  const response = await fetch('/api/probe', { cache: 'no-store', signal })
  if (!response.ok) throw new Error('probe_status_unavailable')
  const status: unknown = await response.json()
  if (!status || typeof status !== 'object' || !('state' in status) || !('publication' in status)
    || !['disabled', 'unconfigured', 'ready'].includes(String(status.state)) || status.publication !== 'not_tested') {
    throw new Error('invalid_probe_status')
  }
  return status as ProbeStatus
}
