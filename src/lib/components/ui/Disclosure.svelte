<script lang="ts">
  import { Collapsible } from 'bits-ui'
  import { ChevronDown } from '@lucide/svelte'
  import type { Snippet } from 'svelte'

  let { label, open = $bindable(false), children }: { label: string; open?: boolean; children: Snippet } = $props()
</script>

<Collapsible.Root bind:open class="border-t border-subtle">
  <Collapsible.Trigger class="flex min-h-12 w-full items-center justify-between gap-4 text-sm text-muted hover:text-text">
    {label}
    <ChevronDown size={14} aria-hidden="true" class={open ? 'rotate-180' : ''} />
  </Collapsible.Trigger>
  <Collapsible.Content forceMount>
    {#snippet child({ props, open: expanded })}
      <div {...props} hidden={!expanded} class="pb-2">{@render children()}</div>
    {/snippet}
  </Collapsible.Content>
</Collapsible.Root>
