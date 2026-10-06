<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchProbeStatus } from '$lib/probe'
  import type { ProbeStatus } from '$lib/server/probe/status'

  let state = $state<ProbeStatus['state'] | 'loading' | 'unavailable'>('loading')
  onMount(() => {
    const controller = new AbortController()
    fetchProbeStatus(controller.signal).then(status => { state = status.state })
      .catch(() => { if (!controller.signal.aborted) state = 'unavailable' })
    return () => controller.abort()
  })
</script>

<svelte:head><title>Discord access probe · DRMC</title></svelte:head>
<h1>Discord access probe</h1>
<p>Checks OAuth scope access, token refresh, and revocation. Presence publishing remains unverified.</p>
<p>The Social SDK presence scope also covers social features. Review Discord's consent screen.</p>
<p role="status">Probe: {state}</p>
<form action="/probe/start" method="post" data-sveltekit-reload>
  <label>Operator access key <input name="access_key" type="password" required autocomplete="off" disabled={state !== 'ready'} /></label>
  <button type="submit" disabled={state !== 'ready'}>Check Discord access</button>
</form>
<noscript>JavaScript is required to check whether the operator has enabled this probe.</noscript>
