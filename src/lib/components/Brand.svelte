<script lang="ts">
  let { size = 22 }: { size?: number } = $props()
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M5 9v6m7-11v16m7-11v6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
</svg>
