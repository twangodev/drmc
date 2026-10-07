<script lang="ts" generics="Value extends string">
  import { Select } from 'bits-ui'
  import { Check, ChevronDown } from '@lucide/svelte'

  let { id, name, label, items, value = $bindable(), disabled = false }: {
    id: string
    name: string
    label: string
    items: { value: Value; label: string }[]
    value?: Value
    disabled?: boolean
  } = $props()
  const selectedLabel = $derived(items.find(item => item.value === value)?.label)
</script>

<Select.Root type="single" {name} {items} {disabled} bind:value>
  <Select.Trigger {id} aria-label={label} class="flex min-h-10 w-full items-center justify-between gap-3 rounded-md border border-subtle bg-bg px-3 text-sm disabled:opacity-40">
    {selectedLabel}
    <ChevronDown size={14} class="text-muted" aria-hidden="true" />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content sideOffset={6} class="z-50 max-h-[var(--bits-select-content-available-height)] w-[var(--bits-select-anchor-width)] overflow-y-auto rounded-md border border-subtle bg-raised p-1 shadow-lg">
      <Select.Viewport>
        {#each items as item (item.value)}
          <Select.Item value={item.value} label={item.label} class="flex min-h-10 items-center justify-between gap-3 rounded px-3 text-sm outline-none data-[highlighted]:bg-surface">
            {#snippet children({ selected })}
              {item.label}
              {#if selected}<Check size={14} aria-hidden="true" />{/if}
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>
