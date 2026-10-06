<script lang="ts">
  import type { Snippet } from 'svelte'
  import './layout.css'
  let { children }: { children: Snippet } = $props()
</script>

<header><a href="/">drmc</a> <a href="/probe">Discord access probe</a></header>
<main>{@render children()}</main>
