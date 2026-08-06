<script lang="ts">
  import { api } from "$lib/api/client";
  import { session, isAdmin } from "$lib/stores/session";
  import { showToast } from "$lib/stores/ui";
  import { formatEUR, parseEurosInput } from "$lib/money";
  import type { CashMovement, Customer, Settings, WorkProject, WorkItem, WorkProjectInput } from "$lib/types";
  import { economicGoalKey, economicGoalProgress, monthlyEconomicGoal } from "$lib/projects/economic-goal";
  import { calculateTaskProgress } from "$lib/projects/task-progress";
  import { projectStatusLabel, projectStatusTone } from "$lib/projects/presentation";
  import { hasInvalidDateRange, hasInvalidMoneyInput } from "$lib/projects/form-validation";
  import { availableMilestoneMonths, hasDuplicateMilestoneMonths, nextMilestoneMonth } from "$lib/projects/milestone-months";
  import Button from "$lib/components/Button.svelte";
  import Card from "$lib/components/Card.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import Select from "$lib/components/Select.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import RichDescription from "$lib/components/RichDescription.svelte";
  import RichDescriptionEditor from "$lib/components/RichDescriptionEditor.svelte";
  import { browser } from "$app/environment";

  let projects = $state<WorkProject[]>([]);
  let items = $state<WorkItem[]>([]);
  let customers = $state<Customer[]>([]);
  let cashMovements = $state<CashMovement[]>([]);
  let settings = $state<Settings | null>(null);
  let loading = $state(true);

  let filterStatus = $state(browser ? localStorage.getItem("hexa-projects-status") ?? "" : "");
  let filterText = $state("");
  let sortBy = $state(browser ? localStorage.getItem("hexa-projects-sort") ?? "attention" : "attention");
  let modalOpen = $state(false);
  let saving = $state(false);
  let savingGoal = $state(false);
  let goalInput = $state("");

  let form = $state({
    name: "",
    description: "",
    status: "active" as WorkProject["status"],
    customer_id: "",
    value: "",
    milestones: [] as { amount: string; target_month: string }[],
    start_date: "",
    target_date: "",
  });

  const filterOptions = [
    { value: "", label: "Todos" },
    { value: "active", label: "Activo" },
    { value: "planned", label: "Planificado" },
    { value: "paused", label: "En pausa" },
    { value: "done", label: "Completado" },
    { value: "archived", label: "Archivado" },
  ];

  const projectStatusOptions = [
    { value: "planned", label: "Planificado" },
    { value: "active", label: "Activo" },
    { value: "paused", label: "En pausa" },
    { value: "done", label: "Completado" },
    { value: "archived", label: "Archivado" },
  ];

  const sortOptions = [
    { value: "attention", label: "Necesitan atención" },
    { value: "deadline", label: "Fecha objetivo" },
    { value: "progress", label: "Mayor progreso" },
    { value: "value", label: "Mayor valor" },
    { value: "name", label: "Nombre A–Z" },
  ];

  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const milestoneMonthOptions = Array.from({ length: 36 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() + index, 1);
    return {
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("es-ES", { month: "long", year: "numeric" }),
    };
  });

  const customerOptions = $derived([
    { value: "", label: "Proyecto propio (sin cliente)" },
    ...customers.map((customer) => ({
      value: String(customer.id),
      label: customer.name,
      hint: customer.nif || customer.email || undefined,
    })),
  ]);

  async function loadData() {
    loading = true;
    try {
      const [projList, itemList, customerList, movementList, loadedSettings] = await Promise.all([
        api.listWorkProjects(),
        api.listWorkItems(),
        api.listCustomers(),
        api.listCashMovements(),
        api.getSettings(),
      ]);
      projects = projList;
      items = itemList;
      customers = customerList;
      cashMovements = movementList;
      settings = loadedSettings;
      goalInput = monthlyEconomicGoal(loadedSettings.monthly_economic_goals, $session.activeCompanyId, currentMonth)
        ? String(monthlyEconomicGoal(loadedSettings.monthly_economic_goals, $session.activeCompanyId, currentMonth) / 100).replace(".", ",")
        : "";
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al cargar proyectos", "err");
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // Reload data on company change or initial load
    const _companyId = $session.activeCompanyId;
    loadData();
  });

  $effect(() => {
    if (!browser) return;
    localStorage.setItem("hexa-projects-status", filterStatus);
    localStorage.setItem("hexa-projects-sort", sortBy);
  });

  function clearFilters() {
    filterText = "";
    filterStatus = "";
    sortBy = "attention";
  }

  const projectMetrics = $derived.by(() => {
    const map = new Map<number, {
      total: number;
      completed: number;
      blocked: number;
      overdue: number;
      dueSoon: number;
      progress: number;
      health: "on_track" | "at_risk" | "off_track";
      attentionScore: number;
    }>();
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const inSevenDays = new Date(now);
    inSevenDays.setDate(inSevenDays.getDate() + 7);
    for (const proj of projects) {
      const projItems = items.filter((i) => i.project_id === proj.id);
      const { total, completed, progress } = calculateTaskProgress(projItems);
      const blocked = projItems.filter((i) => i.status === "blocked").length;
      const openItems = projItems.filter((i) => i.status !== "done" && i.status !== "archived");
      const overdue = openItems.filter((i) => i.due_date && new Date(`${i.due_date}T00:00:00`) < now).length;
      const dueSoon = openItems.filter((i) => {
        if (!i.due_date) return false;
        const due = new Date(`${i.due_date}T00:00:00`);
        return due >= now && due <= inSevenDays;
      }).length;
      const targetOverdue = Boolean(
        proj.target_date &&
        proj.status !== "done" &&
        proj.status !== "archived" &&
        new Date(`${proj.target_date}T00:00:00`) < now,
      );
      const health = targetOverdue || overdue > 0
        ? "off_track"
        : blocked > 0 || dueSoon > 0
          ? "at_risk"
          : "on_track";
      const attentionScore = (targetOverdue ? 100 : 0) + overdue * 20 + blocked * 10 + dueSoon * 3;
      map.set(proj.id, { total, completed, blocked, overdue, dueSoon, progress, health, attentionScore });
    }
    return map;
  });

  const filteredProjects = $derived.by(() => {
    const query = filterText.trim().toLowerCase();
    return projects.filter((p) => {
      if (filterStatus && p.status !== filterStatus) return false;
      if (query) {
        const customer = customers.find((item) => item.id === p.customer_id)?.name ?? "";
        if (![p.name, p.description ?? "", customer].some((value) => value.toLowerCase().includes(query))) return false;
      }
      return true;
    }).sort((a, b) => {
      const aMetrics = projectMetrics.get(a.id);
      const bMetrics = projectMetrics.get(b.id);
      if (sortBy === "attention") return (bMetrics?.attentionScore ?? 0) - (aMetrics?.attentionScore ?? 0);
      if (sortBy === "progress") return (bMetrics?.progress ?? 0) - (aMetrics?.progress ?? 0);
      if (sortBy === "value") return (b.value_cents + b.monthly_estimate_cents) - (a.value_cents + a.monthly_estimate_cents);
      if (sortBy === "deadline") return (a.target_date || "9999-12-31").localeCompare(b.target_date || "9999-12-31");
      return a.name.localeCompare(b.name, "es");
    });
  });

  const portfolioSummary = $derived.by(() => {
    const portfolioProjects = projects.filter((project) => project.status !== "archived");
    const active = portfolioProjects.filter((project) => project.status === "active").length;
    const atRisk = portfolioProjects.filter((project) => {
      const health = projectMetrics.get(project.id)?.health;
      return health === "at_risk" || health === "off_track";
    }).length;
    const visibleMetrics = portfolioProjects.map((project) => projectMetrics.get(project.id));
    const blocked = visibleMetrics.reduce((sum, metrics) => sum + (metrics?.blocked ?? 0), 0);
    const dueSoon = visibleMetrics.reduce((sum, metrics) => sum + (metrics?.dueSoon ?? 0), 0);
    const averageProgress = visibleMetrics.length
      ? Math.round(visibleMetrics.reduce((sum, metrics) => sum + (metrics?.progress ?? 0), 0) / visibleMetrics.length)
      : 0;
    const completedTasks = visibleMetrics.reduce((sum, metrics) => sum + (metrics?.completed ?? 0), 0);
    const totalTasks = visibleMetrics.reduce((sum, metrics) => sum + (metrics?.total ?? 0), 0);
    return { active, atRisk, blocked, dueSoon, averageProgress, completedTasks, totalTasks };
  });

  const currentMonthIncomeCents = $derived(
    cashMovements
      .filter((movement) => movement.kind === "income" && movement.project_id != null && movement.occurred_at.slice(0, 7) === currentMonth)
      .reduce((sum, movement) => sum + movement.amount_cents, 0),
  );
  const currentGoalCents = $derived(
    monthlyEconomicGoal(settings?.monthly_economic_goals, $session.activeCompanyId, currentMonth),
  );
  const currentGoalProgress = $derived(economicGoalProgress(currentMonthIncomeCents, currentGoalCents));

  async function saveEconomicGoal() {
    const amount = goalInput.trim() ? parseEurosInput(goalInput) : 0;
    if (amount == null || amount < 0) {
      showToast("Introduce un objetivo económico válido", "err");
      return;
    }
    savingGoal = true;
    try {
      const key = economicGoalKey($session.activeCompanyId, currentMonth);
      const goals = { ...(settings?.monthly_economic_goals ?? {}) };
      if (amount === 0) delete goals[key];
      else goals[key] = amount;
      settings = await api.updateSettings({ monthly_economic_goals: goals });
      showToast(amount === 0 ? "Objetivo mensual eliminado" : "Objetivo mensual guardado");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al guardar el objetivo", "err");
    } finally {
      savingGoal = false;
    }
  }

  function healthLabel(health: "on_track" | "at_risk" | "off_track") {
    if (health === "off_track") return "Fuera de plazo";
    if (health === "at_risk") return "En riesgo";
    return "En curso";
  }

  function healthClass(health: "on_track" | "at_risk" | "off_track") {
    if (health === "off_track") return "border-rose-400/30 bg-rose-500/10 text-rose-200";
    if (health === "at_risk") return "border-amber-400/30 bg-amber-500/10 text-amber-200";
    return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  }

  function formatDate(iso?: string | null) {
    if (!iso) return "Sin fecha";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch {
      return iso;
    }
  }

  function openCreateModal() {
    form = {
      name: "",
      description: "",
      status: "active",
      customer_id: "",
      value: "",
      milestones: [],
      start_date: "",
      target_date: "",
    };
    modalOpen = true;
  }

  function addMilestone() {
    const targetMonth = nextMilestoneMonth(milestoneMonthOptions, form.milestones);
    if (!targetMonth) {
      showToast("No quedan más meses disponibles para añadir otro hito", "err");
      return;
    }
    form.milestones = [
      ...form.milestones,
      { amount: "", target_month: targetMonth },
    ];
  }

  function removeMilestone(index: number) {
    form.milestones = form.milestones.filter((_, itemIndex) => itemIndex !== index);
  }

  async function handleCreateProject() {
    if (!form.name.trim()) {
      showToast("El nombre del proyecto es obligatorio", "err");
      return;
    }
    if (hasInvalidDateRange(form.start_date, form.target_date)) {
      showToast("La fecha objetivo no puede ser anterior a la fecha de inicio", "err");
      return;
    }
    const projectValue = parseEurosInput(form.value);
    if (form.customer_id && hasInvalidMoneyInput(form.value)) {
      showToast("Introduce un valor contratado válido", "err");
      return;
    }
    const invalidMilestone = form.milestones.some((milestone) => {
      return hasInvalidMoneyInput(milestone.amount);
    });
    if (!form.customer_id && invalidMilestone) {
      showToast("Revisa los importes de los hitos mensuales", "err");
      return;
    }
    if (!form.customer_id && hasDuplicateMilestoneMonths(form.milestones)) {
      showToast("No puedes repetir el mismo mes en dos hitos", "err");
      return;
    }
    saving = true;
    try {
      const input: WorkProjectInput = {
        name: form.name.trim(),
        description: form.description.trim(),
        status: form.status,
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        value_cents: form.customer_id ? (projectValue ?? 0) : 0,
        monthly_estimate_cents: form.customer_id
          ? 0
          : form.milestones.reduce(
              (sum, milestone) => sum + (parseEurosInput(milestone.amount) ?? 0),
              0,
            ),
        revenue_target_date: null,
        revenue_milestones: form.customer_id
          ? []
          : form.milestones
              .map((milestone) => ({
                amount_cents: parseEurosInput(milestone.amount) ?? 0,
                target_month: milestone.target_month,
              }))
              .filter((milestone) => milestone.amount_cents > 0 && milestone.target_month),
        start_date: form.start_date || null,
        target_date: form.target_date || null,
      };
      await api.upsertWorkProject(input);
      showToast("Proyecto creado correctamente");
      modalOpen = false;
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al crear proyecto", "err");
    } finally {
      saving = false;
    }
  }
