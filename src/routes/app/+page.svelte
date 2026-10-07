<script lang="ts">
  import { onMount } from 'svelte'
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import { ArrowRight, Music2, Check, Pause, Play } from '@lucide/svelte'
  import type { AccountView } from '$lib/account'
  import MusicPreferences from '$lib/components/MusicPreferences.svelte'
  import MusicActivity from '$lib/components/MusicActivity.svelte'
  import SyncDiagnostics from '$lib/components/SyncDiagnostics.svelte'

  let account = $state<AccountView | null>(null)
  let enabled = $state(false)
  let loading = $state(true)
  let unavailable = $state(false)
  let pending = false
  const abort = new AbortController()
  const labels: Record<AccountView['status'], string> = {
    link_lastfm: 'Connect Last.fm to start', paused: 'Music sharing paused', listening: 'Sharing your music', idle: 'Waiting for music',
    reconnecting: 'Reconnecting', reauthorize: 'Reconnect Discord', lastfm_reauthorize: 'Reconnect Last.fm', cleanup_pending: 'Finishing disconnect',
  }
  const errors: Record<string, string> = {
    discord_authorization_denied: 'Discord authorization was cancelled. You can try again.',
    discord_authorization_failed: 'Discord could not be connected. Check the application’s callback URL and try again.',
    discord_presence_scope_missing: 'Discord did not grant access to share your Listening activity.',
    lastfm_authorization_denied: 'Last.fm authorization was cancelled. You can try again.',
    lastfm_authorization_incomplete: 'Last.fm did not return a usable authorization token. Please start again.',
    lastfm_authorization_failed: 'Last.fm could not be connected. Please try again.',
    invalid_authorization_state: 'That authorization link expired or has already been used. Please start again.',
    sign_in_required: 'Sign in with Discord before connecting Last.fm.',
    discord_cleanup_pending: 'Music sharing has stopped. We are still retrying the removal of your Discord authorization.',
    invalid_music_preferences: 'Choose Song title or Artist and a whole-number refresh interval between 1 and 3,600 seconds, then try again.',
    service_unavailable: 'Your changes could not be saved. Please try again.',
  }
  const authorizationError = $derived(browser ? errors[page.url.searchParams.get('error') ?? ''] : undefined)
  const preferencesSaved = $derived(browser && page.url.searchParams.get('saved') === 'preferences')

  async function refresh() {
    if (pending) return
    pending = true
    try {
      const response = await fetch('/api/account', { cache: 'no-store', signal: abort.signal })
      if (!response.ok && response.status !== 401) throw new Error('Account unavailable')
      const result = await response.json() as { enabled: boolean; account: AccountView | null }
      enabled = result.enabled
      account = result.account
      unavailable = false
    } catch { if (!abort.signal.aborted) unavailable = true }
    finally { pending = false; loading = false }
  }

  onMount(() => {
    void refresh()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 10_000)
    return () => { clearInterval(timer); abort.abort() }
  })
</script>

