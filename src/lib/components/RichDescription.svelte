<script lang="ts">
  import { renderRichDescription } from "$lib/projects/rich-description";

  let {
    value = "",
    class: className = "",
  }: {
    value?: string | null;
    class?: string;
  } = $props();
</script>

<div class="rich-description {className}">{@html renderRichDescription(value ?? "")}</div>

<style>
  .rich-description :global(p + p) { margin-top: 0.45rem; }
  .rich-description :global(ul),
  .rich-description :global(ol) { margin: 0.45rem 0; padding-left: 1.25rem; }
  .rich-description :global(ul) { list-style: disc; }
  .rich-description :global(ol) { list-style: decimal; }
  .rich-description :global(li + li) { margin-top: 0.2rem; }
  .rich-description :global(h2) { margin: 1.2rem 0 0.55rem; font-size: 1.12em; font-weight: 750; }
  .rich-description :global(h3) { margin: 0.9rem 0 0.4rem; font-size: 1em; font-weight: 700; }
  .rich-description :global(strong) { color: var(--color-text); font-weight: 700; }
  .rich-description :global(em) { font-style: italic; }
</style>
