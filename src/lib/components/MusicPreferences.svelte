<script lang="ts">
  import { defaultMusicPreferences, type MusicPreferences } from '$lib/music-preferences'
  import Button from './ui/Button.svelte'
  import Select from './ui/Select.svelte'
  import Switch from './ui/Switch.svelte'

  let { preferences = defaultMusicPreferences }: { preferences?: Readonly<MusicPreferences> } = $props()
  let draft = $state<MusicPreferences>({ ...defaultMusicPreferences })
  let saved = ''
  const statusOptions = [{ value: 'song', label: 'Song title' }, { value: 'artist', label: 'Artist' }] satisfies { value: MusicPreferences['statusDisplay']; label: string }[]
  const controls = [
    { key: 'showCovers', label: 'Show album covers' },
    { key: 'showElapsed', label: 'Show elapsed time' },
    { key: 'showLoved', label: 'Show loved-track heart' },
    { key: 'showProfile', label: 'Show profile button' },
    { key: 'keepStatus', label: 'Keep status when idle' },
    { key: 'debug', label: 'Show sync diagnostics' },
  ] as const

  $effect(() => {
    const current = JSON.stringify(preferences)
    if (current !== saved) { draft = { ...defaultMusicPreferences, ...preferences }; saved = current }
  })
</script>

<form method="post" action="/api/account/preferences" data-sveltekit-reload class="pt-2" aria-label="Presence preferences">
  <div class="space-y-4">
    <div>
      <label for="listening-status" class="mb-2 block text-sm">Listening status</label>
      <Select id="listening-status" name="statusDisplay" label="Listening status" items={statusOptions} bind:value={draft.statusDisplay} />
    </div>
    <div class="space-y-1">
      {#each controls as control (control.key)}
        <Switch name={control.key} label={control.label} bind:checked={draft[control.key]} />
      {/each}
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <label for="refresh-interval" class="text-sm">Refresh interval (seconds)</label>
      <input id="refresh-interval" name="refreshInterval" type="number" min="1" max="3600" step="1" required bind:value={draft.refreshInterval} class="min-h-10 w-20 rounded-md border border-subtle bg-bg px-3 text-sm" />
    </div>
  </div>
  <Button type="submit" class="mt-5 w-full">Save preferences</Button>
</form>
