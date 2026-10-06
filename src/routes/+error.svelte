<script lang="ts">
  import { page } from '$app/state'
</script>

<svelte:head><title>{page.status} · DRMC</title></svelte:head>
<div class="page-width py-20">
  <p class="eyebrow">{page.status}</p>
  <h1 class="mt-4 text-4xl font-semibold tracking-tight">{page.status === 404 ? 'Nothing playing here.' : 'Something went wrong.'}</h1>
  <p class="mt-4 text-sm text-muted">{page.status === 404 ? 'This page could not be found.' : 'Try opening this page again.'}</p>
  <a href="/" class="action action-secondary mt-8">Back to overview</a>
</div>