</script>

<section class="proyectos-page workspace-page">
  <!-- Header -->
  <div class="workspace-intro workspace-intro-compact mb-6">
    <p class="workspace-index">02 / PROYECTOS</p>
    <div class="workspace-intro-row">
      <div>
        <h2>Portafolio de<br /><em>Proyectos.</em></h2>
        <p class="mt-1 text-sm text-[var(--color-muted-dim)]">
          Visión estratégica de iniciativas, progreso y métricas operativas por empresa.
        </p>
      </div>
      <div class="mt-4 flex items-center gap-3 sm:mt-0">
        {#if $isAdmin}
          <Button variant="primary" onclick={openCreateModal}>+ Nuevo proyecto</Button>
        {/if}
      </div>
    </div>
  </div>

  {#if !loading && projects.length > 0}
    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="rounded-xl border border-[var(--color-border)] bg-black/20 p-4">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-dim)]">En marcha</p>
        <p class="mt-1 text-2xl font-semibold text-[var(--color-text)]">{portfolioSummary.active}</p>
        <p class="mt-1 text-xs text-[var(--color-muted)]">Proyectos activos</p>
      </div>
      <div class="rounded-xl border border-amber-400/20 bg-amber-500/[0.05] p-4">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-amber-300/70">Atención</p>
        <p class="mt-1 text-2xl font-semibold text-amber-200">{portfolioSummary.atRisk}</p>
        <p class="mt-1 text-xs text-[var(--color-muted)]">Proyectos con riesgo</p>
      </div>
      <div class="rounded-xl border border-rose-400/20 bg-rose-500/[0.05] p-4">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-rose-300/70">Bloqueos</p>
        <p class="mt-1 text-2xl font-semibold text-rose-200">{portfolioSummary.blocked}</p>
        <p class="mt-1 text-xs text-[var(--color-muted)]">Tareas bloqueadas</p>
      </div>
      <div class="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.05] p-4">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-cyan-300/70">Próximos 7 días</p>
        <p class="mt-1 text-2xl font-semibold text-cyan-200">{portfolioSummary.dueSoon}</p>
        <p class="mt-1 text-xs text-[var(--color-muted)]">Entregas previstas</p>
      </div>
    </div>

    <div class="mb-6 grid gap-3 lg:grid-cols-[1.35fr_1fr]">
      <div class="rounded-xl border border-purple-400/25 bg-purple-500/[0.07] p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-purple-bright)]">Objetivo económico · {new Date(`${currentMonth}-01T12:00:00`).toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</p>
            <p class="mt-2 text-2xl font-semibold tabular text-[var(--color-text)]">{formatEUR(currentMonthIncomeCents)} <span class="text-sm font-normal text-[var(--color-muted)]">de {currentGoalCents ? formatEUR(currentGoalCents) : "sin objetivo"}</span></p>
          </div>
          {#if currentGoalCents}
            <span class="rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-1 text-sm font-semibold text-[var(--color-purple-bright)]">{currentGoalProgress}%</span>
          {/if}
        </div>
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div class="h-full rounded-full bg-gradient-to-r from-purple-500 to-emerald-400 transition-all" style={`width: ${Math.min(currentGoalProgress, 100)}%`}></div>
        </div>
        {#if $isAdmin}
          <form class="mt-4 flex flex-wrap gap-2" onsubmit={(event) => { event.preventDefault(); saveEconomicGoal(); }}>
            <input class="field min-w-44 flex-1 text-sm" inputmode="decimal" bind:value={goalInput} placeholder="Objetivo del mes (€)" aria-label="Objetivo económico del mes en euros" />
            <Button type="submit" variant="secondary" disabled={savingGoal}>Guardar objetivo</Button>
          </form>
        {/if}
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-xl border border-[var(--color-border)] bg-black/20 p-4">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-dim)]">Avance medio</p>
          <p class="mt-2 text-2xl font-semibold text-[var(--color-purple-bright)]">{portfolioSummary.averageProgress}%</p>
          <p class="mt-1 text-xs text-[var(--color-muted)]">Proyectos no archivados</p>
        </div>
        <div class="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.05] p-4">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/70">Tareas hechas</p>
          <p class="mt-2 text-2xl font-semibold text-emerald-200">{portfolioSummary.completedTasks}<span class="text-sm text-[var(--color-muted)]">/{portfolioSummary.totalTasks}</span></p>
          <p class="mt-1 text-xs text-[var(--color-muted)]">En toda la cartera</p>
        </div>
      </div>
    </div>
  {/if}

  <!-- Status Filter Toolbar -->
  <div class="workspace-toolbar mb-6 flex flex-wrap items-center justify-between gap-4">
    <div class="flex flex-1 flex-wrap items-center gap-3">
      <input
        type="search"
        bind:value={filterText}
        placeholder="Buscar proyecto o cliente…"
        aria-label="Buscar proyecto o cliente"
        class="field min-w-56 flex-1 text-sm sm:max-w-xs"
      />
      <Select
        options={filterOptions}
        bind:value={filterStatus}
        placeholder="Todos"
        class="w-44"
      />
      <Select
        options={sortOptions}
        bind:value={sortBy}
        placeholder="Ordenar"
        class="w-52"
      />
      {#if filterText || filterStatus || sortBy !== "attention"}
        <Button variant="ghost" onclick={clearFilters} class="text-xs">Limpiar filtros</Button>
      {/if}
      {#if filterStatus}
        <span class="rounded-full border border-purple-400/25 bg-purple-500/10 px-2.5 py-1 text-[11px] text-[var(--color-purple-bright)]">
          Estado: {filterOptions.find((option) => option.value === filterStatus)?.label}
        </span>
      {/if}
      {#if filterText}
        <span class="max-w-48 truncate rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)]">Búsqueda: {filterText}</span>
      {/if}
    </div>
    <div class="text-xs text-[var(--color-muted-dim)]">
      Mostrando {filteredProjects.length} de {projects.length} proyectos
    </div>
  </div>

  <!-- Portfolio Grid -->
  {#if loading}
    <div class="py-16 text-center text-sm text-[var(--color-muted-dim)]">
      Cargando portafolio de proyectos...
    </div>
  {:else if filteredProjects.length === 0}
    <EmptyState
      title={projects.length === 0 ? "No hay proyectos en esta empresa" : "No hay proyectos que coincidan"}
      description={projects.length === 0 ? ($isAdmin ? "Crea el primer proyecto para organizar tus tareas e iniciativas." : "Un administrador debe crear el primer proyecto de esta empresa.") : "Prueba a cambiar o limpiar los filtros aplicados."}
    >
      {#if $isAdmin}
        <Button variant="primary" onclick={openCreateModal}>+ Nuevo proyecto</Button>
      {/if}
    </EmptyState>
  {:else}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each filteredProjects as project (project.id)}
        {@const metrics = projectMetrics.get(project.id) ?? { total: 0, completed: 0, blocked: 0, overdue: 0, dueSoon: 0, progress: 0, health: "on_track" as const, attentionScore: 0 }}
        <a
          href="/proyectos/{project.uid}"
          class="group block transition-transform duration-200 hover:-translate-y-0.5"
        >
          <Card lift={true} class="flex h-full flex-col justify-between border border-[var(--color-border)] p-5 hover:border-[var(--color-border-strong)]">
            <div>
              <!-- Top info: Title & Status -->
              <div class="flex items-start justify-between gap-2 mb-2">
                <div class="flex min-w-0 items-center gap-2.5">
                  {#if project.logo_data_url}
                    <img src={project.logo_data_url} alt="" class="h-9 w-9 shrink-0 rounded-lg border border-white/10 object-cover shadow-sm" data-project-card-logo />
                  {:else}
                    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-purple-400/20 bg-purple-500/10 text-sm font-bold uppercase text-purple-200" aria-hidden="true" data-project-card-logo>
                      {project.name.trim().charAt(0) || "P"}
                    </span>
                  {/if}
                  <h3 class="min-w-0 font-semibold text-base text-[var(--color-text)] group-hover:text-[var(--color-purple-bright)] transition-colors">
                    {project.name}
                  </h3>
                </div>
                <span class="shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide {healthClass(metrics.health)}">
                  {healthLabel(metrics.health)}
                </span>
              </div>

              <div class="mb-3 flex items-center gap-2">
                <Badge tone={projectStatusTone(project.status)}>{projectStatusLabel(project.status)}</Badge>
                {#if metrics.overdue > 0}
                  <span class="text-[11px] font-semibold text-rose-300">{metrics.overdue} vencida{metrics.overdue === 1 ? "" : "s"}</span>
                {:else if metrics.dueSoon > 0}
                  <span class="text-[11px] font-semibold text-amber-200">{metrics.dueSoon} próxima{metrics.dueSoon === 1 ? "" : "s"}</span>
                {/if}
              </div>

              <!-- Description -->
              <p class="mb-2 text-xs font-medium text-[var(--color-purple-bright)]">
                {project.customer_id
                  ? `Cliente: ${customers.find((customer) => customer.id === project.customer_id)?.name ?? "Cliente"}`
                  : "Proyecto propio"}
              </p>
              <p class="mb-3 text-sm font-semibold text-emerald-300">
                {project.customer_id
                  ? `Valor: ${formatEUR(project.value_cents)}`
                  : `Estimación mensual: ${formatEUR(project.monthly_estimate_cents)}`}
              </p>
              {#if project.description}
                <RichDescription value={project.description} class="mb-4 line-clamp-2 text-xs text-[var(--color-muted-dim)]" />
              {:else}
                <p class="text-xs text-[var(--color-muted-dim)] italic mb-4">
                  Sin descripción
                </p>
              {/if}
            </div>

            <div class="space-y-3 pt-3 border-t border-[var(--color-border-soft)]">
              <!-- Target date -->
              <div class="flex items-center justify-between text-xs text-[var(--color-muted)]">
                <span>Fecha objetivo:</span>
                <span class="font-medium tabular text-[var(--color-text)]">
                  📅 {formatDate(project.target_date)}
                </span>
              </div>

              <!-- Task Counts breakdown -->
              <div class="flex items-center gap-2 text-xs">
                <span class="rounded-md bg-white/5 px-2 py-1 text-[var(--color-muted)]">
                  Total: <strong class="text-[var(--color-text)]">{metrics.total}</strong>
                </span>
                <span class="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300">
                  Hechas: <strong>{metrics.completed}</strong>
                </span>
                {#if metrics.blocked > 0}
                  <span class="rounded-md bg-rose-500/10 px-2 py-1 text-rose-300">
                    Bloqueadas: <strong>{metrics.blocked}</strong>
                  </span>
                {/if}
              </div>

              <!-- Progress Bar -->
              <div class="space-y-1">
                <div class="flex items-center justify-between text-[11px] font-medium">
                  <span class="text-[var(--color-muted-dim)]">Progreso</span>
                  <span class="text-[var(--color-purple-bright)]">{metrics.progress}%</span>
                </div>
                <div class="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    class="h-full bg-gradient-to-r from-purple-500 to-indigo-400 transition-all duration-300"
                    style="width: {metrics.progress}%"
                  ></div>
                </div>
              </div>
            </div>
          </Card>
        </a>
      {/each}
    </div>
  {/if}
</section>

<!-- Project Creation Modal -->
<Modal
  open={modalOpen}
  title="Nuevo Proyecto"
  onclose={() => (modalOpen = false)}
>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleCreateProject();
    }}
    class="space-y-4 pt-1"
  >
    <div class="space-y-1">
      <label for="project-name" class="text-xs font-medium text-[var(--color-muted)]">Nombre del proyecto</label>
      <input
        id="project-name"
        type="text"
        bind:value={form.name}
        placeholder="Ej. Rediseño Web, Expansión Q3..."
        class="field w-full text-sm"
        required
      />
    </div>

    <RichDescriptionEditor
      id="project-desc"
      bind:value={form.description}
      placeholder="Describe el objetivo y alcance del proyecto…"
    />

    <Select
      label="Estado inicial"
      options={projectStatusOptions}
      bind:value={form.status}
    />

    <Select
      label="Tipo y cliente"
      options={customerOptions}
      bind:value={form.customer_id}
      placeholder="Proyecto propio (sin cliente)"
    />

    {#if form.customer_id}
      <div class="space-y-1">
        <label for="project-value" class="text-xs font-medium text-[var(--color-muted)]">Valor contratado (€)</label>
        <input id="project-value" type="text" inputmode="decimal" bind:value={form.value} placeholder="0,00" class="field w-full text-sm" />
      </div>
    {:else}
      <div class="space-y-3 rounded-xl border border-[var(--color-border)] p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-xs font-medium text-[var(--color-text)]">Hitos mensuales</p>
            <p class="text-[11px] text-[var(--color-muted-dim)]">Importe estimado y mes/año objetivo.</p>
          </div>
          <Button type="button" variant="secondary" disabled={!nextMilestoneMonth(milestoneMonthOptions, form.milestones)} onclick={addMilestone}>+ Añadir hito</Button>
        </div>
        {#each form.milestones as milestone, index}
          <div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input class="field w-full text-sm" inputmode="decimal" bind:value={milestone.amount} placeholder="Importe (€)" />
            <Select
              options={availableMilestoneMonths(milestoneMonthOptions, form.milestones, index)}
              bind:value={milestone.target_month}
              placeholder="Mes y año"
            />
            <Button type="button" variant="ghost" onclick={() => removeMilestone(index)}>Eliminar</Button>
          </div>
        {/each}
        {#if form.milestones.length === 0}
          <p class="text-xs text-[var(--color-muted-dim)]">Todavía no hay hitos económicos.</p>
        {/if}
      </div>
    {/if}

    <div class="grid gap-3 sm:grid-cols-2">
      <div class="space-y-1">
        <label for="project-start-date" class="text-xs font-medium text-[var(--color-muted)]">Fecha de inicio</label>
        <input
          id="project-start-date"
          type="date"
          bind:value={form.start_date}
          class="field w-full text-sm"
        />
      </div>
      <div class="space-y-1">
        <label for="project-target-date" class="text-xs font-medium text-[var(--color-muted)]">Fecha objetivo</label>
        <input
          id="project-target-date"
          type="date"
          bind:value={form.target_date}
          class="field w-full text-sm"
        />
      </div>
    </div>

    <div class="flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-4">
      <Button variant="ghost" type="button" onclick={() => (modalOpen = false)}>
        Cancelar
      </Button>
      <Button variant="primary" type="submit" disabled={saving}>
        Guardar proyecto
      </Button>
    </div>
  </form>
</Modal>
