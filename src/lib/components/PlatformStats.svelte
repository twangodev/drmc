<script lang="ts">
  import { onMount } from 'svelte'
  import { isPlatformStatistics, statisticsRefreshIntervalMs, scrobbleRefreshIntervalMs, type PlatformStatistics } from '$lib/platform-statistics'
  import Statistic from './ui/Statistic.svelte'

  let statistics = $state<PlatformStatistics | null>(null)
  let unavailable = $state(false)
  let pending = false
  const abort = new AbortController()
  const metrics = $derived([
    { label: 'Members', value: statistics?.members },
    { label: 'Sharing now', value: statistics?.sharingNow },
    { label: 'Last.fm scrobbles', value: statistics?.scrobbles },
  ])
  const totalsDelayed = $derived(statistics?.scrobblesUpdatedAt != null && statistics.sampledAt - statistics.scrobblesUpdatedAt > scrobbleRefreshIntervalMs + 60_000)

  async function refresh() {
    if (pending) return
    pending = true
    try {
      const response = await fetch('/api/stats', { cache: 'no-store', signal: abort.signal })
      if (!response.ok) throw new Error('Statistics unavailable')
      const result: unknown = await response.json()
      if (!isPlatformStatistics(result)) throw new Error('Invalid statistics')
      statistics = result
      unavailable = false
    } catch { if (!abort.signal.aborted) unavailable = true }
    finally { pending = false }
  }

  onMount(() => {
    void refresh()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, statisticsRefreshIntervalMs)
    return () => { clearInterval(timer); abort.abort() }
  })
</script>

<section class="mt-12 border-t border-subtle pt-5" aria-label="Platform statistics">
  <dl class="grid grid-cols-3 gap-3">
    {#each metrics as metric (metric.label)}
      <Statistic label={metric.label} value={metric.value} />
    {/each}
  </dl>
  <p class="mt-3 text-[11px] leading-relaxed text-muted">
    {#if unavailable}Statistics temporarily unavailable.
    {:else if statistics?.scrobbles === null}Updating Last.fm totals…
    {:else if totalsDelayed}Last.fm totals are waiting for an update.
    {:else}Lifetime Last.fm totals · refresh every 5 minutes.{/if}
  </p>
</section>
