<script lang="ts">
  import { onMount } from 'svelte'
  import { ArrowRight, FlaskConical } from '@lucide/svelte'
  import { fetchProbeStatus } from '$lib/probe'
  import Button from '$lib/components/ui/Button.svelte'
  import StatusBadge from '$lib/components/ui/StatusBadge.svelte'
  import type { ProbeStatus } from '$lib/server/probe/status'

  let state = $state<ProbeStatus['state'] | 'loading' | 'unavailable'>('loading')
  const statusMessages = {
    loading: { label: 'Checking availability', description: 'JavaScript is required to check whether the operator has enabled this probe.' },
    disabled: { label: 'Probe disabled', description: 'The operator has disabled this development probe.' },
    unconfigured: { label: 'Setup required', description: 'The operator must configure the development application, test accounts, and access key.' },
    ready: { label: 'Ready for a test', description: 'Enter the operator access key to continue to Discord’s authorization screen.' },
    unavailable: { label: 'Status unavailable', description: 'The probe’s availability could not be checked. Reload this page to try again.' },
  }
  const availability = $derived(statusMessages[state])
  onMount(() => {
    const controller = new AbortController()
    fetchProbeStatus(controller.signal).then(status => { state = status.state })
      .catch(() => { if (!controller.signal.aborted) state = 'unavailable' })
    return () => controller.abort()
  })
</script>

<svelte:head>
  <title>Discord access probe · DRMC</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page-width pt-12 sm:pt-16">
  <p class="eyebrow flex items-center gap-2"><FlaskConical size={14} aria-hidden="true" />Development tools</p>
  <h1 class="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Discord access probe</h1>
  <p class="mt-4 max-w-xl text-base leading-relaxed text-muted">Test Discord authorization, refresh, and revocation. Optionally publish a temporary Listening activity to check your profile.</p>

  <div class="mt-10 grid gap-8 md:grid-cols-[1.2fr_1fr] md:gap-12">
    <section class="rounded-lg border border-subtle bg-surface p-5 sm:p-6" aria-labelledby="authorization-title">
      <div role="status" aria-live="polite"><StatusBadge>{availability.label}</StatusBadge></div>
      <h2 id="authorization-title" class="mt-5 text-xl font-medium tracking-tight">Check Discord access</h2>
      <p class="mt-2 text-sm leading-relaxed text-muted">{availability.description}</p>
      <form action="/probe/start" method="post" data-sveltekit-reload class="mt-6">
        <label for="access-key" class="block text-xs font-medium">Operator access key</label>
        <input id="access-key" name="access_key" type="password" required autocomplete="off" disabled={state !== 'ready'} aria-describedby="key-help"
          class="mt-2 h-11 w-full rounded-md border border-subtle bg-bg px-3 text-sm disabled:opacity-40" />
        <p id="key-help" class="mt-2 text-[11px] leading-relaxed text-muted">For allowlisted development accounts. Keep this key private.</p>
        <label class="mt-5 flex items-start gap-3 text-sm leading-relaxed">
          <input type="checkbox" name="experiment" value="presence" disabled={state !== 'ready'} aria-describedby="presence-help" class="mt-1 accent-current" />
          <span>Publish a 45-second test activity</span>
        </label>
        <p id="presence-help" class="mt-2 text-[11px] leading-relaxed text-muted">After authorizing, check your Discord profile for “Cloudflare presence test” while this page waits. Enable Discord’s activity sharing so it can appear. The test then clears the activity and revokes access.</p>
        <Button type="submit" disabled={state !== 'ready'} class="mt-6 w-full">Continue to Discord <ArrowRight size={15} aria-hidden="true" /></Button>
      </form>
    </section>

    <aside class="py-1" aria-labelledby="consent-title">
      <h2 id="consent-title" class="text-sm font-medium">What you’re authorizing</h2>
      <p class="mt-3 text-sm leading-relaxed text-muted">The probe requests your Discord identity and Social SDK presence access. The presence scope also covers social features; review Discord’s consent screen before continuing.</p>
      <h3 class="mt-7 text-sm font-medium">What happens next</h3>
      <ol class="mt-3 space-y-3 text-sm leading-relaxed text-muted">
        <li><span class="mr-2 font-mono text-[10px]">01</span>Check the application and test account.</li>
        <li><span class="mr-2 font-mono text-[10px]">02</span>Refresh and inspect the authorization.</li>
        <li><span class="mr-2 font-mono text-[10px]">03</span>If selected, publish and clear a test activity.</li>
        <li><span class="mr-2 font-mono text-[10px]">04</span>Revoke the grant and return a JSON report.</li>
      </ol>
      <p class="mt-7 border-t border-subtle pt-4 text-xs leading-relaxed text-muted">If revocation fails or the callback is interrupted, remove the development application in Discord’s Authorized Apps settings.</p>
    </aside>
  </div>
</div>
