<script lang="ts">
  import { ArrowRight } from '@lucide/svelte'
  import MusicRoute from '$lib/components/MusicRoute.svelte'
  import StatusBadge from '$lib/components/ui/StatusBadge.svelte'

  const steps = [
    { number: '01', title: 'Connect your accounts', description: 'Authorize Discord and verify your Last.fm account in your browser.' },
    { number: '02', title: 'Put some music on', description: 'Last.fm supplies the track, artist, and available album artwork.' },
    { number: '03', title: 'Let it follow along', description: 'DRMC updates your Listening activity, even with the tab closed.' },
  ]
</script>

<svelte:head>
  <title>DRMC · Your music, on Discord</title>
  <meta name="description" content="Share your Last.fm music as a Discord Listening activity, even with your browser closed." />
</svelte:head>

<div class="page-width">
  <section class="grid items-center gap-12 pt-14 pb-14 sm:pt-24 sm:pb-20 md:grid-cols-[1.25fr_1fr] md:gap-16" aria-labelledby="intro-title">
    <div>
      <StatusBadge>Early access</StatusBadge>
      <h1 id="intro-title" class="mt-6 text-5xl leading-[1.02] font-semibold tracking-[-0.055em] sm:text-6xl lg:text-7xl">Your music,<br />on Discord.</h1>
      <p class="mt-6 max-w-sm text-base leading-relaxed text-muted">Your Last.fm listening, shared as a Discord activity. Keeps going after you close the tab.</p>
      <div class="mt-8 flex flex-wrap items-center gap-4">
        <a href="/app" class="action action-primary">Connect your accounts <ArrowRight size={15} aria-hidden="true" /></a>
        <a href="#how-it-works" class="text-sm text-muted hover:text-text">How it works <span aria-hidden="true">↓</span></a>
      </div>
    </div>
    <MusicRoute />
  </section>

  <section class="flex flex-col gap-3 rounded-md border border-subtle px-5 py-4 sm:flex-row sm:items-start sm:gap-5" aria-labelledby="availability-title">
    <span class="eyebrow shrink-0 pt-0.5">Always listening</span>
    <div>
      <h2 id="availability-title" class="text-sm font-medium">Your music keeps going. So do we.</h2>
      <p class="mt-1 text-sm leading-relaxed text-muted">DRMC follows your Last.fm listening from the cloud. No desktop app to keep open. Pause sharing or disconnect your accounts whenever you like.</p>
    </div>
  </section>

  <section id="how-it-works" class="pt-16 sm:pt-20" aria-labelledby="steps-title">
    <p class="eyebrow">How it works</p>
    <h2 id="steps-title" class="mt-3 text-2xl font-medium tracking-tight">Connect once. Keep listening.</h2>
    <ol class="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-7">
      {#each steps as step (step.number)}
        <li class="border-t border-subtle pt-4">
          <span class="font-mono text-xs text-muted">{step.number}</span>
          <h3 class="mt-4 text-base font-medium">{step.title}</h3>
          <p class="mt-2 text-sm leading-relaxed text-muted">{step.description}</p>
        </li>
      {/each}
    </ol>
  </section>
</div>
