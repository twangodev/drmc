<script lang="ts">
  import type { Snippet } from 'svelte'
  import { page } from '$app/state'
  import Brand from '$lib/components/Brand.svelte'
  import ThemeToggle from '$lib/components/ThemeToggle.svelte'
  import './layout.css'
  let { children }: { children: Snippet } = $props()
</script>

<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:bg-text focus:px-4 focus:py-2 focus:text-bg">Skip to content</a>
<div class="flex min-h-svh flex-col">
  <header class="border-b border-subtle">
    <div class="page-width flex h-16 items-center justify-between gap-4">
      <a href="/" class="flex items-center gap-2 text-base font-semibold tracking-tight" aria-label="DRMC home"><Brand />drmc</a>
      <nav aria-label="Primary" class="flex items-center gap-3 sm:gap-5">
        <a href="/" aria-current={page.url.pathname === '/' ? 'page' : undefined} class="text-xs text-muted hover:text-text aria-[current=page]:text-text">Overview</a>
        <a href="/probe" aria-current={page.url.pathname === '/probe' ? 'page' : undefined} class="text-xs text-muted hover:text-text aria-[current=page]:text-text">Access probe</a>
        <span class="h-4 w-px bg-subtle" aria-hidden="true"></span>
        <ThemeToggle />
      </nav>
    </div>
  </header>
  <main id="main" class="flex flex-1 flex-col" tabindex="-1">{@render children()}</main>
  <footer class="mt-16 border-t border-subtle">
    <div class="page-width flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-5 text-[11px] text-muted">
      <span>Made for the music.</span>
      <span>Free & open source · Apache 2.0</span>
    </div>
  </footer>
</div>
