<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api/client";
  import type { ClientPortalProject } from "$lib/types";
  import Card from "$lib/components/Card.svelte";
  import Badge from "$lib/components/Badge.svelte";

  let projects = $state<ClientPortalProject[]>([]);
  let loading = $state(true);
  let error = $state("");
  onMount(async () => {
    try { projects = await api.portalListProjects(); }
    catch (cause) { error = cause instanceof Error ? cause.message : "No se pudieron cargar tus proyectos."; }
    finally { loading = false; }
  });
</script>

<div class="space-y-5">
  <div><p class="section-label">ESPACIO CLIENTE</p><h1 class="mt-1 text-2xl font-semibold">Tus proyectos</h1><p class="mt-2 text-sm text-[var(--color-muted)]">Seguimiento, entregas, tareas, solicitudes y facturas compartidas contigo.</p></div>
  {#if loading}<p class="text-sm text-[var(--color-muted)]">Cargando proyectos…</p>
  {:else if error}<Card lift={false} class="border-rose-500/30"><p class="text-rose-200">{error}</p></Card>
  {:else if projects.length === 0}<Card lift={false}><p class="text-[var(--color-muted)]">Todavía no tienes ningún proyecto asignado.</p></Card>
  {:else}<div class="grid gap-4 md:grid-cols-2">{#each projects as project}<a href={`/portal/${project.uid}`}><Card class="h-full" lift><div class="flex items-start justify-between gap-3"><div><h2 class="font-semibold">{project.name}</h2><p class="mt-2 line-clamp-2 text-sm text-[var(--color-muted)]">{project.description || "Sin descripción pública."}</p></div><Badge tone={project.status === "done" ? "ok" : project.status === "paused" ? "warn" : "info"}>{project.status}</Badge></div><div class="mt-4 flex gap-4 text-xs text-[var(--color-muted-dim)]"><span>{project.tasks.length} tareas</span><span>{project.requests.length} solicitudes</span><span>{project.invoices.length} facturas</span></div></Card></a>{/each}</div>{/if}
</div>
