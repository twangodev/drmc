<script lang="ts">
  import type { Snippet } from 'svelte'
  import Button from './ui/Button.svelte'

  let { action, children, variant = 'primary', disabled = false, class: className = '' }: {
    action: string
    children: Snippet
    variant?: 'primary' | 'secondary' | 'quiet'
    disabled?: boolean
    class?: string
  } = $props()
</script>

<form method="post" {action} data-sveltekit-reload>
  <Button type="submit" {variant} {disabled} class={className}>{@render children()}</Button>
</form>
