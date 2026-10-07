<script lang="ts">
  import type { Snippet } from 'svelte'
  import Brand from '$lib/components/Brand.svelte'
  import ThemeToggle from '$lib/components/ThemeToggle.svelte'
  import './layout.css'
  let { children }: { children: Snippet } = $props()
</script>

<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:bg-text focus:px-4 focus:py-2 focus:text-bg">Skip to content</a>
<div class="flex min-h-svh flex-col">
  <header class="flex h-16 items-center justify-between px-6 sm:px-8">
    <a href="/" class="flex items-center gap-2 text-sm font-medium tracking-tight" aria-label="drmc home"><Brand size={18} />drmc</a>
    <ThemeToggle />
  </header>
  <main id="main" class="flex flex-1 flex-col" tabindex="-1">{@render children()}</main>
</div>
