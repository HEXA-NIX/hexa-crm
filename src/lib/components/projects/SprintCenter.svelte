<script lang="ts">
  import { api } from "$lib/api/client";
  import { isAdmin } from "$lib/stores/session";
  import { showToast } from "$lib/stores/ui";
  import type { ProjectCycle, WorkItem, WorkMember, WorkProject } from "$lib/types";
  import { currentSprint, pokerPending, sprintMetrics, sprintStageLabel, sprintTasks, suggestAiEstimate, taskReadiness, SPRINT_STAGES, type SprintStage } from "$lib/projects/sprints";
  import { normalizeProjectManagement } from "$lib/projects/management";
  import Button from "$lib/components/Button.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import DateRangePicker from "$lib/components/DateRangePicker.svelte";
  import Select from "$lib/components/Select.svelte";

  let { project, tasks, members, onsaved }: { project: WorkProject; tasks: WorkItem[]; members: WorkMember[]; onsaved?: (project: WorkProject) => void } = $props();
  function isoDate(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function displayDate(value?: string | null) {
    return value ? value.slice(0, 10).split("-").reverse().join("-") : "—";
  }
  function endFromWeeks(start: string, weeks: number) {
    const date = new Date(`${start}T12:00:00`);
    date.setDate(date.getDate() + weeks * 7 - 1);
    return isoDate(date);
  }
  const defaultSprintStart = isoDate(new Date());
  let saving = $state(false);
  let expanded = $state(true);
  let sprintDurationWeeks = $state<1 | 2 | 3 | 4 | null>(2);
  let form = $state({ name: "", goal: "", start_date: defaultSprintStart, end_date: endFromWeeks(defaultSprintStart, 2), human_capacity_hours: "", ai_concurrency: "2", ai_budget: "", definition_of_done: "Criterios de aceptación cumplidos, pruebas superadas, evidencias adjuntas y revisión aprobada." });
  let reviewNotes = $state("");
  let retroWentWell = $state("");
  let retroImprove = $state("");
  let retroAction = $state("");

  const management = $derived(normalizeProjectManagement(project.management));
  const sprint = $derived(currentSprint(management.cycles));
  const selectedTasks = $derived(sprintTasks(sprint, tasks));
  const metrics = $derived(sprint ? sprintMetrics(sprint, tasks) : null);
  const backlogRoots = $derived(tasks.filter((task) => task.parent_id == null && task.status !== "archived" && !(sprint?.task_ids ?? []).includes(task.id)));
  const selectedRoots = $derived(selectedTasks.filter((task) => task.parent_id == null));
  const pendingPoker = $derived(sprint ? pokerPending(sprint) : []);
  const stageIndex = $derived(sprint ? SPRINT_STAGES.indexOf(sprint.stage ?? "refinement") : -1);

  function uid() { return `sprint-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
  function memberName(id: number | null | undefined) { return id ? members.find((member) => member.id === id)?.display_name ?? "Revisor" : "Sin revisor"; }

  async function saveCycles(cycles: ProjectCycle[], message: string) {
    if (saving) return;
    saving = true;
    try {
      const saved = await api.upsertWorkProject({ id: project.id, name: project.name, management: { ...management, cycles } });
      onsaved?.(saved);
      showToast(message);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo guardar el sprint", "err");
    } finally { saving = false; }
  }

  async function patchSprint(patch: Partial<ProjectCycle>, message = "Sprint actualizado") {
    if (!sprint) return;
    await saveCycles(management.cycles.map((item) => item.id === sprint.id ? { ...item, ...patch } : item), message);
  }

  async function createSprint() {
    if (!form.name.trim() || !form.goal.trim() || !form.start_date || !form.end_date) return showToast("Define nombre, objetivo y fechas", "err");
    if (form.end_date < form.start_date) return showToast("La fecha final no puede ser anterior", "err");
    const cycle: ProjectCycle = { id: uid(), name: form.name.trim(), goal: form.goal.trim(), start_date: form.start_date, end_date: form.end_date, capacity_points: 0, status: "planned", stage: "refinement", task_ids: [], poker_points: {}, ai_estimates: {}, execution_modes: {}, reviewer_ids: {}, definition_of_done: form.definition_of_done.trim(), human_capacity_hours: Math.max(0, Number(form.human_capacity_hours) || 0), ai_concurrency: Math.max(0, Number(form.ai_concurrency) || 0), ai_budget_cents: Math.round(Math.max(0, Number(form.ai_budget.replace(",", ".")) || 0) * 100), completed_at: null };
    await saveCycles([...management.cycles, cycle], "Sprint creado: empieza el refinamiento");
  }

  async function toggleTask(task: WorkItem) {
    if (!sprint) return;
    const ids = new Set(sprint.task_ids ?? []);
    if (ids.has(task.id)) ids.delete(task.id); else ids.add(task.id);
    await patchSprint({ task_ids: [...ids] }, ids.has(task.id) ? "Tarea añadida al sprint" : "Tarea devuelta al backlog");
  }

  async function preparePoker() {
    if (!sprint || !selectedRoots.length) return showToast("Selecciona tareas desde el backlog", "err");
    const unready = selectedRoots.filter((task) => !taskReadiness(task).ready);
    if (unready.length) return showToast(`${unready.length} tareas necesitan contexto, responsable o fecha antes del poker`, "err");
    const ai_estimates = { ...(sprint.ai_estimates ?? {}) };
    for (const task of selectedRoots) ai_estimates[String(task.id)] = suggestAiEstimate(task, tasks.filter((item) => item.parent_id === task.id).length);
    await patchSprint({ stage: "poker", ai_estimates }, "Sprint Poker preparado; toca acordar estimaciones");
  }

  async function setPoker(taskId: number, value: string) {
    if (!sprint) return;
    const points = Number(value);
    await patchSprint({ poker_points: { ...(sprint.poker_points ?? {}), [String(taskId)]: Number.isFinite(points) ? points : 0 } }, "Estimación acordada");
  }

  async function setExecution(taskId: number, mode: "human" | "ai" | "hybrid") {
    if (!sprint) return;
    await patchSprint({ execution_modes: { ...(sprint.execution_modes ?? {}), [String(taskId)]: mode } }, "Modo de ejecución actualizado");
  }

  async function setReviewer(taskId: number, value: string) {
    if (!sprint) return;
    await patchSprint({ reviewer_ids: { ...(sprint.reviewer_ids ?? {}), [String(taskId)]: value ? Number(value) : null } }, "Revisor actualizado");
  }

  async function advance() {
    if (!sprint) return;
    const stage = sprint.stage ?? "refinement";
    if (stage === "refinement") return preparePoker();
    if (stage === "poker") {
      if (pendingPoker.length) return showToast(`Falta acordar la estimación de ${pendingPoker.length} tareas`, "err");
      return patchSprint({ stage: "planning", capacity_points: metrics?.points ?? 0 }, "Poker cerrado; revisa capacidad y ejecución");
    }
    if (stage === "planning") {
      const missingReviewers = selectedRoots.filter((task) => ["ai", "hybrid"].includes(sprint.execution_modes?.[String(task.id)] ?? "human") && !sprint.reviewer_ids?.[String(task.id)]);
      if (missingReviewers.length) return showToast("Toda tarea ejecutada por IA necesita revisor humano", "err");
      const otherActive = management.cycles.some((item) => item.id !== sprint.id && item.status === "active");
      if (otherActive) return showToast("Cierra el sprint activo antes de iniciar otro", "err");
      return patchSprint({ stage: "active", status: "active" }, "Sprint activado; el Kanban muestra su alcance");
    }
    if (stage === "active") return patchSprint({ stage: "review" }, "Sprint enviado a revisión");
    if (stage === "review") return patchSprint({ stage: "retrospective", review_notes: reviewNotes.trim() }, "Revisión guardada; completa la retrospectiva");
    if (stage === "retrospective") {
      if (!retroAction.trim()) return showToast("Define al menos una acción de mejora", "err");
      return patchSprint({ stage: "completed", status: "completed", retrospective_went_well: retroWentWell.trim(), retrospective_improve: retroImprove.trim(), retrospective_action: retroAction.trim(), completed_at: new Date().toISOString() }, "Sprint cerrado");
    }
  }
</script>

<section class="relative z-20 mb-6 overflow-visible rounded-2xl border border-purple-400/25 bg-purple-500/[0.045]" data-sprint-center>
  <button type="button" class="flex w-full items-center justify-between gap-3 p-4 text-left" onclick={() => (expanded = !expanded)}>
    <div><span class="section-label">SPRINTS · EQUIPO HÍBRIDO</span><p class="mt-1 text-xs text-[var(--color-muted)]">Planificación, ejecución con IA, revisión humana y aprendizaje continuo.</p></div>
    <div class="flex items-center gap-2">{#if sprint}<Badge tone={sprint.status === "active" ? "ok" : "warn"}>{sprintStageLabel(sprint.stage ?? "refinement")}</Badge>{/if}<span>{expanded ? "⌃" : "⌄"}</span></div>
  </button>
  {#if expanded}<div class="border-t border-purple-400/15 p-4">
    {#if !sprint}
      <div class="grid gap-3 md:grid-cols-2"><input class="field md:col-span-2" bind:value={form.name} placeholder="Sprint 1 · Objetivo corto"/><textarea class="field min-h-20 md:col-span-2" bind:value={form.goal} placeholder="¿Qué valor concreto debe entregar este sprint?"></textarea><div class="relative z-30 grid items-end gap-3 md:col-span-2 lg:grid-cols-2"><DateRangePicker label="Periodo del sprint" bind:start={form.start_date} bind:end={form.end_date} bind:durationWeeks={sprintDurationWeeks} showDurations required/><div class="grid gap-3 rounded-xl border border-white/[0.07] bg-black/15 p-3 sm:grid-cols-2"><input class="field" type="number" min="0" bind:value={form.human_capacity_hours} placeholder="Capacidad humana (horas)"/><input class="field" type="number" min="0" bind:value={form.ai_concurrency} placeholder="Agentes IA simultáneos"/><input class="field sm:col-span-2" inputmode="decimal" bind:value={form.ai_budget} placeholder="Presupuesto IA (€)"/></div></div><textarea class="field min-h-20 md:col-span-2" bind:value={form.definition_of_done} placeholder="Definition of Done"></textarea>{#if $isAdmin}<div class="md:col-span-2 flex justify-end"><Button variant="ai" disabled={saving} onclick={createSprint}>Crear y refinar sprint</Button></div>{/if}</div>
      {#if management.cycles.some((cycle) => cycle.status === "completed")}<details class="mt-5 border-t border-white/[0.07] pt-4"><summary class="cursor-pointer text-sm font-semibold">Historial de sprints cerrados</summary><div class="mt-3 grid gap-2 md:grid-cols-2">{#each management.cycles.filter((cycle) => cycle.status === "completed").toReversed() as cycle (cycle.id)}{@const past = sprintMetrics(cycle,tasks)}<div class="rounded-xl border border-white/[0.07] p-3"><div class="flex justify-between gap-2"><strong class="text-sm">{cycle.name}</strong><span class="text-xs text-emerald-200">{past.progress}%</span></div><p class="mt-1 text-xs text-[var(--color-muted)]">{past.completedPoints}/{past.points} puntos · {displayDate(cycle.start_date)} → {displayDate(cycle.end_date)}</p>{#if cycle.retrospective_action}<p class="mt-2 text-xs text-purple-200">Mejora: {cycle.retrospective_action}</p>{/if}</div>{/each}</div></details>{/if}
    {:else}
      <div class="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]"><div><h3 class="text-lg font-semibold">{sprint.name}</h3><p class="mt-1 text-sm text-purple-200">{sprint.goal}</p><p class="mt-1 text-xs text-[var(--color-muted)]">{displayDate(sprint.start_date)} → {displayDate(sprint.end_date)}</p></div>{#if metrics}<div class="grid grid-cols-3 gap-2 text-center text-xs"><div class="rounded-xl bg-black/20 p-2"><strong class="block text-base">{metrics.progress}%</strong>progreso</div><div class="rounded-xl bg-black/20 p-2"><strong class="block text-base">{metrics.completedPoints}/{metrics.points}</strong>puntos</div><div class="rounded-xl bg-black/20 p-2"><strong class="block text-base">{metrics.aiTasks}</strong>con IA</div></div>{/if}</div>
      <div class="mb-5 grid grid-cols-4 gap-1 sm:grid-cols-7">{#each SPRINT_STAGES as item, index}<div class="rounded-lg px-2 py-2 text-center text-[10px] font-semibold {index <= stageIndex ? 'bg-purple-500/20 text-purple-200' : 'bg-black/20 text-[var(--color-muted-dim)]'}">{index + 1}. {sprintStageLabel(item)}</div>{/each}</div>

      {#if sprint.stage === "refinement"}
        <div class="grid gap-4 lg:grid-cols-2"><div><h4 class="mb-2 text-sm font-semibold">Backlog preparado</h4><div class="max-h-80 space-y-2 overflow-y-auto">{#each backlogRoots as task (task.id)}{@const readiness = taskReadiness(task)}<button type="button" class="w-full rounded-xl border border-white/[0.07] p-3 text-left hover:border-purple-400/30" onclick={() => toggleTask(task)}><div class="flex justify-between gap-2"><span class="text-sm font-medium">{task.title}</span><Badge tone={readiness.ready ? "ok" : "warn"}>{readiness.ready ? "Preparada" : `Falta ${readiness.missing.length}`}</Badge></div>{#if !readiness.ready}<p class="mt-1 text-[10px] text-amber-200">{readiness.missing.join(", ")}</p>{/if}</button>{/each}</div></div><div><h4 class="mb-2 text-sm font-semibold">Alcance candidato · {selectedRoots.length}</h4><div class="space-y-2">{#each selectedRoots as task (task.id)}<button type="button" class="w-full rounded-xl border border-purple-400/20 bg-purple-500/[0.06] p-3 text-left" onclick={() => toggleTask(task)}><span class="text-sm">{task.title}</span><span class="float-right text-xs text-rose-200">Quitar</span></button>{/each}</div></div></div>
      {:else if sprint.stage === "poker"}
        <div class="space-y-2">{#each selectedRoots as task (task.id)}{@const ai = sprint.ai_estimates?.[String(task.id)]}<div class="grid items-center gap-3 rounded-xl border border-white/[0.07] p-3 md:grid-cols-[1fr_15rem_8rem]"><div><p class="text-sm font-semibold">{task.title}</p><p class="mt-1 text-[10px] text-[var(--color-muted)]">IA: {ai?.points ?? "—"} puntos · confianza {ai?.confidence ?? "—"}. {ai?.rationale}</p></div><div class="flex gap-1">{#each [1,2,3,5,8,13,21] as point}<button type="button" class="h-8 min-w-8 rounded-lg border text-xs {sprint.poker_points?.[String(task.id)] === point ? 'border-purple-300 bg-purple-500/25' : 'border-white/10'}" onclick={() => setPoker(task.id,String(point))}>{point}</button>{/each}</div><strong class="text-right text-purple-200">{sprint.poker_points?.[String(task.id)] ?? "?"} pts</strong></div>{/each}</div>
      {:else if sprint.stage === "planning"}
        <div class="space-y-2">{#each selectedRoots as task (task.id)}{@const mode = sprint.execution_modes?.[String(task.id)] ?? "human"}<div class="grid items-center gap-3 rounded-xl border border-white/[0.07] p-3 lg:grid-cols-[1fr_auto_14rem]"><div><p class="text-sm font-semibold">{task.title}</p><p class="text-xs text-[var(--color-muted)]">{sprint.poker_points?.[String(task.id)]} puntos</p></div><div class="flex rounded-lg border border-white/10 p-1">{#each [["human","Persona"],["ai","IA"],["hybrid","Híbrido"]] as option}<button type="button" class="rounded-md px-2 py-1 text-xs {mode === option[0] ? 'bg-purple-500/25 text-purple-100' : 'text-[var(--color-muted)]'}" onclick={() => setExecution(task.id,option[0] as "human"|"ai"|"hybrid")}>{option[1]}</button>{/each}</div><Select class="text-xs" options={[{value:"",label:"Sin revisor"},...members.map((member)=>({value:String(member.id),label:member.display_name}))]} value={String(sprint.reviewer_ids?.[String(task.id)] ?? "")} onvaluechange={(value) => setReviewer(task.id,value)}/></div>{/each}<div class="grid gap-2 rounded-xl bg-black/20 p-3 text-xs sm:grid-cols-3"><span>Capacidad humana: <strong>{sprint.human_capacity_hours ?? 0} h</strong></span><span>Concurrencia IA: <strong>{sprint.ai_concurrency ?? 0}</strong></span><span>Presupuesto IA: <strong>{((sprint.ai_budget_cents ?? 0)/100).toLocaleString("es-ES",{style:"currency",currency:"EUR"})}</strong></span></div></div>
      {:else if sprint.stage === "active"}
        <div class="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.05] p-4"><p class="font-semibold text-emerald-200">Sprint en ejecución</p><p class="mt-1 text-xs text-[var(--color-muted)]">El Kanban inferior muestra únicamente estas {metrics?.total ?? 0} tareas y sus subtareas. Las entregas de IA deben pasar por su revisor humano.</p></div>
      {:else if sprint.stage === "review"}
        <div><div class="grid gap-2 sm:grid-cols-3"><div class="rounded-xl bg-black/20 p-3"><strong>{metrics?.completed ?? 0}/{metrics?.total ?? 0}</strong><p class="text-xs text-[var(--color-muted)]">tareas terminadas</p></div><div class="rounded-xl bg-black/20 p-3"><strong>{metrics?.completedPoints ?? 0}/{metrics?.points ?? 0}</strong><p class="text-xs text-[var(--color-muted)]">puntos entregados</p></div><div class="rounded-xl bg-black/20 p-3"><strong>{metrics?.progress ?? 0}%</strong><p class="text-xs text-[var(--color-muted)]">cumplimiento</p></div></div><textarea class="field mt-3 min-h-24 w-full" bind:value={reviewNotes} placeholder="Resultado de la revisión, entregas aceptadas y pendientes que vuelven al backlog"></textarea></div>
      {:else if sprint.stage === "retrospective"}
        <div class="grid gap-3 md:grid-cols-3"><textarea class="field min-h-28" bind:value={retroWentWell} placeholder="Qué funcionó bien"></textarea><textarea class="field min-h-28" bind:value={retroImprove} placeholder="Qué debemos mejorar"></textarea><textarea class="field min-h-28" bind:value={retroAction} placeholder="Acción concreta para el siguiente sprint"></textarea></div>
      {:else}<div class="rounded-xl border border-purple-400/20 p-4"><p class="font-semibold">Sprint cerrado</p><p class="mt-1 text-xs text-[var(--color-muted)]">{sprint.retrospective_action || "Sin acción retrospectiva registrada."}</p></div>{/if}

      {#if $isAdmin && sprint.stage !== "completed"}<div class="mt-4 flex justify-end"><Button variant={sprint.stage === "active" ? "primary" : "ai"} disabled={saving} onclick={advance}>{sprint.stage === "refinement" ? "Convocar Sprint Poker" : sprint.stage === "poker" ? "Cerrar Poker y planificar" : sprint.stage === "planning" ? "Activar sprint" : sprint.stage === "active" ? "Iniciar revisión" : sprint.stage === "review" ? "Ir a retrospectiva" : "Cerrar sprint"}</Button></div>{/if}
    {/if}
  </div>{/if}
</section>
