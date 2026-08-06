<script lang="ts">
  import type { WorkStatus } from "$lib/types";

  let { name, avatar = null, size = "sm", status }: { name: string; avatar?: string | null; size?: "xs" | "sm" | "md"; status?: WorkStatus } = $props();
  const classes = $derived(size === "xs" ? "h-6 w-6 text-[9px]" : size === "md" ? "h-9 w-9 text-xs" : "h-7 w-7 text-[10px]");
  const initial = $derived((name.trim() || "?").slice(0, 1).toUpperCase());
  const statusClass = $derived(status === "done"
    ? "border-emerald-400/70 ring-emerald-400/15"
    : status === "blocked"
      ? "border-rose-400/80 ring-rose-400/20"
      : status === "in_progress"
        ? "border-cyan-400/70 ring-cyan-400/15"
        : status === "validation"
          ? "border-sky-400/80 ring-sky-400/20"
        : status === "planned"
          ? "border-amber-400/70 ring-amber-400/15"
          : status === "archived"
            ? "border-slate-400/60 ring-slate-400/10"
            : "border-purple-400/70 ring-purple-400/15");
</script>

<span
  class={`inline-flex ${classes} ${statusClass} shrink-0 items-center justify-center overflow-hidden rounded-full border bg-purple-500/15 font-semibold text-[var(--color-purple-bright)] ring-2`}
  title={name}
  aria-label={`Responsable: ${name}`}
>
  {#if avatar}
    <img src={avatar} alt="" class="h-full w-full object-cover" />
  {:else}
    {initial}
  {/if}
</span>
