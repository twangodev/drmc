<script lang="ts">
  import { AudioLines, Cloud, Music2 } from '@lucide/svelte'
  import Brand from './Brand.svelte'

  const route = [
    { name: 'Last.fm', detail: 'What you’re listening to', icon: Music2, marker: '01' },
    { name: 'DRMC', detail: 'The connection in between', icon: Cloud, marker: '02' },
    { name: 'Discord', detail: 'A Listening activity', icon: AudioLines, marker: '03' },
  ]
</script>

<figure class="overflow-hidden rounded-lg border border-subtle bg-surface">
  <figcaption class="flex items-center justify-between border-b border-subtle px-5 py-4">
    <span class="eyebrow">The planned connection</span>
    <Brand size={16} />
  </figcaption>
  <ol class="px-5 py-3">
    {#each route as service (service.name)}
      <li class="flex items-center gap-4 py-4">
        <div class="grid size-10 shrink-0 place-items-center rounded-md border border-subtle bg-bg text-text/75">
          <service.icon size={18} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">{service.name}</p>
          <p class="mt-0.5 text-xs text-muted">{service.detail}</p>
        </div>
        <span class="font-mono text-[10px] text-muted">{service.marker}</span>
      </li>
    {/each}
  </ol>
  <div class="border-t border-subtle px-5 py-3 text-[11px] text-muted">A service in development. No accounts connected.</div>
</figure>
