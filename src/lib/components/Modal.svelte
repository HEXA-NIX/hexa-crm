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
</script>

<svelte:window onkeydown={open ? onKey : undefined} />

{#if open}
  <div class="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-4 md:p-6">
    <button
      class="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
      aria-label="Cerrar"
      onclick={onclose}
      transition:fade={{ duration: 150 }}
    ></button>
    <div
      class="modal-editorial glass-strong relative z-10 flex max-h-[min(90vh,950px)] w-full flex-col overscroll-contain rounded-2xl border border-[var(--color-border-strong)] shadow-2xl shadow-purple-950/40 {sizeClasses[size]}"
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
      <div class="modal-body flex-1 overflow-y-auto p-5 sm:p-6 overscroll-contain">
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
