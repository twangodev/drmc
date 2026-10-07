<script lang="ts">
  import ActionForm from './ActionForm.svelte'
  let { lastfmConnected }: { lastfmConnected: boolean } = $props()
</script>

<div class="mt-6 border-t border-subtle pt-3">
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
    {#if lastfmConnected}<ActionForm action="/auth/lastfm/start" variant="quiet">Change Last.fm</ActionForm>{/if}
    <ActionForm action="/api/account/logout" variant="quiet">Sign out</ActionForm>
    <ActionForm action="/api/account/disconnect" variant="quiet">Disconnect accounts</ActionForm>
  </div>
  <p class="mt-2 text-xs leading-relaxed text-muted">Signing out keeps sharing. Disconnecting stops it.</p>
</div>
