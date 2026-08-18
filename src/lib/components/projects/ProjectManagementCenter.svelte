<script lang="ts">
  import { api } from "$lib/api/client";
  import { currentUser, isAdmin } from "$lib/stores/session";
  import { showToast } from "$lib/stores/ui";
  import type {
    ProjectCycle,
    ProjectDecision,
    ProjectDependency,
    ProjectHealth,
    ProjectOperationalMilestone,
    ProjectRisk,
    WorkItem,
    WorkMember,
    WorkProject,
  } from "$lib/types";
  import { derivedProjectHealth, latestProjectUpdate, normalizeProjectManagement, projectActivity, projectUpdateIsStale } from "$lib/projects/management";
  import Button from "$lib/components/Button.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import Select from "$lib/components/Select.svelte";
  import DatePicker from "$lib/components/DatePicker.svelte";

  let {
    project,
    tasks,
    members,
    projects = [],
    mode = "summary",
    onsaved,
  }: {
    project: WorkProject;
    tasks: WorkItem[];
    members: WorkMember[];
    projects?: WorkProject[];
    mode?: "summary" | "plan" | "team" | "activity";
    onsaved?: (project: WorkProject) => void;
  } = $props();

  let saving = $state(false);
  let updateForm = $state({ health: "on_track" as ProjectHealth, summary: "", achievements: "", blockers: "", next_steps: "", decisions_needed: "" });
  let milestoneForm = $state({ title: "", kind: "delivery" as ProjectOperationalMilestone["kind"], target_date: "", owner_id: "", completion_criteria: "" });
  let riskForm = $state({ title: "", probability: "medium" as ProjectRisk["probability"], impact: "medium" as ProjectRisk["impact"], owner_id: "", mitigation: "", review_date: "" });
  let decisionForm = $state({ title: "", context: "", owner_id: "", due_date: "" });
  let dependencyForm = $state({ project_id: "", relation: "blocked_by" as ProjectDependency["relation"], notes: "" });
  let cycleForm = $state({ name: "", goal: "", start_date: "", end_date: "", capacity_points: "" });

  const management = $derived(normalizeProjectManagement(project.management));
  const latest = $derived(latestProjectUpdate(project));
  const health = $derived(derivedProjectHealth(project, tasks));
  const stale = $derived(projectUpdateIsStale(project));
  const activity = $derived(projectActivity(project, tasks).slice(0, 100));
  const nextMilestone = $derived([...management.milestones].filter((item) => item.status !== "done").sort((a,b) => (a.target_date || "9999").localeCompare(b.target_date || "9999"))[0]);
  const activeTasks = $derived(tasks.filter((task) => !["done", "archived"].includes(task.status)));
  const estimatedHours = $derived(activeTasks.reduce((sum, task) => sum + (management.task_estimates[String(task.id)] ?? 0), 0));
  const totalCapacity = $derived(management.capacity.reduce((sum, item) => sum + item.weekly_capacity_hours, 0));
  const memberOptions = $derived([{ value: "", label: "Sin responsable" }, ...members.map((member) => ({ value: String(member.id), label: member.display_name }))]);
  const projectOptions = $derived(projects.filter((item) => item.id !== project.id).map((item) => ({ value: String(item.id), label: item.name })));

  function uid(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function memberName(id: number | null) {
    return id ? members.find((member) => member.id === id)?.display_name ?? "Responsable" : "Sin responsable";
  }

  function healthLabel(value: ProjectHealth) {
    return ({ on_track: "En curso", at_risk: "En riesgo", off_track: "Desviado", on_hold: "En pausa" })[value];
  }

  function healthTone(value: ProjectHealth): "ok" | "warn" | "danger" | "neutral" {
    return value === "on_track" ? "ok" : value === "at_risk" ? "warn" : value === "off_track" ? "danger" : "neutral";
  }

  async function saveManagement(next: ReturnType<typeof normalizeProjectManagement>, message: string) {
    if (saving) return;
    saving = true;
    try {
      const saved = await api.upsertWorkProject({ id: project.id, name: project.name, management: next });
      onsaved?.(saved);
      showToast(message);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo guardar la gestión del proyecto", "err");
    } finally {
      saving = false;
    }
  }

  async function publishUpdate() {
    if (!updateForm.summary.trim()) return showToast("Escribe un resumen de la actualización", "err");
    await saveManagement({ ...management, updates: [{ id: uid("update"), ...updateForm, author: $currentUser?.display_name ?? "Equipo", created_at: new Date().toISOString() }, ...management.updates] }, "Actualización publicada");
    updateForm = { health: "on_track", summary: "", achievements: "", blockers: "", next_steps: "", decisions_needed: "" };
  }

  async function addMilestone() {
    if (!milestoneForm.title.trim()) return showToast("Indica el nombre del hito", "err");
    await saveManagement({ ...management, milestones: [...management.milestones, { id: uid("milestone"), title: milestoneForm.title.trim(), kind: milestoneForm.kind, target_date: milestoneForm.target_date || null, owner_id: milestoneForm.owner_id ? Number(milestoneForm.owner_id) : null, status: "pending", completion_criteria: milestoneForm.completion_criteria.trim() }] }, "Hito operativo añadido");
    milestoneForm = { title: "", kind: "delivery", target_date: "", owner_id: "", completion_criteria: "" };
  }

  async function addRisk() {
    if (!riskForm.title.trim()) return showToast("Indica el riesgo", "err");
    await saveManagement({ ...management, risks: [...management.risks, { id: uid("risk"), title: riskForm.title.trim(), probability: riskForm.probability, impact: riskForm.impact, owner_id: riskForm.owner_id ? Number(riskForm.owner_id) : null, mitigation: riskForm.mitigation.trim(), review_date: riskForm.review_date || null, status: "open" }] }, "Riesgo registrado");
    riskForm = { title: "", probability: "medium", impact: "medium", owner_id: "", mitigation: "", review_date: "" };
  }

  async function addDecision() {
    if (!decisionForm.title.trim()) return showToast("Indica la decisión pendiente", "err");
    await saveManagement({ ...management, decisions: [...management.decisions, { id: uid("decision"), title: decisionForm.title.trim(), context: decisionForm.context.trim(), decision: "", owner_id: decisionForm.owner_id ? Number(decisionForm.owner_id) : null, due_date: decisionForm.due_date || null, status: "pending", decided_at: null }] }, "Decisión registrada");
    decisionForm = { title: "", context: "", owner_id: "", due_date: "" };
  }

  async function addDependency() {
    if (!dependencyForm.project_id) return showToast("Selecciona un proyecto relacionado", "err");
    await saveManagement({ ...management, dependencies: [...management.dependencies, { id: uid("dependency"), project_id: Number(dependencyForm.project_id), relation: dependencyForm.relation, notes: dependencyForm.notes.trim() }] }, "Dependencia añadida");
    dependencyForm = { project_id: "", relation: "blocked_by", notes: "" };
  }

  async function addCycle() {
    if (!cycleForm.name.trim() || !cycleForm.start_date || !cycleForm.end_date) return showToast("Completa nombre y fechas del ciclo", "err");
    if (cycleForm.end_date < cycleForm.start_date) return showToast("El ciclo no puede terminar antes de empezar", "err");
    const cycle: ProjectCycle = { id: uid("cycle"), name: cycleForm.name.trim(), goal: cycleForm.goal.trim(), start_date: cycleForm.start_date, end_date: cycleForm.end_date, capacity_points: Math.max(0, Number(cycleForm.capacity_points) || 0), status: "planned" };
    await saveManagement({ ...management, cycles: [...management.cycles, cycle] }, "Ciclo creado");
    cycleForm = { name: "", goal: "", start_date: "", end_date: "", capacity_points: "" };
  }

  async function patchMilestone(id: string, patch: Partial<ProjectOperationalMilestone>) {
    await saveManagement({ ...management, milestones: management.milestones.map((item) => item.id === id ? { ...item, ...patch } : item) }, "Hito actualizado");
  }

  async function patchRisk(id: string, patch: Partial<ProjectRisk>) {
    await saveManagement({ ...management, risks: management.risks.map((item) => item.id === id ? { ...item, ...patch } : item) }, "Riesgo actualizado");
  }

  async function patchDecision(id: string, patch: Partial<ProjectDecision>) {
    await saveManagement({ ...management, decisions: management.decisions.map((item) => item.id === id ? { ...item, ...patch, decided_at: patch.status === "decided" ? new Date().toISOString() : item.decided_at } : item) }, "Decisión actualizada");
  }

  async function updateCapacity(userId: number, value: string) {
    const hours = Math.max(0, Number(value) || 0);
    const capacity = management.capacity.filter((item) => item.user_id !== userId);
    if (hours) capacity.push({ user_id: userId, weekly_capacity_hours: hours });
    await saveManagement({ ...management, capacity }, "Capacidad actualizada");
  }

  async function updateEstimate(taskId: number, value: string) {
    const estimates = { ...management.task_estimates };
    const hours = Math.max(0, Number(value) || 0);
    if (hours) estimates[String(taskId)] = hours;
    else delete estimates[String(taskId)];
    await saveManagement({ ...management, task_estimates: estimates }, "Estimación actualizada");
  }
</script>

{#if mode === "summary"}
  <div class="mb-6 grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr]" data-project-command-summary>
    <div class="rounded-2xl border border-[var(--color-border)] bg-black/15 p-4">
      <div class="flex items-center justify-between gap-3"><span class="section-label">ÚLTIMA ACTUALIZACIÓN</span><Badge tone={healthTone(health)}>{healthLabel(health)}</Badge></div>
      {#if latest}
        <p class="mt-3 text-sm font-semibold text-[var(--color-text)]">{latest.summary}</p>
        <p class="mt-2 text-xs text-[var(--color-muted)]">{latest.author} · {new Date(latest.created_at).toLocaleDateString("es-ES")}</p>
      {:else}<p class="mt-3 text-sm text-amber-200">Todavía no se ha publicado una actualización.</p>{/if}
      {#if stale}<p class="mt-2 text-xs font-semibold text-amber-300">Actualización pendiente según la cadencia del proyecto.</p>{/if}
    </div>
    <div class="rounded-2xl border border-rose-400/20 bg-rose-500/[0.05] p-4"><span class="section-label">RIESGOS Y DECISIONES</span><p class="mt-3 text-2xl font-semibold text-rose-200">{management.risks.filter((item) => item.status === "open").length}</p><p class="text-xs text-[var(--color-muted)]">riesgos abiertos · {management.decisions.filter((item) => item.status === "pending").length} decisiones pendientes</p></div>
    <div class="rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.05] p-4"><span class="section-label">PRÓXIMO HITO</span><p class="mt-3 text-sm font-semibold text-cyan-100">{nextMilestone?.title ?? "Sin hitos pendientes"}</p><p class="mt-1 text-xs text-[var(--color-muted)]">{nextMilestone?.target_date ? new Date(`${nextMilestone.target_date}T12:00:00`).toLocaleDateString("es-ES") : "Añade una fecha de entrega"}</p></div>
  </div>
  {#if $isAdmin}
    <details class="mb-6 rounded-2xl border border-purple-400/25 bg-purple-500/[0.05] p-4">
      <summary class="cursor-pointer font-semibold text-[var(--color-text)]">Publicar actualización del proyecto</summary>
      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <Select label="Salud" options={[{value:"on_track",label:"En curso"},{value:"at_risk",label:"En riesgo"},{value:"off_track",label:"Desviado"},{value:"on_hold",label:"En pausa"}]} bind:value={updateForm.health} />
        <input class="field w-full md:col-span-2" bind:value={updateForm.summary} placeholder="Resumen ejecutivo" />
        <textarea class="field min-h-20" bind:value={updateForm.achievements} placeholder="Qué hemos conseguido"></textarea><textarea class="field min-h-20" bind:value={updateForm.blockers} placeholder="Bloqueos"></textarea>
        <textarea class="field min-h-20" bind:value={updateForm.next_steps} placeholder="Próximos pasos"></textarea><textarea class="field min-h-20" bind:value={updateForm.decisions_needed} placeholder="Decisiones necesarias"></textarea>
        <div class="md:col-span-2 flex justify-end"><Button variant="primary" disabled={saving} onclick={publishUpdate}>Publicar actualización</Button></div>
      </div>
    </details>
  {/if}
{:else if mode === "plan"}
  <div class="mb-6 grid gap-4 xl:grid-cols-2" data-project-operational-plan>
    <section class="rounded-2xl border border-[var(--color-border)] bg-black/10 p-4"><div class="flex items-center justify-between"><span class="section-label">HITOS OPERATIVOS</span><Badge tone="neutral">{management.milestones.length}</Badge></div><div class="mt-3 space-y-2">{#each management.milestones as item (item.id)}<div class="rounded-xl border border-white/[0.07] p-3"><div class="flex justify-between gap-3"><div><p class="text-sm font-semibold">{item.title}</p><p class="text-xs text-[var(--color-muted)]">{item.kind} · {memberName(item.owner_id)} · {item.target_date || "sin fecha"}</p></div><Select class="w-36" options={[{value:"pending",label:"Pendiente"},{value:"in_progress",label:"En curso"},{value:"done",label:"Completado"},{value:"missed",label:"Incumplido"}]} value={item.status} onvaluechange={(value) => patchMilestone(item.id,{status:value as ProjectOperationalMilestone["status"]})}/></div>{#if item.completion_criteria}<p class="mt-2 text-xs text-[var(--color-muted)]">Criterio: {item.completion_criteria}</p>{/if}</div>{/each}</div>{#if $isAdmin}<div class="mt-4 grid gap-2 sm:grid-cols-2"><input class="field sm:col-span-2" bind:value={milestoneForm.title} placeholder="Nuevo hito"/><Select options={[{value:"delivery",label:"Entrega"},{value:"contractual",label:"Contractual"},{value:"internal",label:"Interno"}]} bind:value={milestoneForm.kind}/><DatePicker bind:value={milestoneForm.target_date}/><Select options={memberOptions} bind:value={milestoneForm.owner_id}/><input class="field" bind:value={milestoneForm.completion_criteria} placeholder="Criterio de finalización"/><div class="sm:col-span-2 flex justify-end"><Button variant="secondary" disabled={saving} onclick={addMilestone}>+ Añadir hito</Button></div></div>{/if}</section>
    <section class="rounded-2xl border border-[var(--color-border)] bg-black/10 p-4"><span class="section-label">RIESGOS</span><div class="mt-3 space-y-2">{#each management.risks as item (item.id)}<div class="rounded-xl border border-white/[0.07] p-3"><div class="flex justify-between gap-3"><div><p class="text-sm font-semibold">{item.title}</p><p class="text-xs text-[var(--color-muted)]">Prob. {item.probability} · impacto {item.impact} · {memberName(item.owner_id)}</p></div>{#if item.status === "open"}<Button variant="ghost" onclick={() => patchRisk(item.id,{status:"mitigated"})}>Mitigar</Button>{:else}<Badge tone="ok">{item.status}</Badge>{/if}</div>{#if item.mitigation}<p class="mt-2 text-xs text-[var(--color-muted)]">Plan: {item.mitigation}</p>{/if}</div>{/each}</div>{#if $isAdmin}<div class="mt-4 grid gap-2 sm:grid-cols-2"><input class="field sm:col-span-2" bind:value={riskForm.title} placeholder="Nuevo riesgo"/><Select options={[{value:"low",label:"Prob. baja"},{value:"medium",label:"Prob. media"},{value:"high",label:"Prob. alta"}]} bind:value={riskForm.probability}/><Select options={[{value:"low",label:"Impacto bajo"},{value:"medium",label:"Impacto medio"},{value:"high",label:"Impacto alto"}]} bind:value={riskForm.impact}/><Select options={memberOptions} bind:value={riskForm.owner_id}/><DatePicker bind:value={riskForm.review_date}/><textarea class="field min-h-16 sm:col-span-2" bind:value={riskForm.mitigation} placeholder="Plan de mitigación"></textarea><div class="sm:col-span-2 flex justify-end"><Button variant="secondary" disabled={saving} onclick={addRisk}>+ Registrar riesgo</Button></div></div>{/if}</section>
    <section class="rounded-2xl border border-[var(--color-border)] bg-black/10 p-4"><span class="section-label">DECISIONES</span><div class="mt-3 space-y-2">{#each management.decisions as item (item.id)}<div class="rounded-xl border border-white/[0.07] p-3"><div class="flex justify-between gap-3"><div><p class="text-sm font-semibold">{item.title}</p><p class="text-xs text-[var(--color-muted)]">{memberName(item.owner_id)} · {item.due_date || "sin fecha"}</p></div>{#if item.status === "pending"}<Button variant="ghost" onclick={() => patchDecision(item.id,{status:"decided",decision:item.context || "Decisión confirmada"})}>Marcar decidida</Button>{:else}<Badge tone="ok">Decidida</Badge>{/if}</div>{#if item.context}<p class="mt-2 text-xs text-[var(--color-muted)]">{item.context}</p>{/if}</div>{/each}</div>{#if $isAdmin}<div class="mt-4 grid gap-2 sm:grid-cols-2"><input class="field sm:col-span-2" bind:value={decisionForm.title} placeholder="Decisión necesaria"/><textarea class="field min-h-16 sm:col-span-2" bind:value={decisionForm.context} placeholder="Contexto y alternativas"></textarea><Select options={memberOptions} bind:value={decisionForm.owner_id}/><DatePicker bind:value={decisionForm.due_date}/><div class="sm:col-span-2 flex justify-end"><Button variant="secondary" disabled={saving} onclick={addDecision}>+ Añadir decisión</Button></div></div>{/if}</section>
    <section class="rounded-2xl border border-[var(--color-border)] bg-black/10 p-4"><span class="section-label">DEPENDENCIAS ENTRE PROYECTOS</span><div class="mt-3 space-y-2">{#each management.dependencies as item (item.id)}<div class="rounded-xl border border-white/[0.07] p-3"><p class="text-sm font-semibold">{item.relation === "blocked_by" ? "Bloqueado por" : item.relation === "blocks" ? "Bloquea a" : "Relacionado con"}: {projects.find((project) => project.id === item.project_id)?.name ?? `Proyecto ${item.project_id}`}</p><p class="text-xs text-[var(--color-muted)]">{item.notes}</p></div>{/each}</div>{#if $isAdmin && projectOptions.length}<div class="mt-4 grid gap-2"><Select options={projectOptions} bind:value={dependencyForm.project_id} placeholder="Proyecto"/><Select options={[{value:"blocked_by",label:"Bloqueado por"},{value:"blocks",label:"Bloquea a"},{value:"related",label:"Relacionado"}]} bind:value={dependencyForm.relation}/><input class="field" bind:value={dependencyForm.notes} placeholder="Notas"/><div class="flex justify-end"><Button variant="secondary" disabled={saving} onclick={addDependency}>+ Añadir dependencia</Button></div></div>{/if}</section>
  </div>
{:else if mode === "team"}
  <div class="mb-6 grid gap-4 xl:grid-cols-[1.1fr_1fr]" data-project-capacity>
    <section class="rounded-2xl border border-[var(--color-border)] bg-black/10 p-4"><div class="flex items-center justify-between"><span class="section-label">CAPACIDAD SEMANAL</span><span class="text-xs text-[var(--color-muted)]">{estimatedHours} h asignadas / {totalCapacity} h disponibles</span></div><div class="mt-4 space-y-3">{#each members as member (member.id)}{@const hours = management.capacity.find((item) => item.user_id === member.id)?.weekly_capacity_hours ?? 0}{@const assigned = activeTasks.filter((task) => (task.effective_assignee_id ?? task.assignee_id) === member.id).reduce((sum, task) => sum + (management.task_estimates[String(task.id)] ?? 0), 0)}<div><div class="flex items-center justify-between gap-3 text-sm"><span>{member.display_name}</span><span class={hours > 0 && assigned > hours ? "text-rose-300" : "text-[var(--color-muted)]"}>{assigned}/{hours} h</span></div><div class="mt-1 h-2 overflow-hidden rounded-full bg-white/10"><div class="h-full rounded-full {hours > 0 && assigned > hours ? 'bg-rose-400' : 'bg-emerald-400'}" style={`width:${hours ? Math.min(100, assigned / hours * 100) : 0}%`}></div></div>{#if $isAdmin}<input class="field mt-2 w-32 text-xs" type="number" min="0" value={hours || ""} placeholder="h/semana" onchange={(event) => updateCapacity(member.id, event.currentTarget.value)}/>{/if}</div>{/each}</div><details class="mt-5 border-t border-white/[0.07] pt-4"><summary class="cursor-pointer text-sm font-semibold">Estimar tareas abiertas</summary><div class="mt-3 max-h-80 space-y-2 overflow-y-auto">{#each activeTasks as task (task.id)}<label class="grid grid-cols-[1fr_6rem] items-center gap-3 text-xs"><span class="truncate text-[var(--color-muted)]">{task.title}</span><input class="field text-xs" type="number" min="0" step="0.5" value={management.task_estimates[String(task.id)] ?? ""} placeholder="horas" onchange={(event) => updateEstimate(task.id,event.currentTarget.value)}/></label>{/each}</div></details></section>
    <section class="rounded-2xl border border-[var(--color-border)] bg-black/10 p-4"><span class="section-label">CICLOS / SPRINTS</span><div class="mt-3 space-y-2">{#each management.cycles as cycle (cycle.id)}<div class="rounded-xl border border-white/[0.07] p-3"><div class="flex justify-between"><p class="text-sm font-semibold">{cycle.name}</p><Badge tone={cycle.status === "active" ? "ok" : "neutral"}>{cycle.status}</Badge></div><p class="mt-1 text-xs text-[var(--color-muted)]">{cycle.start_date} → {cycle.end_date} · capacidad {cycle.capacity_points} puntos</p>{#if cycle.goal}<p class="mt-2 text-xs">{cycle.goal}</p>{/if}</div>{/each}</div>{#if $isAdmin}<div class="mt-4 grid gap-2 sm:grid-cols-2"><input class="field sm:col-span-2" bind:value={cycleForm.name} placeholder="Nombre del ciclo"/><textarea class="field min-h-16 sm:col-span-2" bind:value={cycleForm.goal} placeholder="Objetivo del ciclo"></textarea><DatePicker bind:value={cycleForm.start_date}/><DatePicker bind:value={cycleForm.end_date}/><input class="field" type="number" min="0" bind:value={cycleForm.capacity_points} placeholder="Capacidad en puntos"/><div class="flex justify-end"><Button variant="secondary" disabled={saving} onclick={addCycle}>+ Crear ciclo</Button></div></div>{/if}</section>
  </div>
{:else}
  <section class="mb-6 rounded-2xl border border-[var(--color-border)] bg-black/10 p-4" data-project-activity><div class="flex items-center justify-between"><span class="section-label">ACTIVIDAD DEL PROYECTO</span><Badge tone="neutral">{activity.length}</Badge></div><div class="mt-4 divide-y divide-white/[0.06]">{#each activity as entry}<div class="grid gap-2 py-3 sm:grid-cols-[8rem_1fr_auto]"><span class="text-xs font-semibold text-[var(--color-purple-bright)]">{entry.kind}</span><span class="text-sm text-[var(--color-text)]">{entry.title}</span><time class="text-xs text-[var(--color-muted)]">{new Date(entry.at).toLocaleString("es-ES")}</time></div>{/each}{#if !activity.length}<p class="py-8 text-center text-sm text-[var(--color-muted)]">Aún no hay actividad registrada.</p>{/if}</div></section>
{/if}
