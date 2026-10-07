<script lang="ts">
  import { defaultMusicPreferences, type MusicPreferences } from '$lib/music-preferences'

  let { preferences = defaultMusicPreferences }: { preferences?: Readonly<MusicPreferences> } = $props()
  let draft = $state<MusicPreferences>({ ...defaultMusicPreferences })
  let saved = ''
  const controls = [
    { key: 'showProfile', label: 'Show profile button', detail: 'Include a link to your Last.fm profile.' },
    { key: 'showLoved', label: 'Show loved-track heart', detail: 'Use a heart badge for tracks you have loved on Last.fm.' },
    { key: 'showCovers', label: 'Show album covers', detail: 'Include album artwork in your Discord activity.' },
    { key: 'showElapsed', label: 'Show elapsed time', detail: 'Count from when we first see the track playing.' },
    { key: 'keepStatus', label: 'Keep status when idle', detail: 'Show DRMC on Discord between tracks.' },
    { key: 'debug', label: 'Show sync diagnostics', detail: 'Keep the latest 20 sync events for troubleshooting.' },
  ] as const

  $effect(() => {
    const current = JSON.stringify(preferences)
    if (current !== saved) { draft = { ...defaultMusicPreferences, ...preferences }; saved = current }
  })
</script>

<section class="mt-6 rounded-lg border border-subtle p-5 sm:p-6" aria-labelledby="preferences-title">
  <p class="eyebrow">Make it yours</p>
  <h2 id="preferences-title" class="mt-2 font-medium">Presence preferences</h2>
  <form method="post" action="/api/account/preferences" class="mt-5">
    <div class="space-y-5">
      <div>
        <label for="listening-status" class="block text-sm">Listening status</label>
        <p id="listening-status-hint" class="mt-1 text-xs leading-relaxed text-muted">Choose what follows “Listening to” on Discord.</p>
        <select id="listening-status" name="statusDisplay" bind:value={draft.statusDisplay} aria-describedby="listening-status-hint" class="mt-3 min-h-10 w-full rounded-md border border-subtle bg-bg px-3 text-sm">
          <option value="song">Song title</option>
          <option value="artist">Artist</option>
        </select>
      </div>
      {#each controls as control}
        <label class="flex cursor-pointer items-start justify-between gap-5">
          <span><span class="block text-sm">{control.label}</span><span class="mt-1 block text-xs leading-relaxed text-muted">{control.detail}</span></span>
          <input type="checkbox" name={control.key} bind:checked={draft[control.key]} class="mt-1 size-4 shrink-0 accent-text" />
        </label>
      {/each}
      <div class="border-t border-subtle pt-5">
        <label for="refresh-interval" class="block text-sm">Refresh interval (seconds)</label>
        <p id="refresh-hint" class="mt-1 text-xs leading-relaxed text-muted">Check Last.fm every 1–3,600 seconds. The default is 10.</p>
        <input id="refresh-interval" name="refreshInterval" type="number" min="1" max="3600" step="1" required bind:value={draft.refreshInterval} aria-describedby="refresh-hint" class="mt-3 min-h-10 w-28 rounded-md border border-subtle bg-bg px-3 text-sm" />
      </div>
    </div>
    <button class="action action-primary mt-6">Save preferences</button>
    <p class="mt-3 text-xs leading-relaxed text-muted">Saved preferences apply after you close this tab. Each track always includes a link to its Last.fm page.</p>
  </form>
</section>
