<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { api, supportsOrcaWorker, usesLocalOrcaBridge } from "$lib/api/client";
  import { session, isAdmin } from "$lib/stores/session";
  import { showToast } from "$lib/stores/ui";
  import type {
    WorkProject,
    WorkItem,
    WorkCategory,
    WorkMember,
    WorkProjectInput,
    WorkItemInput,
    WorkStatus,
    WorkPriority,
    WorkItemType,
    Customer,
    CashKind,
    CashMovement,
  } from "$lib/types";
  import { formatEUR, parseEurosInput } from "$lib/money";
  import Button from "$lib/components/Button.svelte";
  import Card from "$lib/components/Card.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import Select from "$lib/components/Select.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import RichDescription from "$lib/components/RichDescription.svelte";
  import RichDescriptionEditor from "$lib/components/RichDescriptionEditor.svelte";
  import { countImportedTasks, parseTaskImport } from "$lib/work/task-import";
  import { formatTaskForAi } from "$lib/work/task-ai-copy";
  import { canDispatchToOrca, ORCA_SOURCE, orcaExecutionLabel, orcaExecutionState, workItemUpdateInput } from "$lib/work/orca-task";
  import { dispatchToLocalOrca, getLocalOrcaRun } from "$lib/work/orca-bridge";
  import { calculateTaskProgress } from "$lib/projects/task-progress";
  import { projectStatusLabel, projectStatusTone } from "$lib/projects/presentation";
  import { buildProjectEconomicSeries } from "$lib/projects/project-economics";
  import { hasInvalidDateRange, hasInvalidMoneyInput } from "$lib/projects/form-validation";
  import ProjectProgress from "$lib/components/projects/ProjectProgress.svelte";
  import { browser } from "$app/environment";

  const projectReference = $derived($page.params.id);

  let project = $state<WorkProject | null>(null);
  const projectId = $derived(project?.id ?? 0);
  let tasks = $state<WorkItem[]>([]);
  let categories = $state<WorkCategory[]>([]);
  let members = $state<WorkMember[]>([]);
  let projectsList = $state<WorkProject[]>([]);
  let customers = $state<Customer[]>([]);
  let cashMovements = $state<CashMovement[]>([]);
  let loading = $state(true);

  let viewMode = $state<"lista" | "kanban">(
    browser && localStorage.getItem("hexa-project-view") === "kanban" ? "kanban" : "lista",
  );
  let draggedTaskId = $state<number | null>(null);
  let dragOverStatus = $state<WorkStatus | null>(null);
  let dragOverParentId = $state<number | null>(null);
  let suppressTaskClick = $state(false);
  let statusUpdatingTaskId = $state<number | null>(null);
  let collapsedParentIds = $state<Set<number>>(new Set());

  // Quick Capture State
  let quickTitle = $state("");
  let quickSaving = $state(false);

  // Paste/import tasks from ChatGPT or another Markdown source.
  let importModalOpen = $state(false);
  let importText = $state("");
  let importDueDate = $state("");
  let importSaving = $state(false);
  let deletingProjectTasks = $state(false);
  let deleteTasksModalOpen = $state(false);
  let selectedTaskIds = $state<Set<number>>(new Set());
  const importedTasks = $derived(parseTaskImport(importText));
  const importedTaskCount = $derived(countImportedTasks(importedTasks));

  // Filters State
  let filterText = $state("");
  let filterStatus = $state("");
  let filterType = $state("");
  let filterPriority = $state("");
  let filterAssignee = $state("");

  // Edit Project Modal State
  let editProjectModalOpen = $state(false);
  let editProjectSaving = $state(false);
  let editProjectForm = $state({
    name: "",
    description: "",
    status: "active" as WorkProject["status"],
    customer_id: "",
    value: "",
    milestones: [] as { id?: number; amount: string; target_month: string }[],
    start_date: "",
    target_date: "",
  });
  let cashModalOpen = $state(false);
  let cashSaving = $state(false);
  let cashForm = $state({
    kind: "income" as CashKind,
    amount: "",
    description: "",
  });

  // Task Detail Modal State
  let detailModalOpen = $state(false);
  let editingTask = $state<WorkItem | null>(null);
  let newTaskParent = $state<WorkItem | null>(null);
  let taskSaving = $state(false);
  let orcaDispatchingTaskId = $state<number | null>(null);
  let syncingLocalOrcaRuns = $state(false);
  let detailForm = $state({
    title: "",
    description: "",
    type: "task" as WorkItemType,
    status: "inbox" as WorkStatus,
    priority: "normal" as WorkPriority,
    category_id: "",
    project_id: "",
    parent_id: "",
    assignee_id: "",
    start_date: "",
    due_date: "",
  });

  const statusOptions = [
    { value: "", label: "Todos los estados" },
    { value: "inbox", label: "Inbox" },
    { value: "planned", label: "Planificado" },
    { value: "in_progress", label: "En progreso" },
    { value: "blocked", label: "Bloqueado" },
    { value: "done", label: "Hecho" },
    { value: "archived", label: "Archivado" },
  ];

  const typeOptions = [
    { value: "", label: "Todos los tipos" },
    { value: "idea", label: "Idea" },
    { value: "task", label: "Tarea" },
    { value: "issue", label: "Incidencia" },
    { value: "milestone", label: "Hito" },
  ];

  const priorityOptions = [
    { value: "", label: "Todas las prioridades" },
    { value: "low", label: "Baja" },
    { value: "normal", label: "Normal" },
    { value: "high", label: "Alta" },
    { value: "urgent", label: "Urgente" },
  ];

  const detailTypeOptions = [
    { value: "task", label: "Tarea" },
    { value: "idea", label: "Idea" },
    { value: "issue", label: "Incidencia" },
    { value: "milestone", label: "Hito" },
  ];

  const detailStatusOptions = [
    { value: "inbox", label: "Inbox" },
    { value: "planned", label: "Planificado" },
    { value: "in_progress", label: "En progreso" },
    { value: "blocked", label: "Bloqueado" },
    { value: "done", label: "Hecho" },
    { value: "archived", label: "Archivado" },
  ];

  const detailPriorityOptions = [
    { value: "low", label: "Baja" },
    { value: "normal", label: "Normal" },
    { value: "high", label: "Alta" },
    { value: "urgent", label: "Urgente" },
  ];

  const projectStatusOptions = [
    { value: "planned", label: "Planificado" },
    { value: "active", label: "Activo" },
    { value: "paused", label: "En pausa" },
    { value: "done", label: "Completado" },
    { value: "archived", label: "Archivado" },
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

  const projectCustomer = $derived.by(() => {
    const customerId = project?.customer_id;
    return customerId
      ? customers.find((customer) => customer.id === customerId) ?? null
      : null;
  });

  const kanbanColumns: { status: WorkStatus; label: string; tone: "neutral" | "ok" | "warn" | "danger" | "ai" }[] = [
    { status: "inbox", label: "Inbox", tone: "neutral" },
    { status: "planned", label: "Planificado", tone: "warn" },
    { status: "in_progress", label: "En progreso", tone: "ai" },
    { status: "blocked", label: "Bloqueado", tone: "danger" },
    { status: "done", label: "Hecho", tone: "ok" },
  ];
  const visibleKanbanColumns = $derived(
    filterStatus === "archived"
      ? [{ status: "archived" as WorkStatus, label: "Archivado", tone: "neutral" as const }]
      : kanbanColumns,
  );

  const assigneeOptions = $derived([
    { value: "", label: "Todos los responsables" },
    ...members.map((m) => ({ value: String(m.id), label: m.display_name })),
  ]);

  const detailAssigneeOptions = $derived([
    { value: "", label: "Sin asignar" },
    ...members.map((m) => ({ value: String(m.id), label: m.display_name })),
  ]);

  const categoryOptions = $derived([
    { value: "", label: "Sin categoría" },
    ...categories.map((c) => ({ value: String(c.id), label: c.name })),
  ]);

  const detailProjectOptions = $derived([
    { value: "", label: "Sin proyecto" },
    ...projectsList.map((p) => ({ value: String(p.id), label: p.name })),
  ]);

  const taskParentOptions = $derived([
    { value: "", label: "Tarea principal (sin padre)" },
    ...tasks
      .filter(
        (task) =>
          task.parent_id == null &&
          task.status !== "archived" &&
          task.id !== editingTask?.id,
      )
      .map((task) => ({ value: String(task.id), label: task.title })),
  ]);

  async function loadData() {
    if (!projectReference) return;
    loading = true;
    try {
      const p = await api.getWorkProject(projectReference);
      const [itemsList, catList, memList, pList, customerList, movementList] = await Promise.all([
        api.listWorkItems({ project_id: p.id }),
        api.listWorkCategories(),
        api.listWorkMembers(),
        api.listWorkProjects(),
        api.listCustomers(),
        api.listCashMovements(),
      ]);
      project = p;
      tasks = itemsList;
      categories = catList;
      members = memList;
      projectsList = pList;
      customers = customerList;
      cashMovements = movementList;
      if (projectReference !== p.uid) {
        await goto(`/proyectos/${p.uid}`, { replaceState: true, noScroll: true });
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al cargar el proyecto", "err");
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const _cid = $session.activeCompanyId;
    const _reference = projectReference;
    loadData();
  });

  $effect(() => {
    if (browser) localStorage.setItem("hexa-project-view", viewMode);
  });

  $effect(() => {
    if (!usesLocalOrcaBridge()) return;
    const hasActiveRuns = tasks.some((task) => [ORCA_SOURCE.queued, ORCA_SOURCE.running].includes(task.source_type as typeof ORCA_SOURCE.queued));
    if (!hasActiveRuns) return;
    void syncLocalOrcaRuns();
    const timer = setInterval(() => void syncLocalOrcaRuns(), 3_000);
    return () => clearInterval(timer);
  });

  function clearTaskFilters() {
    filterText = "";
    filterStatus = "";
    filterType = "";
    filterPriority = "";
    filterAssignee = "";
  }

  // Calculate metrics
  const taskProgress = $derived(calculateTaskProgress(tasks));
  const totalTasks = $derived(taskProgress.total);
  const completedTasks = $derived(taskProgress.completed);
  const blockedTasks = $derived(tasks.filter((t) => t.status === "blocked").length);
  const progressPercent = $derived(taskProgress.progress);
  const projectSignals = $derived.by(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const inSevenDays = new Date(today);
    inSevenDays.setDate(inSevenDays.getDate() + 7);
    const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "archived");
    const overdue = openTasks.filter((task) => task.due_date && new Date(`${task.due_date}T00:00:00`) < today).length;
    const dueSoon = openTasks.filter((task) => {
      if (!task.due_date) return false;
      const due = new Date(`${task.due_date}T00:00:00`);
      return due >= today && due <= inSevenDays;
    }).length;
    const urgent = openTasks.filter((task) => task.priority === "urgent").length;
    const unassigned = openTasks.filter((task) => !task.assignee_id).length;
    const targetOverdue = Boolean(
      project?.target_date &&
      project.status !== "done" &&
      project.status !== "archived" &&
      new Date(`${project.target_date}T00:00:00`) < today,
    );
    const health = targetOverdue || overdue > 0
      ? { label: "Fuera de plazo", detail: "Hay trabajo vencido que requiere una nueva fecha o resolución.", className: "border-rose-400/30 bg-rose-500/10 text-rose-200" }
      : blockedTasks > 0 || dueSoon > 0
        ? { label: "En riesgo", detail: "Conviene revisar bloqueos y entregas de los próximos siete días.", className: "border-amber-400/30 bg-amber-500/10 text-amber-200" }
        : { label: "En curso", detail: "No se detectan bloqueos ni vencimientos inmediatos.", className: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" };
    return { overdue, dueSoon, urgent, unassigned, health };
  });
  const projectCashMovements = $derived(
    cashMovements.filter((movement) => movement.project_id === projectId),
  );
  const projectBilledCents = $derived(
    projectCashMovements
      .filter((movement) => movement.kind === "income")
      .reduce((sum, movement) => sum + movement.amount_cents, 0),
  );
  const projectSpentCents = $derived(
    projectCashMovements
      .filter((movement) => movement.kind === "expense")
      .reduce((sum, movement) => sum + movement.amount_cents, 0),
  );
  const economicSeries = $derived(project ? buildProjectEconomicSeries(project, projectCashMovements) : []);
  const economicChartMax = $derived(Math.max(1, ...economicSeries.flatMap((point) => [point.planned_cents, point.billed_cents])));
  const economicPlannedPoints = $derived(economicSeries.map((point, index) => `${36 + index * (648 / Math.max(1, economicSeries.length - 1))},${112 - (point.planned_cents / economicChartMax) * 76}`).join(" "));
  const economicBilledPoints = $derived(economicSeries.map((point, index) => `${36 + index * (648 / Math.max(1, economicSeries.length - 1))},${112 - (point.billed_cents / economicChartMax) * 76}`).join(" "));

  // Filter tasks
  const filteredTasks = $derived(
    tasks.filter((task) => {
      if (filterText.trim()) {
        const q = filterText.trim().toLowerCase();
        const titleMatch = task.title.toLowerCase().includes(q);
        const descMatch = (task.description || "").toLowerCase().includes(q);
        const catMatch = (task.category?.name || "").toLowerCase().includes(q);
        if (!titleMatch && !descMatch && !catMatch) return false;
      }
      if (filterStatus && task.status !== filterStatus) return false;
      if (filterType && task.type !== filterType) return false;
      if (filterPriority && task.priority !== filterPriority) return false;
      if (filterAssignee && String(task.assignee_id || "") !== filterAssignee) return false;
      return true;
    })
  );
  function taskSubtasks(taskId: number) {
    return tasks.filter((task) => task.parent_id === taskId && task.status !== "archived");
  }

  function visibleSubtasks(taskId: number) {
    return filteredTasks.filter((task) => task.parent_id === taskId);
  }

  const parentTasksForView = $derived(
    tasks.filter((task) => {
      if (task.parent_id != null) return false;
      if (task.status === "archived" && filterStatus !== "archived") return false;
      return filteredTasks.some((visible) => visible.id === task.id || visible.parent_id === task.id);
    }),
  );
  const parentIdsWithSubtasks = $derived(
    tasks
      .filter((task) => task.parent_id == null && taskSubtasks(task.id).length > 0)
      .map((task) => task.id),
  );
  const allSubtasksCollapsed = $derived(
    parentIdsWithSubtasks.length > 0 && parentIdsWithSubtasks.every((id) => collapsedParentIds.has(id)),
  );

  function isParentCollapsed(taskId: number) {
    return collapsedParentIds.has(taskId);
  }

  function toggleParent(event: MouseEvent, taskId: number) {
    event.stopPropagation();
    const next = new Set(collapsedParentIds);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    collapsedParentIds = next;
  }

  function toggleAllSubtasks() {
    collapsedParentIds = allSubtasksCollapsed
      ? new Set()
      : new Set(parentIdsWithSubtasks);
  }

  function hasSubtasks(taskId: number) {
    return taskSubtasks(taskId).length > 0;
  }

  function columnTasks(status: WorkStatus) {
    if (status === "archived") {
      return parentTasksForView.filter(
        (task) => task.status === "archived" || visibleSubtasks(task.id).some((child) => child.status === "archived"),
      );
    }
    return parentTasksForView.filter((task) => task.status === status);
  }

  function taskStatusLabel(s: string) {
    switch (s) {
      case "inbox": return "Inbox";
      case "planned": return "Planificado";
      case "in_progress": return "En progreso";
      case "blocked": return "Bloqueado";
      case "done": return "Hecho";
      case "archived": return "Archivado";
      default: return s;
    }
  }

  function taskTypeLabel(t: string) {
    switch (t) {
      case "idea": return "Idea";
      case "task": return "Tarea";
      case "issue": return "Incidencia";
      case "milestone": return "Hito";
      default: return t;
    }
  }

  function priorityLabel(p: string) {
    switch (p) {
      case "low": return "Baja";
      case "normal": return "Normal";
      case "high": return "Alta";
      case "urgent": return "Urgente";
      default: return p;
    }
  }

  function priorityBadgeTone(p: string): "neutral" | "ok" | "warn" | "danger" {
    switch (p) {
      case "low": return "neutral";
      case "normal": return "ok";
      case "high": return "warn";
      case "urgent": return "danger";
      default: return "neutral";
    }
  }

  function statusBadgeTone(s: string): "neutral" | "ok" | "warn" | "danger" | "ai" {
    switch (s) {
      case "done": return "ok";
      case "in_progress": return "ai";
      case "blocked": return "danger";
      case "planned": return "warn";
      default: return "neutral";
    }
  }

  function statusDotClass(status: WorkStatus) {
    switch (status) {
      case "planned": return "bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.12)]";
      case "in_progress": return "bg-purple-400 shadow-[0_0_0_3px_rgba(192,132,252,0.12)]";
      case "blocked": return "bg-rose-400 shadow-[0_0_0_3px_rgba(251,113,133,0.12)]";
      case "done": return "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]";
      default: return "bg-slate-400 shadow-[0_0_0_3px_rgba(148,163,184,0.1)]";
    }
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

  // Quick Capture for Project
  async function saveQuickTask() {
    if (!quickTitle.trim()) {
      showToast("Escribe un título para la tarea", "err");
      return;
    }
    quickSaving = true;
    try {
      await api.upsertWorkItem({
        title: quickTitle.trim(),
        project_id: projectId,
        type: "task",
        status: "inbox",
        priority: "normal",
      });
      quickTitle = "";
      showToast("Tarea añadida al proyecto");
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al crear tarea", "err");
    } finally {
      quickSaving = false;
    }
  }

  // Admin action: edit project
  function openEditProjectModal() {
    if (!project) return;
    editProjectForm = {
      name: project.name,
      description: project.description || "",
      status: project.status,
      customer_id: project.customer_id ? String(project.customer_id) : "",
      value: String((project.value_cents / 100).toFixed(2)).replace(".", ","),
      milestones: project.revenue_milestones.map((milestone) => ({
        id: milestone.id,
        amount: String((milestone.amount_cents / 100).toFixed(2)).replace(".", ","),
        target_month: milestone.target_month,
      })),
      start_date: project.start_date ? project.start_date.slice(0, 10) : "",
      target_date: project.target_date ? project.target_date.slice(0, 10) : "",
    };
    editProjectModalOpen = true;
  }

  async function handleSaveProject() {
    if (!project || !editProjectForm.name.trim()) {
      showToast("El nombre del proyecto es obligatorio", "err");
      return;
    }
    if (hasInvalidDateRange(editProjectForm.start_date, editProjectForm.target_date)) {
      showToast("La fecha objetivo no puede ser anterior a la fecha de inicio", "err");
      return;
    }
    if (editProjectForm.status === "done" && tasks.some((task) => task.status !== "done" && task.status !== "archived")) {
      showToast("Completa o archiva las tareas abiertas antes de marcar el proyecto como completado", "err");
      return;
    }
    const projectValue = parseEurosInput(editProjectForm.value);
    if (editProjectForm.customer_id && hasInvalidMoneyInput(editProjectForm.value)) {
      showToast("Introduce un valor contratado válido", "err");
      return;
    }
    const invalidMilestone = editProjectForm.milestones.some((milestone) => {
      return hasInvalidMoneyInput(milestone.amount);
    });
    if (!editProjectForm.customer_id && invalidMilestone) {
      showToast("Revisa los importes de los hitos mensuales", "err");
      return;
    }
    editProjectSaving = true;
    try {
      await api.upsertWorkProject({
        id: project.id,
        name: editProjectForm.name.trim(),
        description: editProjectForm.description.trim(),
        status: editProjectForm.status,
        customer_id: editProjectForm.customer_id ? Number(editProjectForm.customer_id) : null,
        value_cents: editProjectForm.customer_id
          ? (projectValue ?? 0)
          : 0,
        monthly_estimate_cents: editProjectForm.customer_id
          ? 0
          : editProjectForm.milestones.reduce(
              (sum, milestone) => sum + (parseEurosInput(milestone.amount) ?? 0),
              0,
            ),
        revenue_target_date: null,
        revenue_milestones: editProjectForm.customer_id
          ? []
          : editProjectForm.milestones
              .map((milestone) => ({
                id: milestone.id,
                amount_cents: parseEurosInput(milestone.amount) ?? 0,
                target_month: milestone.target_month,
              }))
              .filter((milestone) => milestone.amount_cents > 0 && milestone.target_month),
        start_date: editProjectForm.start_date || null,
        target_date: editProjectForm.target_date || null,
      });
      showToast("Proyecto actualizado");
      editProjectModalOpen = false;
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al actualizar proyecto", "err");
    } finally {
      editProjectSaving = false;
    }
  }

  function addEditMilestone() {
    editProjectForm.milestones = [
      ...editProjectForm.milestones,
      { amount: "", target_month: currentMonth },
    ];
  }

  function removeEditMilestone(index: number) {
    editProjectForm.milestones = editProjectForm.milestones.filter(
      (_, itemIndex) => itemIndex !== index,
    );
  }

  function openCashModal(kind: CashKind) {
    if (!project?.customer_id) {
      showToast("Los proyectos propios no admiten movimientos de pago", "err");
      return;
    }
    cashForm = { kind, amount: "", description: "" };
    cashModalOpen = true;
  }

  async function saveProjectMovement() {
    if (!project) return;
    const amountCents = parseEurosInput(cashForm.amount);
    if (amountCents === null || amountCents <= 0) {
      showToast("Introduce un importe válido", "err");
      return;
    }
    if (!cashForm.description.trim()) {
      showToast("Indica el concepto del movimiento", "err");
      return;
    }
    cashSaving = true;
    try {
      await api.createCashMovement({
        project_id: project.id,
        kind: cashForm.kind,
        amount_cents: amountCents,
        category: cashForm.kind === "income" ? "facturacion_proyecto" : "gasto_proyecto",
        description: `[${project.name}] ${cashForm.description.trim()}`,
      });
      cashModalOpen = false;
      showToast(cashForm.kind === "income" ? "Facturación registrada" : "Gasto registrado");
      await loadData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al registrar el movimiento", "err");
    } finally {
      cashSaving = false;
    }
  }

  // Task Modal Handlers
  function openNewTaskModal() {
    editingTask = null;
    newTaskParent = null;
    detailForm = {
      title: "",
      description: "",
      type: "task",
      status: "inbox",
      priority: "normal",
      category_id: "",
      project_id: String(projectId),
      parent_id: "",
      assignee_id: "",
      start_date: "",
      due_date: "",
    };
    detailModalOpen = true;
  }

  function openImportModal() {
    importText = "";
    importDueDate = "";
    importModalOpen = true;
  }

  async function handleImportTasks() {
    if (!project || importedTasks.length === 0 || importSaving) return;
    importSaving = true;
    let created = 0;
    try {
      for (const imported of importedTasks) {
        const parentDueDate = imported.due_date || importDueDate || null;
        const parent = await api.upsertWorkItem({
          title: imported.title,
          description: imported.description,
          project_id: project.id,
          type: "task",
          status: "inbox",
          priority: "normal",
          due_date: parentDueDate,
        });
        created += 1;

        for (const subtask of imported.subtasks) {
          await api.upsertWorkItem({
            title: subtask.title,
            description: subtask.description,
            parent_id: parent.id,
            project_id: project.id,
            type: "task",
            status: "inbox",
            priority: "normal",
            due_date: subtask.due_date || parentDueDate,
          });
          created += 1;
        }
      }

      importModalOpen = false;
      importText = "";
      importDueDate = "";
      showToast(`Se han creado ${created} tareas y subtareas`);
      await loadData();
    } catch (error) {
      await loadData();
      const reason = error instanceof Error ? error.message : "Error desconocido";
      showToast(`Se crearon ${created} elementos antes del error: ${reason}`, "err");
    } finally {
      importSaving = false;
    }
  }

  function openDeleteTasksModal() {
    selectedTaskIds = new Set();
    deleteTasksModalOpen = true;
  }

  function toggleTaskForDeletion(id: number) {
    const next = new Set(selectedTaskIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedTaskIds = next;
  }

  function toggleAllTasksForDeletion() {
    selectedTaskIds = selectedTaskIds.size === tasks.length
      ? new Set()
      : new Set(tasks.map((task) => task.id));
  }

  async function handleDeleteSelectedProjectTasks() {
    if (!project || selectedTaskIds.size === 0 || deletingProjectTasks) return;

    deletingProjectTasks = true;
    try {
      const deleted = await api.deleteProjectWorkItems(project.id, [...selectedTaskIds]);
      deleteTasksModalOpen = false;
      selectedTaskIds = new Set();
      showToast(`Se han eliminado ${deleted} tareas y subtareas`);
      await loadData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudieron eliminar las tareas", "err");
    } finally {
      deletingProjectTasks = false;
    }
  }

  function openNewSubtaskModal(event: MouseEvent, parent: WorkItem) {
    event.stopPropagation();
    editingTask = null;
    newTaskParent = parent;
    detailForm = {
      title: "",
      description: "",
      type: "task",
      status: "inbox",
      priority: parent.priority,
      category_id: parent.category_id ? String(parent.category_id) : "",
      project_id: String(parent.project_id ?? projectId),
      parent_id: String(parent.id),
      assignee_id: parent.assignee_id ? String(parent.assignee_id) : "",
      start_date: "",
      due_date: "",
    };
    detailModalOpen = true;
  }

  async function copyTaskForAi(event: MouseEvent, task: WorkItem) {
    event.stopPropagation();
    const text = formatTaskForAi(task, taskSubtasks(task.id), project);
    try {
      await navigator.clipboard.writeText(text);
      showToast("Tarea y subtareas copiadas para la IA");
    } catch {
      showToast("El navegador no ha permitido copiar al portapapeles", "err");
    }
  }

  async function dispatchTaskToOrca(task: WorkItem) {
    if (!$isAdmin) {
      showToast("Solo los administradores pueden enviar tareas a Orca", "err");
      return;
    }
    if (!supportsOrcaWorker()) {
      showToast("Orca requiere la versión web de Hexa", "err");
      return;
    }
    if (!canDispatchToOrca(task)) {
      showToast("Esta tarea no se puede enviar a Orca en su estado actual", "err");
      return;
    }
    orcaDispatchingTaskId = task.id;
    try {
      if (usesLocalOrcaBridge()) {
        const run = await dispatchToLocalOrca({
          task,
          subtasks: taskSubtasks(task.id),
          project: project ? { name: project.name, description: project.description } : null,
        });
        await api.upsertWorkItem(workItemUpdateInput(task, {
          status: "planned",
          source_type: ORCA_SOURCE.queued,
          source_key: run.id,
          source_href: run.worktree_id,
        }));
      } else {
        await api.upsertWorkItem(workItemUpdateInput(task, {
          status: "planned",
          source_type: ORCA_SOURCE.queued,
          source_key: crypto.randomUUID(),
          source_href: null,
        }));
      }
      detailModalOpen = false;
      showToast("Tarea enviada a la cola local de Orca");
      await loadData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo enviar la tarea a Orca", "err");
    } finally {
      orcaDispatchingTaskId = null;
    }
  }

  async function syncLocalOrcaRuns() {
    if (syncingLocalOrcaRuns || !usesLocalOrcaBridge()) return;
    const activeTasks = tasks.filter(
      (task) => task.parent_id == null && [ORCA_SOURCE.queued, ORCA_SOURCE.running].includes(task.source_type as typeof ORCA_SOURCE.queued) && task.source_key,
    );
    if (!activeTasks.length) return;
    syncingLocalOrcaRuns = true;
    let changed = false;
    try {
      for (const task of activeTasks) {
        try {
          const run = await getLocalOrcaRun(task.source_key!);
          if (run.status === "running" && (task.source_type !== ORCA_SOURCE.running || task.source_href !== run.worktree_id)) {
            await api.upsertWorkItem(workItemUpdateInput(task, {
              status: "in_progress",
              source_type: ORCA_SOURCE.running,
              source_href: run.worktree_id,
            }));
            changed = true;
          } else if (run.status === "completed") {
            for (const child of taskSubtasks(task.id).filter((item) => item.status !== "done")) {
              await api.upsertWorkItem(workItemUpdateInput(child, {
                status: "done",
                source_type: ORCA_SOURCE.completed,
                source_key: run.commit,
                source_href: run.worktree_id,
              }));
            }
            await api.upsertWorkItem(workItemUpdateInput(task, {
              status: "done",
              source_type: ORCA_SOURCE.completed,
              source_key: run.commit,
              source_href: run.worktree_id,
            }));
            changed = true;
            showToast(`Orca ha completado «${task.title}»`);
          } else if (run.status === "failed") {
            await api.upsertWorkItem(workItemUpdateInput(task, {
              status: "blocked",
              source_type: ORCA_SOURCE.failed,
              source_key: run.error || "La ejecución local de Orca ha fallado",
              source_href: run.worktree_id,
            }));
            changed = true;
            showToast(`Orca ha bloqueado «${task.title}»`, "err");
          }
        } catch {
          // El worker puede estar reiniciándose o temporalmente desconectado; se reintentará.
        }
      }
      if (changed) await loadData();
    } finally {
      syncingLocalOrcaRuns = false;
    }
  }

  function openEditTaskModal(task: WorkItem) {
    editingTask = task;
    newTaskParent = null;
    detailForm = {
      title: task.title,
      description: task.description || "",
      type: task.type,
      status: task.status,
      priority: task.priority,
      category_id: task.category_id ? String(task.category_id) : "",
      project_id: task.project_id ? String(task.project_id) : String(projectId),
      parent_id: task.parent_id ? String(task.parent_id) : "",
      assignee_id: task.assignee_id ? String(task.assignee_id) : "",
      start_date: task.start_date ? task.start_date.slice(0, 10) : "",
      due_date: task.due_date ? task.due_date.slice(0, 10) : "",
    };
    detailModalOpen = true;
  }

  async function handleSaveTask() {
    if (!detailForm.title.trim()) {
      showToast("El título de la tarea es obligatorio", "err");
      return;
    }
    if (hasInvalidDateRange(detailForm.start_date, detailForm.due_date)) {
      showToast("La fecha límite no puede ser anterior a la fecha de inicio", "err");
      return;
    }
    taskSaving = true;
    try {
      const input: WorkItemInput = {
        id: editingTask?.id,
        parent_id: editingTask
          ? (detailForm.parent_id ? Number(detailForm.parent_id) : null)
          : newTaskParent?.id,
        title: detailForm.title.trim(),
        description: detailForm.description.trim(),
        type: detailForm.type,
        status: detailForm.status,
        priority: detailForm.priority,
        category_id: detailForm.category_id ? Number(detailForm.category_id) : null,
        project_id: detailForm.project_id ? Number(detailForm.project_id) : null,
        assignee_id: detailForm.assignee_id ? Number(detailForm.assignee_id) : null,
        start_date: detailForm.start_date || null,
        due_date: detailForm.due_date || null,
      };
      await api.upsertWorkItem(input);
      showToast(editingTask ? "Tarea actualizada" : newTaskParent ? "Subtarea creada correctamente" : "Tarea creada correctamente");
      detailModalOpen = false;
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al guardar tarea", "err");
    } finally {
      taskSaving = false;
    }
  }

  async function handleArchiveTask() {
    if (!editingTask) return;
    try {
      await api.archiveWorkItem(editingTask.id);
      showToast("Tarea archivada");
      detailModalOpen = false;
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al archivar tarea", "err");
    }
  }

  // Change status directly in Kanban
  async function updateTaskStatus(task: WorkItem, newStatus: WorkStatus) {
    if (task.status === newStatus || statusUpdatingTaskId === task.id) return;
    const previousStatus = task.status;
    statusUpdatingTaskId = task.id;
    tasks = tasks.map((item) =>
      item.id === task.id ? { ...item, status: newStatus } : item,
    );
    try {
      await api.upsertWorkItem({
        id: task.id,
        title: task.title,
        status: newStatus,
      });
      await loadData();
      showToast(`Estado actualizado a ${taskStatusLabel(newStatus)}`);
    } catch (err) {
      tasks = tasks.map((item) =>
        item.id === task.id ? { ...item, status: previousStatus } : item,
      );
      showToast(err instanceof Error ? err.message : "Error al actualizar estado", "err");
    } finally {
      statusUpdatingTaskId = null;
    }
  }

  async function updateTaskParent(task: WorkItem, parent: WorkItem) {
    if (
      task.id === parent.id ||
      parent.parent_id != null ||
      hasSubtasks(task.id) ||
      statusUpdatingTaskId === task.id
    ) return;
    statusUpdatingTaskId = task.id;
    try {
      await api.upsertWorkItem({
        id: task.id,
        title: task.title,
        parent_id: parent.id,
      });
      showToast(`«${task.title}» ahora es subtarea de «${parent.title}»`);
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al mover la subtarea", "err");
    } finally {
      statusUpdatingTaskId = null;
    }
  }

  function handleTaskDragStart(event: DragEvent, task: WorkItem) {
    if (!event.dataTransfer || statusUpdatingTaskId === task.id || hasSubtasks(task.id)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(task.id));
    draggedTaskId = task.id;
    suppressTaskClick = true;
  }

  function handleTaskDragEnd() {
    draggedTaskId = null;
    dragOverStatus = null;
    dragOverParentId = null;
    setTimeout(() => {
      suppressTaskClick = false;
    }, 0);
  }

  function handleColumnDragOver(event: DragEvent, status: WorkStatus) {
    if (draggedTaskId === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dragOverStatus = status;
  }

  function handleTaskDrop(event: DragEvent, status: WorkStatus) {
    event.preventDefault();
    const transferredId = Number(event.dataTransfer?.getData("text/plain"));
    const taskId = draggedTaskId ?? (Number.isFinite(transferredId) ? transferredId : null);
    const task = tasks.find((item) => item.id === taskId);
    draggedTaskId = null;
    dragOverStatus = null;
    if (task) void updateTaskStatus(task, status);
  }

  function handleParentDragOver(event: DragEvent, parent: WorkItem) {
    if (!event.shiftKey) {
      if (dragOverParentId === parent.id) dragOverParentId = null;
      return;
    }
    const dragged = tasks.find((task) => task.id === draggedTaskId);
    if (
      !dragged ||
      dragged.id === parent.id ||
      parent.parent_id != null ||
      hasSubtasks(dragged.id)
    ) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dragOverParentId = parent.id;
    dragOverStatus = null;
  }

  function handleParentDragLeave(event: DragEvent, parent: WorkItem) {
    if (
      event.relatedTarget instanceof Node &&
      (event.currentTarget as HTMLElement).contains(event.relatedTarget)
    ) return;
    if (dragOverParentId === parent.id) dragOverParentId = null;
  }

  function handleParentDrop(event: DragEvent, parent: WorkItem) {
    if (!event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    const transferredId = Number(event.dataTransfer?.getData("text/plain"));
    const taskId = draggedTaskId ?? (Number.isFinite(transferredId) ? transferredId : null);
    const task = tasks.find((item) => item.id === taskId);
    draggedTaskId = null;
    dragOverParentId = null;
    dragOverStatus = null;
    if (task) void updateTaskParent(task, parent);
  }


</script>

<section class="proyecto-detalle-page workspace-page">
  {#if loading}
    <div class="py-16 text-center text-sm text-[var(--color-muted-dim)]">
      Cargando detalle del proyecto...
    </div>
  {:else if !project}
    <EmptyState
      title="Proyecto no encontrado"
      description="No existe el proyecto solicitado o no pertenece a la empresa activa."
    >
      <Button variant="primary" onclick={() => goto("/proyectos")}>
        Volver a Proyectos
      </Button>
    </EmptyState>
  {:else}
    <!-- Top Nav / Back Button -->
    <div class="mb-4 flex items-center justify-between">
      <a
        href="/proyectos"
        class="inline-flex items-center gap-2 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-purple-bright)] transition"
      >
        ← Volver a Proyectos
      </a>
      {#if $isAdmin}
        <div class="flex items-center gap-2">
          <Button variant="secondary" onclick={openEditProjectModal} class="text-xs">
            Editar proyecto
          </Button>
        </div>
      {/if}
    </div>

    <!-- Project Header Banner -->
    <Card lift={false} class="mb-6 border border-[var(--color-border-strong)] bg-purple-950/20 p-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 max-w-3xl">
          <div class="flex flex-wrap items-center gap-3 mb-2">
            <h1 class="text-2xl font-bold text-[var(--color-text)]">
              {project.name}
            </h1>
            <Badge tone={projectStatusTone(project.status)}>
              {projectStatusLabel(project.status)}
            </Badge>
          </div>

          {#if project.description}
            <RichDescription value={project.description} class="mb-4 text-sm leading-relaxed text-[var(--color-muted)]" />
          {/if}

          <div class="flex flex-wrap items-center gap-6 text-xs text-[var(--color-muted-dim)]">
            <span>
              Cliente:
              <strong class="text-[var(--color-text)]">
                {projectCustomer?.name ?? "Proyecto propio"}
              </strong>
            </span>
            {#if project.start_date}
              <span>Inicio: <strong class="text-[var(--color-text)]">{formatDate(project.start_date)}</strong></span>
            {/if}
            <span>Objetivo: <strong class="text-[var(--color-text)]">{formatDate(project.target_date)}</strong></span>
          </div>
        </div>

        <ProjectProgress total={totalTasks} completed={completedTasks} blocked={blockedTasks} progress={progressPercent} />
      </div>
    </Card>

    <Card lift={false} class="mb-6 border border-[var(--color-border-strong)] p-5">
      <details open>
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400">
          <span class="section-label">ECONOMÍA DEL PROYECTO</span>
          <span class="text-xs text-[var(--color-purple-bright)]">Mostrar / ocultar</span>
        </summary>
      <div class="mb-4 mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-xs text-[var(--color-muted-dim)]">
            {project.customer_id
              ? "Valor contratado, cobros y gastos registrados en Caja."
              : "Objetivo económico estimado para este proyecto propio."}
          </p>
        </div>
        {#if project.customer_id}
          <div class="flex gap-2">
            <Button variant="secondary" onclick={() => openCashModal("expense")}>− Registrar gasto</Button>
            <Button variant="primary" onclick={() => openCashModal("income")}>+ Registrar cobro</Button>
          </div>
        {/if}
      </div>
      {#if project.customer_id}
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-xl border border-purple-400/20 bg-purple-500/[0.06] p-3">
            <p class="text-xs text-[var(--color-muted)]">Valor contratado</p>
            <p class="mt-1 text-xl font-semibold text-radiant">{formatEUR(project.value_cents)}</p>
          </div>
          <div class="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] p-3">
            <p class="text-xs text-[var(--color-muted)]">Cobrado</p>
            <p class="mt-1 text-xl font-semibold text-emerald-300">{formatEUR(projectBilledCents)}</p>
          </div>
          <div class="rounded-xl border border-rose-400/20 bg-rose-500/[0.06] p-3">
            <p class="text-xs text-[var(--color-muted)]">Gastado</p>
            <p class="mt-1 text-xl font-semibold text-rose-300">{formatEUR(projectSpentCents)}</p>
          </div>
          <div class="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.06] p-3">
            <p class="text-xs text-[var(--color-muted)]">Resultado de caja</p>
            <p class="mt-1 text-xl font-semibold text-cyan-300">{formatEUR(projectBilledCents - projectSpentCents)}</p>
          </div>
        </div>
      {:else}
        <div class="rounded-xl border border-purple-400/20 bg-purple-500/[0.06] p-3">
          <p class="text-xs text-[var(--color-muted)]">Estimación total de hitos</p>
          <p class="mt-1 text-xl font-semibold text-radiant">
            {formatEUR(project.revenue_milestones.reduce((sum, milestone) => sum + milestone.amount_cents, 0))}
          </p>
        </div>
      {/if}
      {#if economicSeries.length > 0}
        <div class="mt-3 grid items-stretch gap-3 {project.customer_id == null && project.revenue_milestones.length > 0 ? 'lg:grid-cols-[minmax(0,1fr)_15rem]' : ''}">
        <div class="min-w-0 rounded-xl border border-white/[0.07] bg-black/10 p-3">
          <div class="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="text-xs font-semibold text-[var(--color-text)]">Facturación prevista vs. real</p>
              <p class="text-[11px] text-[var(--color-muted-dim)]">Evolución acumulada por mes</p>
            </div>
            <div class="flex gap-4 text-[11px]">
              <span class="flex items-center gap-1.5 text-purple-200"><span class="h-0.5 w-5 bg-purple-400"></span>Previsto</span>
              <span class="flex items-center gap-1.5 text-emerald-200"><span class="h-0.5 w-5 bg-emerald-400"></span>Facturado</span>
            </div>
          </div>
          <div class="overflow-x-auto">
            <svg viewBox="0 0 720 142" class="min-w-[560px] w-full opacity-80" role="img" aria-label="Comparación acumulada entre facturación prevista y real">
              <line x1="36" y1="112" x2="684" y2="112" stroke="rgba(255,255,255,.1)" />
              <line x1="36" y1="74" x2="684" y2="74" stroke="rgba(255,255,255,.045)" stroke-dasharray="3 6" />
              <line x1="36" y1="36" x2="684" y2="36" stroke="rgba(255,255,255,.045)" stroke-dasharray="3 6" />
              <polyline points={economicPlannedPoints} fill="none" stroke="#c084fc" stroke-opacity=".75" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              <polyline points={economicBilledPoints} fill="none" stroke="#34d399" stroke-opacity=".8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              {#each economicSeries as point, index (point.month)}
                {@const x = 36 + index * (648 / Math.max(1, economicSeries.length - 1))}
                {@const tooltipX = Math.min(558, Math.max(4, x - 79))}
                <g class="group cursor-help">
                  <rect x={x - 18} y="22" width="36" height="112" fill="transparent" />
                  <circle cx={x} cy={112 - (point.planned_cents / economicChartMax) * 76} r="2.5" fill="#c084fc" class="transition group-hover:r-4" />
                  <circle cx={x} cy={112 - (point.billed_cents / economicChartMax) * 76} r="2.5" fill="#34d399" class="transition group-hover:r-4" />
                  <text x={x} y="135" text-anchor="middle" fill="rgba(226,232,240,.5)" font-size="9">{point.label}</text>
                  <foreignObject x={tooltipX} y="2" width="158" height="68" class="pointer-events-none hidden overflow-visible group-hover:block">
                    <div class="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-obsidian-elevated)] px-2.5 py-2 text-[10px] shadow-xl">
                      <p class="mb-1 font-bold uppercase tracking-wide text-[var(--color-purple-bright)]">{point.label}</p>
                      <p class="flex justify-between gap-3 text-[var(--color-muted)]"><span>Previsto</span><strong class="text-purple-200">{formatEUR(point.planned_cents)}</strong></p>
                      <p class="flex justify-between gap-3 text-[var(--color-muted)]"><span>Facturado</span><strong class="text-emerald-300">{formatEUR(point.billed_cents)}</strong></p>
                    </div>
                  </foreignObject>
                </g>
              {/each}
            </svg>
          </div>
          <div class="mt-2 flex flex-wrap justify-between gap-2 border-t border-white/5 pt-3 text-xs">
            <span class="text-[var(--color-muted)]">Objetivo a fecha: <strong class="text-purple-200">{formatEUR(economicSeries.at(-1)?.planned_cents ?? 0)}</strong></span>
            <span class="text-[var(--color-muted)]">Facturado: <strong class="text-emerald-200">{formatEUR(economicSeries.at(-1)?.billed_cents ?? 0)}</strong></span>
            <span class={(economicSeries.at(-1)?.billed_cents ?? 0) >= (economicSeries.at(-1)?.planned_cents ?? 0) ? "text-emerald-300" : "text-amber-300"}>
              Desviación: {formatEUR((economicSeries.at(-1)?.billed_cents ?? 0) - (economicSeries.at(-1)?.planned_cents ?? 0))}
            </span>
          </div>
        </div>
        {#if project.customer_id == null && project.revenue_milestones.length > 0}
          <aside class="rounded-xl border border-white/[0.07] bg-black/10 p-3">
            <p class="text-xs font-semibold text-[var(--color-text)]">Hitos previstos</p>
            <div class="mt-2 space-y-1.5">
              {#each [...project.revenue_milestones].sort((a, b) => a.target_month.localeCompare(b.target_month)) as milestone (milestone.id)}
                <div class="flex items-center justify-between gap-3 rounded-lg bg-white/[0.025] px-2.5 py-2">
                  <span class="text-[10px] capitalize text-[var(--color-muted-dim)]">
                    {new Date(`${milestone.target_month}-01T12:00:00`).toLocaleDateString("es-ES", { month: "short", year: "numeric" }).replace(".", "")}
                  </span>
                  <strong class="text-xs tabular text-purple-200">{formatEUR(milestone.amount_cents)}</strong>
                </div>
              {/each}
            </div>
          </aside>
        {/if}
        </div>
      {/if}
      </details>
    </Card>

    <details open class="mb-6 rounded-2xl border border-[var(--color-border)] bg-black/10 p-4">
      <summary class="flex cursor-pointer list-none items-center justify-between gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400">
        <span class="section-label">SALUD Y SEÑALES</span>
        <span class="text-xs text-[var(--color-muted)]">{projectSignals.health.label} · {projectSignals.overdue} vencidas · {projectSignals.dueSoon} próximas</span>
      </summary>
    <div class="mt-4 grid gap-3 lg:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
      <div class="rounded-xl border p-4 {projectSignals.health.className}">
        <p class="text-[11px] font-bold uppercase tracking-wider opacity-75">Salud del proyecto</p>
        <div class="mt-1 flex items-center gap-2">
          <span class="h-2.5 w-2.5 rounded-full bg-current"></span>
          <p class="text-base font-semibold">{projectSignals.health.label}</p>
        </div>
        <p class="mt-1 text-xs leading-relaxed opacity-75">{projectSignals.health.detail}</p>
      </div>
      <div class="rounded-xl border border-rose-400/20 bg-rose-500/[0.05] p-4">
        <p class="text-2xl font-semibold text-rose-200">{projectSignals.overdue}</p>
        <p class="mt-1 text-xs text-[var(--color-muted)]">Tareas vencidas</p>
      </div>
      <div class="rounded-xl border border-amber-400/20 bg-amber-500/[0.05] p-4">
        <p class="text-2xl font-semibold text-amber-200">{projectSignals.dueSoon}</p>
        <p class="mt-1 text-xs text-[var(--color-muted)]">Próximas 7 días</p>
      </div>
      <div class="rounded-xl border border-purple-400/20 bg-purple-500/[0.05] p-4">
        <p class="text-2xl font-semibold text-purple-200">{projectSignals.urgent}</p>
        <p class="mt-1 text-xs text-[var(--color-muted)]">Prioridad urgente</p>
      </div>
      <div class="rounded-xl border border-[var(--color-border)] bg-black/20 p-4">
        <p class="text-2xl font-semibold text-[var(--color-text)]">{projectSignals.unassigned}</p>
        <p class="mt-1 text-xs text-[var(--color-muted)]">Sin responsable</p>
      </div>
    </div>
    </details>

    <!-- Quick Capture Form for this Project -->
    <Card lift={false} class="mb-6 border border-[var(--color-border)] bg-purple-950/10 p-4">
      <form
        onsubmit={(e) => {
          e.preventDefault();
          saveQuickTask();
        }}
        class="flex flex-wrap items-center gap-3 sm:flex-nowrap"
      >
        <input
          type="text"
          bind:value={quickTitle}
          placeholder="Añadir nueva tarea rápida a este proyecto..."
          class="field flex-1 min-w-[16rem] text-sm"
        />
        <Button variant="primary" type="submit" disabled={quickSaving} class="shrink-0">
          + Guardar tarea
        </Button>
      </form>
    </Card>

    <!-- Workspace Toolbar: Filters & View Mode Toggle -->
    <div class="workspace-toolbar mb-6 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-3 flex-1">
        <input
          type="text"
          bind:value={filterText}
          placeholder="Buscar tareas en este proyecto…"
          class="field w-full max-w-xs text-sm"
        />
        <Select
          options={statusOptions}
          bind:value={filterStatus}
          placeholder="Todos los estados"
          class="w-44"
        />
        <Select
          options={typeOptions}
          bind:value={filterType}
          placeholder="Todos los tipos"
          class="w-40"
        />
        <Select
          options={priorityOptions}
          bind:value={filterPriority}
          placeholder="Todas las prioridades"
          class="w-44"
        />
        <Select
          options={assigneeOptions}
          bind:value={filterAssignee}
          placeholder="Todos los responsables"
          class="w-48"
        />
        {#if filterText || filterStatus || filterType || filterPriority || filterAssignee}
          <Button variant="ghost" onclick={clearTaskFilters} class="text-xs">Limpiar filtros</Button>
        {/if}
        {#if filterStatus}
          <span class="rounded-full border border-purple-400/25 bg-purple-500/10 px-2.5 py-1 text-[11px] text-[var(--color-purple-bright)]">{statusOptions.find((option) => option.value === filterStatus)?.label}</span>
        {/if}
        {#if filterPriority}
          <span class="rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-200">{priorityOptions.find((option) => option.value === filterPriority)?.label}</span>
        {/if}
        {#if filterType || filterAssignee}
          <span class="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)]">Filtros adicionales activos</span>
        {/if}
      </div>

      <!-- View Switcher -->
      <div class="grid w-full gap-2 lg:w-auto">
        <div class="flex flex-wrap items-center gap-2 lg:justify-end" data-task-view-actions>
          <div class="inline-flex rounded-xl border border-[var(--color-border)] bg-black/20 p-1">
            <button
              type="button"
              class="rounded-lg px-3 py-1.5 text-xs font-medium transition {viewMode === 'lista'
                ? 'bg-[var(--color-purple-deep)] text-white shadow'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}"
              onclick={() => (viewMode = "lista")}
            >
              ☰ Lista
            </button>
            <button
              type="button"
              class="rounded-lg px-3 py-1.5 text-xs font-medium transition {viewMode === 'kanban'
                ? 'bg-[var(--color-purple-deep)] text-white shadow'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}"
              onclick={() => (viewMode = "kanban")}
            >
              ◫ Kanban
            </button>
          </div>

          {#if parentIdsWithSubtasks.length > 0}
            <Button variant="secondary" onclick={toggleAllSubtasks} class="text-xs" aria-expanded={!allSubtasksCollapsed}>
              {allSubtasksCollapsed ? "Mostrar subtareas" : "Ocultar subtareas"}
            </Button>
          {/if}
        </div>

        <div class="flex flex-wrap items-center gap-2 lg:justify-end" data-task-edit-actions>
          <Button variant="primary" onclick={openNewTaskModal} class="text-xs">+ Nueva tarea</Button>
          <Button variant="secondary" onclick={openImportModal} class="text-xs">Pegar tareas</Button>
          {#if $isAdmin && tasks.length > 0}
            <Button variant="danger" onclick={openDeleteTasksModal} disabled={deletingProjectTasks} class="text-xs">
              Eliminar tareas…
            </Button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Content: Lista or Kanban -->
    {#if filteredTasks.length === 0}
      <EmptyState
        title="No hay tareas en este proyecto"
        description={tasks.length === 0 ? "Empieza creando la primera tarea para este proyecto." : "No hay tareas que coincidan con los filtros aplicados."}
      >
        <Button variant="primary" onclick={openNewTaskModal}>+ Nueva tarea</Button>
      </EmptyState>
    {:else if viewMode === "lista"}
      <div class="space-y-3">
        {#each parentTasksForView as task (task.id)}
          {@const subtasks = taskSubtasks(task.id)}
          {@const visibleChildren = visibleSubtasks(task.id)}
          {@const completedChildren = subtasks.filter((item) => item.status === "done").length}
          {@const childProgress = subtasks.length ? Math.round((completedChildren / subtasks.length) * 100) : 0}
          <Card lift={false} class="relative overflow-visible border border-[var(--color-border)] p-0 hover:z-50 hover:border-[var(--color-border-strong)]">
            <div
              role="button"
              tabindex="0"
              class="group flex flex-wrap items-center gap-3 px-4 py-4 text-left transition hover:bg-purple-500/[0.05]"
              onclick={() => openEditTaskModal(task)}
              onkeydown={(event) => event.key === "Enter" && openEditTaskModal(task)}
            >
              <button
                type="button"
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm text-[var(--color-muted)] transition hover:bg-white/10 hover:text-white {visibleChildren.length === 0 ? 'invisible' : ''}"
                aria-label={isParentCollapsed(task.id) ? "Mostrar subtareas" : "Ocultar subtareas"}
                aria-expanded={!isParentCollapsed(task.id)}
                onclick={(event) => toggleParent(event, task.id)}
              >
                <span class="transition-transform {isParentCollapsed(task.id) ? '-rotate-90' : ''}">▾</span>
              </button>

              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-sm font-semibold text-[var(--color-text)] group-hover:text-[var(--color-purple-bright)]">{task.title}</h3>
                  <Badge tone={statusBadgeTone(task.status)}>{taskStatusLabel(task.status)}</Badge>
                  <Badge tone={priorityBadgeTone(task.priority)}>{priorityLabel(task.priority)}</Badge>
                  {#if orcaExecutionLabel(task)}
                    <Badge tone={orcaExecutionState(task) === "failed" ? "danger" : orcaExecutionState(task) === "completed" ? "ok" : "ai"}>{orcaExecutionLabel(task)}</Badge>
                  {/if}
                </div>
                {#if task.description}
                  <RichDescription value={task.description} class="mt-1 max-w-3xl line-clamp-2 text-xs text-[var(--color-muted-dim)]" />
                {/if}
                {#if subtasks.length > 0}
                  <div class="mt-2 flex max-w-md items-center gap-2">
                    <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div class="h-full rounded-full bg-gradient-to-r from-purple-500 to-indigo-400" style="width: {childProgress}%"></div>
                    </div>
                    <span class="shrink-0 text-[10px] font-semibold text-[var(--color-muted)]">{completedChildren}/{subtasks.length} completadas</span>
                  </div>
                {/if}
              </div>

              <div class="flex shrink-0 flex-wrap items-center gap-2">
                {#if task.assignee_name}<span class="text-xs text-[var(--color-muted)]">👤 {task.assignee_name}</span>{/if}
                {#if task.due_date}<span class="text-xs tabular text-[var(--color-muted-dim)]">📅 {formatDate(task.due_date)}</span>{/if}
                <button
                  type="button"
                  class="rounded-lg border border-cyan-400/25 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/10"
                  onclick={(event) => copyTaskForAi(event, task)}
                >Copiar para IA</button>
                <button
                  type="button"
                  class="rounded-lg border border-purple-400/25 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-purple-bright)] hover:bg-purple-500/10"
                  onclick={(event) => openNewSubtaskModal(event, task)}
                >+ Añadir subtarea</button>
              </div>
            </div>

            {#if visibleChildren.length > 0 && !isParentCollapsed(task.id)}
              <div class="border-t border-[var(--color-border-soft)] bg-black/15 px-4 py-2 sm:pl-14">
                <div class="divide-y divide-[var(--color-border-soft)] border-l border-purple-400/25 pl-3">
                  {#each visibleChildren as child (child.id)}
                    <button
                      type="button"
                      class="group/child relative flex w-full flex-wrap items-center gap-3 px-3 py-3 text-left transition hover:bg-purple-500/[0.06]"
                      onclick={() => openEditTaskModal(child)}
                    >
                      <span class="h-2 w-2 shrink-0 rounded-full {statusDotClass(child.status)}"></span>
                      <div class="min-w-0 flex-1">
                        <p class="text-sm font-medium text-[var(--color-text)] group-hover/child:text-[var(--color-purple-bright)] {child.status === 'done' ? 'line-through opacity-60' : ''}">{child.title}</p>
                        {#if child.description}<RichDescription value={child.description} class="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-muted-dim)]" />{/if}
                      </div>
                      <Badge tone={statusBadgeTone(child.status)}>{taskStatusLabel(child.status)}</Badge>
                      {#if child.assignee_name}<span class="text-[11px] text-[var(--color-muted)]">👤 {child.assignee_name}</span>{/if}
                      {#if child.due_date}<span class="text-[11px] tabular text-[var(--color-muted-dim)]">{formatDate(child.due_date)}</span>{/if}
                      <div class="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-3 z-[100] hidden w-[30rem] max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-obsidian-elevated)] shadow-[0_24px_70px_rgba(0,0,0,0.65)] group-hover/child:block">
                        <div class="border-b border-[var(--color-border)] bg-[var(--color-obsidian-panel)] px-5 py-4">
                          <div class="mb-1.5 flex items-center gap-2">
                            <span class="h-2 w-2 rounded-full {statusDotClass(child.status)}"></span>
                            <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-muted-dim)]">Subtarea · {taskStatusLabel(child.status)}</span>
                          </div>
                          <p class="text-base font-semibold leading-snug text-[var(--color-text)]">{child.title}</p>
                        </div>
                        <div class="bg-[var(--color-obsidian-elevated)] px-5 py-4">
                          <p class="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-muted-dim)]">Descripción</p>
                          {#if child.description}
                            <RichDescription value={child.description} class="text-sm leading-relaxed text-[var(--color-muted)]" />
                          {:else}
                            <p class="text-sm italic text-[var(--color-muted-dim)]">Sin descripción</p>
                          {/if}
                        </div>
                      </div>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </Card>
        {/each}
      </div>
    {:else}
      <!-- Kanban Board View -->
      <div>
        <p class="mb-3 text-xs text-[var(--color-muted-dim)]">
          Las cabeceras permanecen visibles al desplazarte. Arrastra una tarea para cambiar su estado o ábrela y usa el selector «Estado» con teclado o pantalla táctil.
        </p>
        <div class="flex snap-x items-stretch gap-4 overflow-x-auto pb-3 lg:grid lg:grid-cols-5 lg:overflow-visible">
        {#each visibleKanbanColumns as col, colIndex}
          {@const colTasks = columnTasks(col.status)}
          <div
            role="group"
            aria-label={`Columna ${col.label}`}
            class="relative flex h-full min-h-[300px] min-w-[18rem] snap-start flex-col rounded-2xl border p-3 transition-all hover:z-50 lg:min-w-0 {dragOverStatus === col.status
              ? 'border-[var(--color-purple-bright)] bg-purple-500/10 ring-2 ring-purple-400/20'
              : 'border-[var(--color-border)] bg-black/20'}"
            ondragover={(event) => handleColumnDragOver(event, col.status)}
            ondrop={(event) => handleTaskDrop(event, col.status)}
          >
            <!-- Column Header -->
            <div class="sticky top-0 z-40 -mx-1 mb-3 flex items-center justify-between rounded-xl border-b border-[var(--color-border-soft)] bg-[var(--color-obsidian-panel)] px-2 py-2 shadow-[0_12px_24px_-18px_rgba(0,0,0,0.95)]">
              <div class="flex items-center gap-2">
                <Badge tone={col.tone}>{col.label}</Badge>
              </div>
              <span class="text-xs font-bold text-[var(--color-muted-dim)]">{colTasks.length}</span>
            </div>

            <!-- Column Task Cards -->
            <div class="space-y-2 flex-1">
              {#each colTasks as task (task.id)}
                {@const subtasks = visibleSubtasks(task.id)}
                {@const allSubtasks = taskSubtasks(task.id)}
                {@const completedChildren = allSubtasks.filter((item) => item.status === "done").length}
                {@const childProgress = allSubtasks.length ? Math.round((completedChildren / allSubtasks.length) * 100) : 0}
                <Card
                  lift={true}
                  draggable={statusUpdatingTaskId !== task.id && !hasSubtasks(task.id)}
                  aria-label={hasSubtasks(task.id) ? `Tarea ${task.title} con estado automático` : `Arrastrar ${task.parent_id ? "subtarea" : "tarea"} ${task.title}`}
                  class="relative overflow-visible border p-0 transition-all hover:z-[60] select-none {hasSubtasks(task.id)
                      ? 'cursor-default border-[var(--color-border-strong)] bg-black/30'
                      : 'cursor-grab active:cursor-grabbing border-[var(--color-border-soft)] hover:border-[var(--color-border-strong)]'} {draggedTaskId === task.id
                    ? 'opacity-40 scale-[0.98]'
                    : ''} {statusUpdatingTaskId === task.id ? 'opacity-60 cursor-wait' : ''} {dragOverParentId === task.id
                      ? 'ring-2 ring-[var(--color-purple-bright)] border-[var(--color-purple-bright)] bg-purple-500/20'
                      : ''}"
                  onclick={() => {
                    if (!suppressTaskClick) openEditTaskModal(task);
                  }}
                  ondragstart={(event) => handleTaskDragStart(event, task)}
                  ondragend={handleTaskDragEnd}
                  ondragover={(event) => handleParentDragOver(event, task)}
                  ondragleave={(event) => handleParentDragLeave(event, task)}
                  ondrop={(event) => handleParentDrop(event, task)}
                >
                  <div class="space-y-2 p-3">
                    {#if dragOverParentId === task.id}
                      <p class="rounded-md bg-purple-500/25 px-2 py-1 text-center text-[10px] font-bold text-[var(--color-purple-bright)]">
                        Suelta con Mayús para convertirla en subtarea
                      </p>
                    {/if}
                    <div class="flex min-w-0 flex-wrap items-start gap-1.5" data-kanban-card-header>
                      <h4 class="w-full min-w-0 break-words text-xs font-semibold leading-snug text-[var(--color-text)]">
                        {task.title}
                      </h4>
                      <div class="ml-auto flex max-w-full shrink-0 items-center gap-1" data-kanban-card-actions>
                        {#if allSubtasks.length > 0}
                          <button
                            type="button"
                            title={isParentCollapsed(task.id) ? "Mostrar subtareas" : "Ocultar subtareas"}
                            aria-label={`${isParentCollapsed(task.id) ? "Mostrar" : "Ocultar"} subtareas de ${task.title}`}
                            aria-expanded={!isParentCollapsed(task.id)}
                            data-kanban-subtask-toggle
                            class="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-[var(--color-border)] px-1.5 text-xs text-[var(--color-muted)] transition hover:bg-white/10 hover:text-white"
                            onclick={(event) => toggleParent(event, task.id)}
                          >
                            <span class="transition-transform {isParentCollapsed(task.id) ? '-rotate-90' : ''}">▾</span>
                          </button>
                        {/if}
                        <button
                          type="button"
                          title="Copiar tarea y subtareas para la IA"
                          aria-label={`Copiar ${task.title} para la IA`}
                          class="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-cyan-400/25 px-1.5 text-[10px] font-bold text-cyan-200 hover:bg-cyan-500/15"
                          onclick={(event) => copyTaskForAi(event, task)}
                        >IA</button>
                        <button
                          type="button"
                          title="Añadir subtarea"
                          aria-label={`Añadir subtarea a ${task.title}`}
                          class="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-purple-400/25 px-1.5 text-xs font-bold text-[var(--color-purple-bright)] hover:bg-purple-500/15"
                          onclick={(event) => openNewSubtaskModal(event, task)}
                        >+</button>
                      </div>
                    </div>

                    {#if allSubtasks.length > 0}
                      <div class="space-y-1.5">
                        <div class="flex items-center justify-between text-[10px] font-semibold text-[var(--color-muted)]">
                          <span>{completedChildren}/{allSubtasks.length} subtareas</span>
                          <span>{childProgress}%</span>
                        </div>
                        <div class="h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div class="h-full rounded-full bg-gradient-to-r from-purple-500 to-indigo-400" style="width: {childProgress}%"></div>
                        </div>
                      </div>
                    {/if}

                    {#if task.description}
                      <RichDescription value={task.description} class="line-clamp-2 text-[11px] text-[var(--color-muted-dim)]" />
                    {/if}

                    <div class="flex flex-wrap items-center gap-1.5 pt-1">
                      <Badge tone={priorityBadgeTone(task.priority)}>{priorityLabel(task.priority)}</Badge>
                      {#if orcaExecutionLabel(task)}
                        <Badge tone={orcaExecutionState(task) === "failed" ? "danger" : orcaExecutionState(task) === "completed" ? "ok" : "ai"}>{orcaExecutionLabel(task)}</Badge>
                      {/if}
                      {#if task.category}
                        <span
                          class="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style="background-color: {task.category.color}22; color: {task.category.color}"
                        >
                          {task.category.name}
                        </span>
                      {/if}
                    </div>

                    {#if task.assignee_name || task.due_date}
                      <div class="flex items-center justify-between text-[10px] text-[var(--color-muted-dim)] pt-1 border-t border-white/5">
                        <span>{task.assignee_name ? `👤 ${task.assignee_name}` : ""}</span>
                        <span>{task.due_date ? `📅 ${formatDate(task.due_date)}` : ""}</span>
                      </div>
                    {/if}
                  </div>

                  {#if subtasks.length > 0 && !isParentCollapsed(task.id)}
                    <div class="border-t border-[var(--color-border-soft)] bg-black/20 p-2">
                      <div class="space-y-1 border-l border-purple-400/25 pl-2">
                        {#each subtasks as child (child.id)}
                          <div
                            role="button"
                            tabindex="0"
                            draggable={statusUpdatingTaskId !== child.id}
                            aria-label={`Arrastrar subtarea ${child.title}`}
                            class="group/subtask relative flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:z-[70] hover:bg-purple-500/10 active:cursor-grabbing {draggedTaskId === child.id ? 'scale-[0.98] opacity-40' : ''} {statusUpdatingTaskId === child.id ? 'cursor-wait opacity-60' : ''}"
                            onclick={(event) => {
                              event.stopPropagation();
                              openEditTaskModal(child);
                            }}
                            onkeydown={(event) => event.key === "Enter" && openEditTaskModal(child)}
                            ondragstart={(event) => {
                              event.stopPropagation();
                              handleTaskDragStart(event, child);
                            }}
                            ondragend={(event) => {
                              event.stopPropagation();
                              handleTaskDragEnd();
                            }}
                          >
                            <span class="text-[9px] text-[var(--color-muted-dim)]" aria-hidden="true">⠇⠇</span>
                            <span class="h-1.5 w-1.5 shrink-0 rounded-full {statusDotClass(child.status)}"></span>
                            <span class="min-w-0 flex-1 truncate text-[10px] text-[var(--color-muted)] {child.status === 'done' ? 'line-through opacity-60' : ''}">{child.title}</span>
                            {#if child.assignee_name}<span class="max-w-14 truncate text-[9px] text-[var(--color-muted-dim)]">{child.assignee_name}</span>{/if}
                            <div class="pointer-events-none absolute bottom-[calc(100%+0.5rem)] z-[100] hidden w-[30rem] max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-obsidian-elevated)] shadow-[0_24px_70px_rgba(0,0,0,0.65)] group-hover/subtask:block {colIndex >= 3 ? 'right-0' : 'left-0'}">
                              <div class="border-b border-[var(--color-border)] bg-[var(--color-obsidian-panel)] px-5 py-4">
                                <div class="mb-1.5 flex items-center gap-2">
                                  <span class="h-2 w-2 rounded-full {statusDotClass(child.status)}"></span>
                                  <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-muted-dim)]">Subtarea · {taskStatusLabel(child.status)}</span>
                                </div>
                                <p class="text-base font-semibold leading-snug text-[var(--color-text)]">{child.title}</p>
                              </div>
                              <div class="bg-[var(--color-obsidian-elevated)] px-5 py-4">
                                <p class="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-muted-dim)]">Descripción</p>
                                {#if child.description}
                                  <RichDescription value={child.description} class="text-sm leading-relaxed text-[var(--color-muted)]" />
                                {:else}
                                  <p class="text-sm italic text-[var(--color-muted-dim)]">Sin descripción</p>
                                {/if}
                              </div>
                              <p class="border-t border-[var(--color-border-soft)] bg-black/15 px-5 py-2.5 text-[10px] font-medium text-[var(--color-purple-bright)]">Arrastra para cambiar de estado</p>
                            </div>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </Card>
              {/each}
              {#if colTasks.length === 0}
                <div class="py-8 text-center text-xs italic text-[var(--color-muted-dim)]">
                  {dragOverStatus === col.status ? "Suelta aquí" : "Sin tareas"}
                </div>
              {/if}
            </div>
          </div>
        {/each}
        </div>
      </div>
    {/if}
  {/if}
</section>

<!-- Edit Project Modal (Admin) -->
<Modal
  open={editProjectModalOpen}
  title="Editar Proyecto"
  onclose={() => (editProjectModalOpen = false)}
>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleSaveProject();
    }}
    class="space-y-4 pt-1"
  >
    <div class="space-y-1">
      <label for="edit-project-name" class="text-xs font-medium text-[var(--color-muted)]">Nombre del proyecto</label>
      <input
        id="edit-project-name"
        type="text"
        bind:value={editProjectForm.name}
        class="field w-full text-sm"
        required
      />
    </div>

    <RichDescriptionEditor id="edit-project-desc" bind:value={editProjectForm.description} />

    <Select
      label="Estado"
      options={projectStatusOptions}
      bind:value={editProjectForm.status}
    />

    <Select
      label="Cliente"
      options={customerOptions}
      bind:value={editProjectForm.customer_id}
      placeholder="Proyecto propio (sin cliente)"
    />

    {#if editProjectForm.customer_id}
      <div class="space-y-1">
        <label for="edit-project-value" class="text-xs font-medium text-[var(--color-muted)]">Valor contratado (€)</label>
        <input id="edit-project-value" type="text" inputmode="decimal" bind:value={editProjectForm.value} placeholder="0,00" class="field w-full text-sm" />
      </div>
    {:else}
      <div class="space-y-3 rounded-xl border border-[var(--color-border)] p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-xs font-medium text-[var(--color-text)]">Hitos mensuales</p>
            <p class="text-[11px] text-[var(--color-muted-dim)]">Importe estimado y mes/año objetivo.</p>
          </div>
          <Button type="button" variant="secondary" onclick={addEditMilestone}>+ Añadir hito</Button>
        </div>
        {#each editProjectForm.milestones as milestone, index}
          <div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input class="field w-full text-sm" inputmode="decimal" bind:value={milestone.amount} placeholder="Importe (€)" />
            <Select
              options={milestoneMonthOptions}
              bind:value={milestone.target_month}
              placeholder="Mes y año"
            />
            <Button type="button" variant="ghost" onclick={() => removeEditMilestone(index)}>Eliminar</Button>
          </div>
        {/each}
        {#if editProjectForm.milestones.length === 0}
          <p class="text-xs text-[var(--color-muted-dim)]">Todavía no hay hitos económicos.</p>
        {/if}
      </div>
    {/if}

    <div class="grid gap-3 sm:grid-cols-2">
      <div class="space-y-1">
        <label for="edit-project-start" class="text-xs font-medium text-[var(--color-muted)]">Fecha de inicio</label>
        <input
          id="edit-project-start"
          type="date"
          bind:value={editProjectForm.start_date}
          class="field w-full text-sm"
        />
      </div>
      <div class="space-y-1">
        <label for="edit-project-target" class="text-xs font-medium text-[var(--color-muted)]">Fecha objetivo</label>
        <input
          id="edit-project-target"
          type="date"
          bind:value={editProjectForm.target_date}
          class="field w-full text-sm"
        />
      </div>
    </div>

    <div class="flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-4">
      <Button variant="ghost" type="button" onclick={() => (editProjectModalOpen = false)}>
        Cancelar
      </Button>
      <Button variant="primary" type="submit" disabled={editProjectSaving}>
        Guardar cambios
      </Button>
    </div>
  </form>
</Modal>

<Modal
  open={cashModalOpen}
  title={cashForm.kind === "income" ? "Registrar cobro" : "Registrar gasto"}
  onclose={() => (cashModalOpen = false)}
>
  <form
    class="space-y-4"
    onsubmit={(event) => {
      event.preventDefault();
      saveProjectMovement();
    }}
  >
    <div class="space-y-1">
      <label for="project-cash-amount" class="text-xs font-medium text-[var(--color-muted)]">Importe (€)</label>
      <input id="project-cash-amount" class="field w-full" inputmode="decimal" bind:value={cashForm.amount} placeholder="0,00" required />
    </div>
    <div class="space-y-1">
      <label for="project-cash-description" class="text-xs font-medium text-[var(--color-muted)]">Concepto</label>
      <input id="project-cash-description" class="field w-full" bind:value={cashForm.description} placeholder="Factura, proveedor, materiales…" required />
    </div>
    <p class="text-xs text-[var(--color-muted-dim)]">Este movimiento también quedará reflejado en Caja.</p>
    <div class="flex justify-end gap-2">
      <Button variant="ghost" type="button" onclick={() => (cashModalOpen = false)}>Cancelar</Button>
      <Button variant="primary" type="submit" disabled={cashSaving}>
        {cashSaving ? "Registrando…" : "Registrar"}
      </Button>
    </div>
  </form>
</Modal>

<Modal
  open={importModalOpen}
  title="Importar tareas desde texto"
  onclose={() => !importSaving && (importModalOpen = false)}
>
  <form
    class="space-y-4 pt-1"
    onsubmit={(event) => {
      event.preventDefault();
      handleImportTasks();
    }}
  >
    <div class="rounded-xl border border-purple-400/25 bg-purple-500/[0.07] px-4 py-3 text-sm text-[var(--color-muted)]">
      Pega una lista de ChatGPT. Las líneas principales serán tareas; las listas indentadas, subtareas; y el texto indentado, su descripción.
    </div>

    <div class="space-y-1.5">
      <label for="task-import-due-date" class="text-xs font-medium text-[var(--color-muted)]">Fecha de entrega predeterminada</label>
      <input id="task-import-due-date" type="date" class="field w-full" bind:value={importDueDate} />
      <p class="text-[11px] text-[var(--color-muted-dim)]">
        Se aplicará a las tareas pegadas y a sus subtareas. Puedes sobrescribirla en el texto con una línea indentada «Fecha: AAAA-MM-DD».
      </p>
    </div>

    <div class="space-y-1.5">
      <label for="task-import-text" class="text-xs font-medium text-[var(--color-muted)]">Lista de tareas</label>
      <textarea
        id="task-import-text"
        bind:value={importText}
        class="field min-h-52 w-full resize-y font-mono text-sm leading-6"
        placeholder={'1. Preparar catálogo\n   Fecha: 2026-08-20\n   Descripción: Revisar antes de publicar.\n   - Revisar productos\n     Descripción: Comprobar SKU y precio.\n   - Añadir fotografías'}
      ></textarea>
      <p class="text-[11px] text-[var(--color-muted-dim)]">
        Admite listas con -, *, +, números y casillas Markdown. Usa «Descripción:», «Fecha: AAAA-MM-DD» o texto indentado debajo del elemento.
      </p>
    </div>

    {#if importedTasks.length > 0}
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">Vista previa</p>
          <span class="text-xs text-purple-200">{importedTaskCount} elementos</span>
        </div>
        <div class="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-black/20 p-3">
          {#each importedTasks as imported, index (`${index}-${imported.title}`)}
            <div class="rounded-lg bg-white/[0.025] px-3 py-2">
              <p class="text-sm font-semibold text-[var(--color-text)]">{index + 1}. {imported.title}</p>
              {#if imported.due_date || importDueDate}
                <p class="mt-1 text-[11px] text-purple-200">📅 {formatDate(imported.due_date || importDueDate)}</p>
              {/if}
              {#if imported.description}
                <p class="mt-1 whitespace-pre-line text-xs text-[var(--color-muted)]">{imported.description}</p>
              {/if}
              {#if imported.subtasks.length > 0}
                <ul class="mt-1.5 space-y-1 pl-5 text-xs text-[var(--color-muted)]">
                  {#each imported.subtasks as subtask}
                    <li>
                      <span>↳ {subtask.title}</span>
                      {#if subtask.due_date || imported.due_date || importDueDate}
                        <span class="ml-2 text-[10px] text-purple-200">📅 {formatDate(subtask.due_date || imported.due_date || importDueDate)}</span>
                      {/if}
                      {#if subtask.description}
                        <p class="ml-4 mt-0.5 whitespace-pre-line text-[11px] text-[var(--color-muted-dim)]">{subtask.description}</p>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {:else if importText.trim()}
      <p class="rounded-xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-200">
        No se ha detectado ninguna lista. Usa guiones o números delante de cada tarea.
      </p>
    {/if}

    <div class="flex justify-end gap-2">
      <Button variant="ghost" type="button" disabled={importSaving} onclick={() => (importModalOpen = false)}>Cancelar</Button>
      <Button variant="primary" type="submit" disabled={importSaving || importedTasks.length === 0}>
        {importSaving ? `Creando ${importedTaskCount} elementos…` : `Crear ${importedTaskCount} tareas y subtareas`}
      </Button>
    </div>
  </form>
</Modal>

<Modal
  open={deleteTasksModalOpen}
  title="Eliminar tareas"
  onclose={() => !deletingProjectTasks && (deleteTasksModalOpen = false)}
>
  <form
    class="space-y-4 pt-1"
    onsubmit={(event) => {
      event.preventDefault();
      handleDeleteSelectedProjectTasks();
    }}
  >
    <div class="rounded-xl border border-rose-400/25 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-100">
      Selecciona lo que quieras borrar. Esta acción es definitiva; el proyecto se conservará.
    </div>

    <label class="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--color-border)] bg-black/20 px-4 py-3">
      <input
        type="checkbox"
        checked={selectedTaskIds.size === tasks.length}
        onchange={toggleAllTasksForDeletion}
        class="h-4 w-4 accent-rose-500"
      />
      <span class="text-sm font-semibold text-[var(--color-text)]">Seleccionar todas ({tasks.length})</span>
    </label>

    <div class="max-h-96 space-y-2 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-black/20 p-3">
      {#each tasks.filter((task) => task.parent_id == null) as parent (parent.id)}
        <label class="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04]">
          <input
            type="checkbox"
            checked={selectedTaskIds.has(parent.id)}
            onchange={() => toggleTaskForDeletion(parent.id)}
            class="mt-0.5 h-4 w-4 accent-rose-500"
          />
          <span class="min-w-0 text-sm font-semibold text-[var(--color-text)]">{parent.title}</span>
        </label>
        {#each tasks.filter((task) => task.parent_id === parent.id) as child (child.id)}
          <label class="ml-7 flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04]">
            <input
              type="checkbox"
              checked={selectedTaskIds.has(child.id) || selectedTaskIds.has(parent.id)}
              disabled={selectedTaskIds.has(parent.id)}
              onchange={() => toggleTaskForDeletion(child.id)}
              class="mt-0.5 h-4 w-4 accent-rose-500"
            />
            <span class="min-w-0 text-sm text-[var(--color-muted)]">↳ {child.title}</span>
          </label>
        {/each}
      {/each}
    </div>

    <p class="text-xs text-[var(--color-muted-dim)]">
      Al eliminar una tarea principal también se eliminarán sus subtareas.
    </p>

    <div class="flex justify-end gap-2">
      <Button variant="ghost" type="button" disabled={deletingProjectTasks} onclick={() => (deleteTasksModalOpen = false)}>Cancelar</Button>
      <Button variant="danger" type="submit" disabled={deletingProjectTasks || selectedTaskIds.size === 0}>
        {deletingProjectTasks ? "Eliminando…" : `Eliminar selección (${selectedTaskIds.size})`}
      </Button>
    </div>
  </form>
</Modal>

<!-- Task Detail Modal -->
<Modal
  open={detailModalOpen}
  title={editingTask ? (editingTask.parent_id ? "Detalle de Subtarea" : "Detalle de Tarea") : newTaskParent ? "Nueva Subtarea" : "Nueva Tarea"}
  onclose={() => (detailModalOpen = false)}
>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleSaveTask();
    }}
    class="space-y-4 pt-1"
  >
    {#if editingTask && orcaExecutionLabel(editingTask)}
      <div class="rounded-xl border border-purple-400/25 bg-purple-500/10 px-4 py-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs font-bold uppercase tracking-wide text-[var(--color-purple-bright)]">{orcaExecutionLabel(editingTask)}</p>
          {#if editingTask.source_href}
            <span class="max-w-full truncate text-[10px] text-[var(--color-muted-dim)]" title={editingTask.source_href}>{editingTask.source_href}</span>
          {/if}
        </div>
        {#if orcaExecutionState(editingTask) === "failed" && editingTask.source_key}
          <p class="mt-2 text-xs leading-relaxed text-rose-200">{editingTask.source_key}</p>
        {/if}
      </div>
    {/if}

    {#if newTaskParent}
      <div class="rounded-xl border border-purple-400/30 bg-purple-500/10 px-4 py-3">
        <p class="text-xs font-bold uppercase tracking-wide text-[var(--color-purple-bright)]">↳ Nueva subtarea</p>
        <p class="mt-1 text-sm text-[var(--color-text)]">
          Dependerá de «{newTaskParent.title}» y actualizará automáticamente su estado.
        </p>
      </div>
    {/if}

    <div class="space-y-1">
      <label for="task-title" class="text-xs font-medium text-[var(--color-muted)]">Título</label>
      <input
        id="task-title"
        type="text"
        bind:value={detailForm.title}
        placeholder="Título de la tarea"
        class="field w-full text-sm"
        required
      />
    </div>

    <RichDescriptionEditor id="task-desc" bind:value={detailForm.description} />

    {#if editingTask}
      <div class="space-y-1">
        <Select
          label="Tarea padre"
          options={taskParentOptions}
          bind:value={detailForm.parent_id}
          disabled={hasSubtasks(editingTask.id)}
        />
        <p class="text-[11px] text-[var(--color-muted-dim)]">
          {hasSubtasks(editingTask.id)
            ? "Esta tarea ya tiene subtareas y no puede convertirse en subtarea."
            : "Selecciona una tarea padre o déjalo vacío para que sea una tarea principal."}
        </p>
      </div>
    {/if}

    <div class="grid gap-3 sm:grid-cols-2">
      <Select
        label="Tipo"
        options={detailTypeOptions}
        bind:value={detailForm.type}
      />
      <Select
        label="Estado"
        options={detailStatusOptions}
        bind:value={detailForm.status}
      />
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <Select
        label="Prioridad"
        options={detailPriorityOptions}
        bind:value={detailForm.priority}
      />
      <Select
        label="Categoría"
        options={categoryOptions}
        bind:value={detailForm.category_id}
      />
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      {#if newTaskParent}
        <div class="space-y-1">
          <span class="text-xs font-medium text-[var(--color-muted)]">Proyecto</span>
          <div class="field flex min-h-11 items-center text-sm text-[var(--color-muted)]">
            {project?.name}
          </div>
        </div>
      {:else}
        <Select
          label="Proyecto"
          options={detailProjectOptions}
          bind:value={detailForm.project_id}
        />
      {/if}
      <Select
        label="Responsable"
        options={detailAssigneeOptions}
        bind:value={detailForm.assignee_id}
      />
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <div class="space-y-1">
        <label for="task-start-date" class="text-xs font-medium text-[var(--color-muted)]">Fecha de inicio</label>
        <input
          id="task-start-date"
          type="date"
          bind:value={detailForm.start_date}
          class="field w-full text-sm"
        />
      </div>
      <div class="space-y-1">
        <label for="task-due-date" class="text-xs font-medium text-[var(--color-muted)]">Fecha límite</label>
        <input
          id="task-due-date"
          type="date"
          bind:value={detailForm.due_date}
          class="field w-full text-sm"
        />
      </div>
    </div>

    <div class="flex items-center justify-between border-t border-[var(--color-border)] pt-4">
      {#if editingTask}
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="danger" type="button" onclick={handleArchiveTask}>Archivar</Button>
          {#if $isAdmin && canDispatchToOrca(editingTask)}
            <Button
              variant="ai"
              type="button"
              onclick={() => dispatchTaskToOrca(editingTask!)}
              disabled={orcaDispatchingTaskId === editingTask.id}
              title={supportsOrcaWorker() ? "Crear una ejecución local en Orca" : "Requiere la versión web de Hexa"}
            >
              {orcaDispatchingTaskId === editingTask.id ? "Enviando…" : "Enviar a Orca"}
            </Button>
          {:else if orcaExecutionLabel(editingTask)}
            <Badge tone={orcaExecutionState(editingTask) === "failed" ? "danger" : orcaExecutionState(editingTask) === "completed" ? "ok" : "ai"}>{orcaExecutionLabel(editingTask)}</Badge>
          {:else if $isAdmin && editingTask.parent_id != null}
            <Button variant="ai" type="button" disabled={true} title="Envía a Orca la tarea principal para incluir todas sus subtareas">
              Orca · tarea principal
            </Button>
          {/if}
        </div>
      {:else}
        <div></div>
      {/if}

      <div class="flex items-center gap-2">
        <Button variant="ghost" type="button" onclick={() => (detailModalOpen = false)}>
          Cancelar
        </Button>
        <Button variant="primary" type="submit" disabled={taskSaving}>
          Guardar cambios
        </Button>
      </div>
    </div>
  </form>
</Modal>
