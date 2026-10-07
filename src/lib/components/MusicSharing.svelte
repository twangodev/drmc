<script lang="ts">
  import { Pause, Play } from '@lucide/svelte'
  import type { AccountView } from '$lib/account'
  import ActionForm from './ActionForm.svelte'
  import MusicActivity from './MusicActivity.svelte'

  let { account }: { account: AccountView } = $props()
  const labels: Record<AccountView['status'], string> = {
    link_lastfm: 'Connect Last.fm to start', paused: 'Music sharing paused', listening: 'Sharing your music', idle: 'Waiting for music',
    reconnecting: 'Reconnecting', reauthorize: 'Reconnect Discord', lastfm_reauthorize: 'Reconnect Last.fm', cleanup_pending: 'Finishing disconnect',
  }
  const canPause = $derived(account.lastfmUsername && !['reauthorize', 'lastfm_reauthorize', 'cleanup_pending'].includes(account.status))
</script>

<section class="my-6" aria-label="Music sharing">
  <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
    <p role="status" class="text-xs text-muted">{labels[account.status]}</p>
    {#if canPause}
      <ActionForm action={account.enabled ? '/api/account/pause' : '/api/account/resume'} variant="quiet">
        {#if account.enabled}<Pause size={12} aria-hidden="true" />Pause sharing{:else}<Play size={12} aria-hidden="true" />Resume sharing{/if}
      </ActionForm>
    {/if}
  </div>
  {#if account.track && account.enabled}
    <MusicActivity track={account.track} username={account.lastfmUsername!} preferences={account.preferences} />
  {:else if account.status === 'idle' && account.enabled && account.preferences?.keepStatus}
    <MusicActivity track={null} username={account.lastfmUsername!} preferences={account.preferences} />
  {:else if account.status === 'idle'}
    <p class="mt-6 text-sm text-muted">Play a track on a player connected to Last.fm.</p>
  {/if}
  {#if account.failure && account.status === 'reconnecting'}<p class="mt-4 text-xs text-muted">We’ll retry automatically.</p>{/if}
</section>
