<script lang="ts">
  import { onMount } from 'svelte'
  import { Moon, Sun } from '@lucide/svelte'

  let theme = $state<'light' | 'dark'>('dark')
  onMount(() => { theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' })

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('drmc-theme', theme) } catch { return }
  }
</script>

<button
  type="button"
  onclick={toggleTheme}
  class="grid size-10 place-items-center rounded-md text-muted hover:bg-surface hover:text-text"
  aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
>
  {#if theme === 'dark'}<Sun size={17} strokeWidth={1.6} aria-hidden="true" />
  {:else}<Moon size={17} strokeWidth={1.6} aria-hidden="true" />{/if}
</button>
