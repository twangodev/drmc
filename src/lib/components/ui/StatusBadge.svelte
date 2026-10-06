<script lang="ts">
  import type { Snippet } from 'svelte'
  let { children }: { children: Snippet } = $props()
</script>

<span class="inline-flex items-center gap-2 rounded-full border border-subtle px-2.5 py-1 font-mono text-[10px] text-muted">
  <span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
  {@render children()}
</span>
