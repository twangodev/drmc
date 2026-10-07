<script lang="ts">
  import { Heart, Music2 } from '@lucide/svelte'
  import { lastfmProfileUrl, lastfmTrackUrl, listeningActivityName, type ListeningTrack } from '$lib/music'
  import { defaultMusicPreferences, type MusicPreferences } from '$lib/music-preferences'

  let { track, username, preferences = defaultMusicPreferences }: { track: ListeningTrack | null; username: string; preferences?: Readonly<MusicPreferences> } = $props()
  let now = $state(Date.now())
  let failedArtwork = $state<string>()
  const elapsed = $derived(Math.max(0, Math.floor((now - (track?.startedAt ?? now)) / 1000)))
  const artwork = $derived(preferences.showCovers && track?.artwork !== failedArtwork ? track?.artwork : undefined)
  $effect(() => {
    const timer = setInterval(() => { now = Date.now() }, 1000)
    return () => clearInterval(timer)
  })
</script>

<div class="mt-4" aria-label="Discord activity preview">
  <p class="text-xs text-muted break-words">{track ? `Listening to ${listeningActivityName(track, preferences.statusDisplay)}` : 'Playing Last.fm'}</p>
  <div class="mt-3 flex items-start gap-4">
    {#if preferences.showCovers || !track}
      <div class="relative size-16 shrink-0 rounded-md bg-raised">
        {#if artwork}<img src={artwork} alt={track?.album || 'Album cover'} class="size-full rounded-md object-cover" referrerpolicy="no-referrer" onerror={() => { failedArtwork = artwork }} />
        {:else}<div class="flex size-full items-center justify-center font-semibold text-muted">last.fm</div>{/if}
        {#if track}<span class="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border-2 border-surface bg-raised">{#if preferences.showLoved && track.loved}<Heart size={12} fill="currentColor" aria-label="Loved track" />{:else}<Music2 size={12} aria-hidden="true" />{/if}</span>{/if}
      </div>
    {/if}
    <div class="min-w-0 text-sm">
      <p class="font-medium break-words">{track?.title ?? 'DRMC'}</p>
      <p class="mt-1 text-muted break-words">{track ? `by ${track.artist}` : '1.0.0'}</p>
      {#if track?.album}<p class="mt-1 text-xs text-muted break-words">{track.album}</p>{/if}
      {#if track && preferences.showLoved && track.loved}<p class="mt-2 flex items-center gap-1 text-xs text-muted"><Heart size={12} fill="currentColor" aria-hidden="true" />Loved on Last.fm</p>{/if}
      {#if track?.startedAt && preferences.showElapsed}<p class="mt-2 font-mono text-xs text-muted">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} elapsed</p>{/if}
    </div>
  </div>
  {#if track}
    <div class="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
      {#if preferences.showProfile}<a class="text-link" href={lastfmProfileUrl(username)} target="_blank" rel="noopener noreferrer">Last.fm profile</a>{/if}
      <a class="text-link" href={track.url ?? lastfmTrackUrl(track)} target="_blank" rel="noopener noreferrer">View track</a>
    </div>
  {/if}
</div>
