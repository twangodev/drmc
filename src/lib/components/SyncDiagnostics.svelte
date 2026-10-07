<script lang="ts">
  import type { AccountView, SyncEvent } from '$lib/account'
  let { account }: { account: AccountView } = $props()
  const labels: Record<SyncEvent['event'], string> = {
    poll: 'Last.fm checked', published: 'Activity sent', connected: 'Discord connected', disconnected: 'Discord disconnected',
    failed: 'Sync failed', recovered: 'Sync recovered', preferences_saved: 'Preferences saved', paused: 'Sharing paused', resumed: 'Sharing resumed',
  }
  function time(value?: number): string { return value ? new Date(value).toLocaleTimeString() : '—' }
</script>

<section class="mt-6 border-t border-subtle pt-5" aria-labelledby="diagnostics-title">
  <h2 id="diagnostics-title" class="text-sm font-medium">Sync diagnostics</h2>
  <dl class="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 text-xs">
    <div><dt class="text-muted">Discord</dt><dd class="mt-1">{account.connected ? 'Connected' : 'Disconnected'}</dd></div>
    <div><dt class="text-muted">Consecutive failures</dt><dd class="mt-1">{account.consecutiveFailures}</dd></div>
    <div><dt class="text-muted">Last checked</dt><dd class="mt-1 font-mono">{time(account.lastCheckedAt)}</dd></div>
    <div><dt class="text-muted">Next check</dt><dd class="mt-1 font-mono">{time(account.nextCheckAt)}</dd></div>
    <div><dt class="text-muted">Last activity sent</dt><dd class="mt-1 font-mono">{time(account.publishedAt)}</dd></div>
    <div><dt class="text-muted">Last failure</dt><dd class="mt-1 break-words">{account.failure ?? 'None'}</dd></div>
    <div><dt class="text-muted">Discord heartbeat acknowledged</dt><dd class="mt-1 font-mono">{time(account.presence?.lastHeartbeatAcknowledgedAt)}</dd></div>
    <div><dt class="text-muted">Activity echoed by Discord</dt><dd class="mt-1">{account.presence?.activityObservedAt ? time(account.presence.activityObservedAt) : 'No echo received'}</dd></div>
  </dl>
  {#if account.events.length}
    <ol class="mt-5 space-y-3 border-t border-subtle pt-5 text-xs" aria-label="Recent sync events">
      {#each account.events.toReversed() as entry}
        <li class="flex flex-wrap gap-x-3 gap-y-1"><time class="font-mono text-muted" datetime={new Date(entry.at).toISOString()}>{time(entry.at)}</time><span>{labels[entry.event]}</span>{#if entry.reason}<span class="w-full break-words text-muted">{entry.reason}</span>{/if}</li>
      {/each}
    </ol>
  {:else}<p class="mt-5 text-xs text-muted">New sync events will appear here.</p>{/if}
</section>
