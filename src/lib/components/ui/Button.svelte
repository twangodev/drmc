<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'quiet'
    children: Snippet
  }
  let { children, variant = 'primary', type = 'button', class: className = '', ...attributes }: Props = $props()
</script>

<button {...attributes} {type} class="action action-{variant} disabled:cursor-default disabled:opacity-40 {className}">
  {@render children()}
</button>