<svelte:head>
  <title>Your music · DRMC</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page-width max-w-3xl pt-12 sm:pt-20">
  <p class="eyebrow">Your music</p>
  <h1 class="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Connect once.<br />Keep listening.</h1>
  <p class="mt-5 max-w-lg text-sm leading-relaxed text-muted">Connect Discord and Last.fm, then put some music on. Your Listening activity keeps updating after you close this tab.</p>

  {#if authorizationError}
    <p role="alert" class="mt-6 rounded-md border border-subtle bg-surface p-4 text-sm">{authorizationError}</p>
  {/if}
  {#if preferencesSaved}<p role="status" class="mt-6 rounded-md border border-subtle bg-surface p-4 text-sm">Preferences saved.</p>{/if}
  <noscript><p class="mt-6 text-sm text-muted">JavaScript is required to view your accounts and music sharing controls.</p></noscript>

  {#if loading}
    <p role="status" class="mt-10 text-sm text-muted">Checking your accounts…</p>
  {:else if unavailable}
    <div class="mt-10 rounded-md border border-subtle p-5">
      <p role="status" class="text-sm">Your account is temporarily unavailable.</p>
      <button class="action action-secondary mt-4" onclick={refresh}>Try again</button>
    </div>
  {:else if !enabled}
    <p role="status" class="mt-10 rounded-md border border-subtle p-5 text-sm text-muted">Account linking is being set up. Please check back shortly.</p>
  {:else}
    <section class="mt-10 rounded-lg border border-subtle" aria-label="Connected accounts">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-subtle p-5 sm:p-6">
        <div class="flex items-center gap-4">
          <span class="font-mono text-xs text-muted">01</span>
          <div><h2 class="font-medium">Discord</h2><p class="mt-1 text-xs text-muted">{account ? `Connected · ${account.userId}` : 'Sign in and allow your Listening activity'}</p></div>
        </div>
        {#if account && account.status !== 'reauthorize'}
          <span class="flex items-center gap-2 text-xs text-muted"><Check size={14} aria-hidden="true" />Connected</span>
        {:else}
          <form method="post" action="/auth/discord/start"><button class="action action-primary">{account ? 'Reconnect Discord' : 'Connect Discord'}<ArrowRight size={14} aria-hidden="true" /></button></form>
        {/if}
      </div>
      <div class="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div class="flex items-center gap-4">
          <span class="font-mono text-xs text-muted">02</span>
          <div><h2 class="font-medium">Last.fm</h2><p class="mt-1 text-xs text-muted">{account?.lastfmUsername ? `Connected · ${account.lastfmUsername}` : 'Verify the account that tracks your music'}</p></div>
        </div>
        {#if account?.lastfmUsername && account.status !== 'lastfm_reauthorize'}
          <form method="post" action="/auth/lastfm/start"><button class="text-link text-xs">Change Last.fm account</button></form>
        {:else}
          <form method="post" action="/auth/lastfm/start"><button class="action action-secondary disabled:cursor-default disabled:opacity-40" disabled={!account}>{account?.status === 'lastfm_reauthorize' ? 'Reconnect Last.fm' : 'Connect Last.fm'}<ArrowRight size={14} aria-hidden="true" /></button></form>
        {/if}
      </div>
    </section>

    {#if account}
      <section class="mt-6 rounded-lg border border-subtle bg-surface p-5 sm:p-6" aria-labelledby="sharing-title">
        <div class="flex items-center justify-between gap-4">
          <div><p class="eyebrow">Listening activity</p><h2 id="sharing-title" role="status" class="mt-2 text-base font-medium">{labels[account.status]}</h2></div>
          <Music2 size={24} class="text-muted" aria-hidden="true" />
        </div>
        {#if account.track && account.enabled}
          <MusicActivity track={account.track} username={account.lastfmUsername!} preferences={account.preferences} />
        {:else}
          <p class="mt-4 text-sm leading-relaxed text-muted">{account.status === 'paused' ? 'Resume whenever you want to share your music again.' : account.status === 'reauthorize' ? 'Sign in with Discord again to restore music sharing.' : account.status === 'lastfm_reauthorize' ? 'Reconnect Last.fm above to restore music sharing.' : account.lastfmUsername ? `Play a track using a player connected to Last.fm. We check for music every ${account.preferences?.refreshInterval ?? 10} seconds.` : 'Connect Last.fm above to finish setting up.'}</p>
          {#if account.status === 'idle' && account.enabled && account.preferences?.keepStatus}<MusicActivity track={null} username={account.lastfmUsername!} preferences={account.preferences} />{/if}
        {/if}
        {#if account.failure && account.status === 'reconnecting'}<p class="mt-4 text-xs text-muted">We will retry automatically. Recent music stays visible briefly while the connection recovers.</p>{/if}
        {#if account.lastfmUsername && !['reauthorize', 'lastfm_reauthorize'].includes(account.status)}
          <form method="post" action={account.enabled ? '/api/account/pause' : '/api/account/resume'} class="mt-5"><button class="action action-secondary">{#if account.enabled}<Pause size={14} aria-hidden="true" />Pause sharing{:else}<Play size={14} aria-hidden="true" />Resume sharing{/if}</button></form>
        {/if}
      </section>
      <MusicPreferences preferences={account.preferences} />
      {#if account.preferences?.debug}<SyncDiagnostics {account} />{/if}
      <div class="mt-6 flex flex-wrap items-center justify-between gap-4 text-xs text-muted">
        <form method="post" action="/api/account/logout"><button class="text-link">Sign out</button></form>
        <form method="post" action="/api/account/disconnect"><button class="text-link">Disconnect accounts</button></form>
      </div>
      <p class="mt-4 text-xs leading-relaxed text-muted">Signing out keeps your music sharing running. Disconnecting stops sharing and removes your stored accounts.</p>
    {/if}
  {/if}
</div>
