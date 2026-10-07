<script lang="ts">
  import type { AccountView } from '$lib/account'
  import ActionForm from './ActionForm.svelte'
  let { account }: { account: AccountView } = $props()
</script>

<header>
  <h1 class="text-xl font-medium tracking-tight">{account.lastfmUsername ? `@${account.lastfmUsername}` : 'Connect Last.fm'}</h1>
  <p class="mt-1 text-xs text-muted">Last.fm → Discord</p>
</header>

{#if account.status === 'reauthorize'}
  <div class="mt-6"><ActionForm action="/auth/discord/start">Reconnect Discord</ActionForm></div>
{:else if !account.lastfmUsername || account.status === 'lastfm_reauthorize'}
  <p class="mt-6 text-sm text-muted">Connect the account that tracks your music.</p>
  <div class="mt-4"><ActionForm action="/auth/lastfm/start">{account.status === 'lastfm_reauthorize' ? 'Reconnect Last.fm' : 'Connect Last.fm'}</ActionForm></div>
{/if}
