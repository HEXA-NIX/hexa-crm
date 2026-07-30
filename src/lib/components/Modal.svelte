<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade, scale } from "svelte/transition";

  let {
    open = false,
    title = "",
    onclose,
    children,
  }: {
    open?: boolean;
    title?: string;
    onclose: () => void;
    children: Snippet;
  } = $props();

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  $effect(() => {
    if (!open || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  });
</script>

<svelte:window onkeydown={open ? onKey : undefined} />

{#if open}
  <div use:portal class="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden p-3 sm:p-6">
    <button
      class="absolute inset-0 bg-black/75 backdrop-blur-md"
      aria-label="Cerrar"
      onclick={onclose}
      transition:fade={{ duration: 150 }}
    ></button>
    <div
      class="modal-editorial glass-strong relative z-10 flex max-h-[calc(100dvh-1.5rem)] min-h-[min(38rem,calc(100dvh-1.5rem))] w-full max-w-4xl flex-col overflow-hidden border border-[var(--color-border-strong)] shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
      transition:scale={{ duration: 180, start: 0.96 }}
      role="dialog"
      aria-modal="true"
    >
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4 sm:px-6">
        <h2 class="text-lg font-semibold text-[var(--color-text)]">{title}</h2>
        <button
          class="rounded-lg px-2 py-1 text-[var(--color-muted)] hover:bg-purple-500/10 hover:text-[var(--color-purple-bright)]"
          onclick={onclose}
        >
          ✕
        </button>
      </div>
      <div class="modal-scroll-content min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 sm:py-5">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  :global(.modal-scroll-content > form) {
    min-height: 100%;
    display: flex;
    flex-direction: column;
  }

  :global(.modal-scroll-content > form > :last-child) {
    position: sticky;
    z-index: 5;
    bottom: -1rem;
    width: calc(100% + 2.5rem);
    margin-right: -1.25rem;
    margin-left: -1.25rem;
    margin-top: auto;
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-obsidian-panel) 94%, transparent);
    box-shadow: 0 -14px 24px -20px rgb(0 0 0 / 0.8);
    backdrop-filter: blur(14px);
  }

  @media (min-width: 640px) {
    :global(.modal-scroll-content > form > :last-child) {
      bottom: -1.25rem;
      width: calc(100% + 3rem);
      margin-right: -1.5rem;
      margin-left: -1.5rem;
      padding: 1rem 1.5rem 1.25rem;
    }
  }
</style>
