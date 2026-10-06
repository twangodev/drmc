import { readProbeConfiguration, type ProbeSettings } from './configuration'

export interface ProbeStatus {
  state: 'disabled' | 'unconfigured' | 'ready'
  publication: 'not_tested'
}

export function readProbeStatus(settings: ProbeSettings): ProbeStatus {
  if (settings.PROBE_ENABLED !== 'true') return { state: 'disabled', publication: 'not_tested' }
  try {
    readProbeConfiguration(settings)
    return { state: 'ready', publication: 'not_tested' }
  } catch {
    return { state: 'unconfigured', publication: 'not_tested' }
  }
}
