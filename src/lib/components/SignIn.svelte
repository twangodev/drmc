<script lang="ts">
  import ActionForm from './ActionForm.svelte'
  let { disabled = false }: { disabled?: boolean } = $props()
</script>

<section class="py-8 text-center" aria-labelledby="sign-in-title">
  <h1 id="sign-in-title" class="text-3xl font-medium tracking-tight">Your music, on Discord.</h1>
  <p class="mt-3 text-sm text-muted">Connect Last.fm. Keep listening.</p>
  <div class="mt-8">
    <ActionForm action="/auth/discord/start" {disabled}>Log in with Discord</ActionForm>
  </div>
</section>
