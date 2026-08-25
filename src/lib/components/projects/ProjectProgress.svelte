<script lang="ts">
  let {
    total,
    completed,
    blocked,
    progress,
    ready = true,
  }: {
    total: number;
    completed: number;
    blocked: number;
    progress: number;
    ready?: boolean;
  } = $props();
</script>

<div class="w-full shrink-0 space-y-3 rounded-xl border border-[var(--color-border-soft)] bg-black/30 p-4 sm:w-64">
  <div class="flex items-center justify-between text-xs">
    <span class="font-medium text-[var(--color-muted)]">Progreso global</span>
    <span class="font-bold text-[var(--color-purple-bright)]">{ready ? `${progress}%` : "—"}</span>
  </div>
  <div class="h-2.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Progreso global del proyecto" aria-valuenow={ready ? progress : undefined} aria-valuemin="0" aria-valuemax="100">
    <div class="h-full bg-gradient-to-r from-purple-500 to-indigo-400 transition-all duration-300 {ready ? '' : 'w-1/3 animate-pulse opacity-40'}" style={ready ? `width: ${progress}%` : undefined}></div>
  </div>
  {#if ready}<div class="flex items-center justify-between gap-1 pt-1 text-[11px] text-[var(--color-muted-dim)]">
    <span>Tareas: <strong class="text-[var(--color-text)]">{total}</strong></span>
    <span>Hechas: <strong class="text-emerald-300">{completed}</strong></span>
    {#if blocked > 0}
      <span>Bloqueadas: <strong class="text-rose-300">{blocked}</strong></span>
    {/if}
  </div>{:else}<p class="pt-1 text-[11px] text-[var(--color-muted-dim)]">Cargando progreso…</p>{/if}
</div>
