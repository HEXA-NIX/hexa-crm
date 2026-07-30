<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade, scale } from "svelte/transition";

  export type ModalSize = "sm" | "md" | "lg" | "xl" | "fluid" | "full";

  let {
    open = false,
    title = "",
    size = "md",
    onclose,
    children,
    headerExtra,
    footer,
  }: {
    open?: boolean;
    title?: string;
    size?: ModalSize;
    onclose: () => void;
    children: Snippet;
    headerExtra?: Snippet;
    footer?: Snippet;
  } = $props();

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }

  const sizeClasses: Record<ModalSize, string> = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    fluid: "w-[clamp(20rem,92vw,78rem)] max-w-full",
    full: "w-[calc(100vw-2rem)] max-w-full min-h-[calc(100vh-2rem)]",
  };

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
  <div use:portal class="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden p-3 sm:p-4 md:p-6">
    <button
      class="absolute inset-0 bg-black/75 backdrop-blur-md"
      aria-label="Cerrar"
      onclick={onclose}
      transition:fade={{ duration: 150 }}
    ></button>
    <div
      class="modal-editorial glass-strong relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-2xl border border-[var(--color-border-strong)] shadow-2xl shadow-purple-950/40 sm:max-h-[calc(100dvh-3rem)] {sizeClasses[size]}"
      transition:scale={{ duration: 180, start: 0.96 }}
      role="dialog"
      aria-modal="true"
    >
      <!-- Header fijo -->
      <div class="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-soft)] bg-[var(--color-surface-glass,#120e1b)]/95 px-6 py-4 backdrop-blur-md">
        <h2 class="text-lg font-semibold tracking-tight text-[var(--color-text)] sm:text-xl">{title}</h2>
        <div class="flex items-center gap-2">
          {#if headerExtra}
            {@render headerExtra()}
          {/if}
          <button
            class="rounded-xl px-2.5 py-1 text-sm font-bold text-[var(--color-muted)] hover:bg-purple-500/10 hover:text-[var(--color-purple-bright)] transition-colors"
            onclick={onclose}
            aria-label="Cerrar modal"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Contenido scrollable -->
      <div class="modal-body modal-scroll-content min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6">
        {@render children()}
      </div>

      <!-- Footer opcional -->
      {#if footer}
        <div class="sticky bottom-0 z-20 flex shrink-0 items-center justify-end gap-3 border-t border-[var(--color-border-soft)] bg-[var(--color-surface-glass,#120e1b)]/95 px-6 py-3.5 backdrop-blur-md">
          {@render footer()}
        </div>
      {/if}
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
