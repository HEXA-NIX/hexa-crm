<script lang="ts">
  import { page } from "$app/stores";
  import ProductEditor from "$lib/components/ProductEditor.svelte";

  const productId = $derived(Number($page.params.id));
</script>

{#if productId}
  {#key productId}
    <ProductEditor {productId} />
  {/key}
{/if}
