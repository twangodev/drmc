<script lang="ts">
  import { onMount } from 'svelte'
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import type { AccountView } from '$lib/account'
  import AccountActions from './AccountActions.svelte'
  import AccountConnections from './AccountConnections.svelte'
  import AccountNotice from './AccountNotice.svelte'
  import MusicPreferences from './MusicPreferences.svelte'
  import MusicSharing from './MusicSharing.svelte'
  import PlatformStats from './PlatformStats.svelte'
  import SignIn from './SignIn.svelte'
  import SyncDiagnostics from './SyncDiagnostics.svelte'
  import Button from './ui/Button.svelte'
  import Disclosure from './ui/Disclosure.svelte'

  let account = $state<AccountView | null>(null)
  let enabled = $state(false)
  let loading = $state(true)
  let unavailable = $state(false)
  let pending = false
  const abort = new AbortController()
  const showSettings = $derived(browser && (page.url.searchParams.get('saved') === 'preferences' || page.url.searchParams.get('error') === 'invalid_music_preferences'))

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

<div class="mx-auto w-full max-w-md px-6 py-12 sm:py-20">
  <AccountNotice />
  {#if unavailable}
    <p role="status" class="text-sm text-muted">Your account is temporarily unavailable.</p>
    <Button variant="secondary" onclick={refresh} class="mt-4">Try again</Button>
  {:else if !loading && !enabled}
    <SignIn disabled />
    <p role="status" class="text-center text-xs text-muted">Account linking is being set up. Check back shortly.</p>
  {:else if account}
    <AccountConnections {account} />
    <MusicSharing {account} />
    <Disclosure label="Settings" open={showSettings}>
      <MusicPreferences preferences={account.preferences} />
      <AccountActions lastfmConnected={Boolean(account.lastfmUsername)} />
      {#if account.preferences?.debug}<SyncDiagnostics {account} />{/if}
    </Disclosure>
  {:else}
    <SignIn />
  {/if}
  <noscript><p class="mt-6 text-center text-xs text-muted">Enable JavaScript to manage your music after signing in.</p></noscript>
  <PlatformStats />
</div>
