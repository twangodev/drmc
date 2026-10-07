<script lang="ts">
  import { browser } from '$app/environment'
  import { page } from '$app/state'

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
  const error = $derived(browser ? errors[page.url.searchParams.get('error') ?? ''] : undefined)
  const saved = $derived(browser && page.url.searchParams.get('saved') === 'preferences')
</script>

{#if error}<p role="alert" class="mb-6 text-sm leading-relaxed">{error}</p>{/if}
{#if saved}<p role="status" class="mb-6 text-xs text-muted">Preferences saved.</p>{/if}
