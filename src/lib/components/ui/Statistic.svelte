<script lang="ts">
  import NumberFlow from '@number-flow/svelte'
  let { label, value }: { label: string; value: number | null | undefined } = $props()
  const format: Intl.NumberFormatOptions = { notation: 'compact', maximumFractionDigits: 1 }
  const readableValue = $derived(value == null ? 'Not yet available' : value.toLocaleString('en'))
</script>

<div>
  <dt class="min-h-8 text-[11px] text-muted sm:min-h-0">{label}</dt>
  <dd class="mt-1 min-h-7 font-mono text-lg tabular-nums" title={readableValue}>
    <span class="sr-only">{readableValue}</span>
    {#if value == null}<span aria-hidden="true">—</span>{:else}<NumberFlow {value} {format} locales="en" aria-hidden="true" respectMotionPreference />{/if}
  </dd>
</div>
