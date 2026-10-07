<script lang="ts">
  import { Switch } from 'bits-ui'

  let { name, label, checked = $bindable(false) }: { name: string; label: string; checked?: boolean } = $props()
</script>

<label class="flex min-h-10 cursor-pointer items-center justify-between gap-4 text-sm" for={name}>
  {label}
  <Switch.Root id={name} {name} bind:checked class="group flex h-5 w-9 shrink-0 items-center rounded-full border border-subtle bg-surface px-0.5 data-[state=checked]:border-text data-[state=checked]:bg-text">
    <Switch.Thumb class="size-3.5 rounded-full bg-muted transition-transform group-data-[state=checked]:translate-x-4 group-data-[state=checked]:bg-bg" />
  </Switch.Root>
</label>
