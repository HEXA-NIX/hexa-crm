<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api/client";
  import { session, isAdmin, currentUser, setActiveCompanyLocal } from "$lib/stores/session";
  import { showToast } from "$lib/stores/ui";
  import { confirmDialog } from "$lib/stores/confirm-dialog";
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
    Invoice,
    WorkProjectDocumentInput,
    WorkProjectRequest,
    WorkProjectRequestStatus,
    WorkProjectRequestType,
    WorkProjectKind,
    CompanyFinancialSummary,
  } from "$lib/types";
  import { formatEUR, parseEurosInput } from "$lib/money";
  import Button from "$lib/components/Button.svelte";
  import Card from "$lib/components/Card.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import Select from "$lib/components/Select.svelte";
  import Input from "$lib/components/Input.svelte";
  import DatePicker from "$lib/components/DatePicker.svelte";
  import MoneyInput from "$lib/components/MoneyInput.svelte";
  import DateRangePicker from "$lib/components/DateRangePicker.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import RichDescription from "$lib/components/RichDescription.svelte";
  import RichDescriptionEditor from "$lib/components/RichDescriptionEditor.svelte";
  import { countImportedTasks, parseTaskImport } from "$lib/work/task-import";
  import { formatTaskForAi } from "$lib/work/task-ai-copy";
  import { awaitsClientValidation } from "$lib/work/client-validation";
  import { calculateTaskProgress } from "$lib/projects/task-progress";
  import { projectStatusLabel, projectStatusTone } from "$lib/projects/presentation";
  import { buildProjectEconomicSeries } from "$lib/projects/project-economics";
  import { normalizeProjectDocuments, projectDocumentHref, validateProjectDocuments } from "$lib/projects/project-documents";
  import { normalizeProjectBrief, normalizeProjectPrd, parseTechStack, projectTechnologyCount } from "$lib/projects/project-brief";
  import { hasInvalidDateRange, hasInvalidMoneyInput } from "$lib/projects/form-validation";
  import { availableMilestoneMonths, hasDuplicateMilestoneMonths, nextMilestoneMonth } from "$lib/projects/milestone-months";
  import { projectLogoDataUrl } from "$lib/projects/project-logo";
  import ProjectProgress from "$lib/components/projects/ProjectProgress.svelte";
  import ProjectManagementCenter from "$lib/components/projects/ProjectManagementCenter.svelte";
  import SprintCenter from "$lib/components/projects/SprintCenter.svelte";
  import ProjectGrants from "$lib/components/projects/ProjectGrants.svelte";
  import { normalizeProjectManagement } from "$lib/projects/management";
  import { currentSprint, sprintTasks } from "$lib/projects/sprints";
  import TechnologyPicker from "$lib/components/projects/TechnologyPicker.svelte";
  import TechnologyBadge from "$lib/components/projects/TechnologyBadge.svelte";
  import AssigneeAvatar from "$lib/components/users/AssigneeAvatar.svelte";
  import { isTaskDueSoon, isTaskOverdue, isTaskPendingWork, sortTasksByDueDate, taskAssigneeId, taskDueDate } from "$lib/work/task-dates";
  import { browser } from "$app/environment";

  const projectReference = $derived($page.params.id);
  type ProjectSection = "resumen" | "plan" | "trabajo" | "equipo" | "solicitudes" | "documentos" | "economia" | "actividad";
  const projectSections: { id: ProjectSection; label: string }[] = [
    { id: "resumen", label: "Resumen" },
    { id: "plan", label: "Plan" },
    { id: "trabajo", label: "Trabajo" },
    { id: "equipo", label: "Equipo" },
    { id: "solicitudes", label: "Solicitudes" },
    { id: "documentos", label: "Documentos" },
    { id: "economia", label: "Economía" },
    { id: "actividad", label: "Actividad" },
  ];
  const activeProjectSection = $derived.by<ProjectSection>(() => {
    const requested = $page.url.searchParams.get("seccion");
    return projectSections.some((section) => section.id === requested) ? requested as ProjectSection : "resumen";
  });

  function openProjectSection(section: ProjectSection) {
    const url = new URL($page.url);
    if (section === "resumen") url.searchParams.delete("seccion");
    else url.searchParams.set("seccion", section);
    void goto(`${url.pathname}${url.search}${url.hash}`, { noScroll: true, keepFocus: true });
  }

  let project = $state<WorkProject | null>(null);
  const projectId = $derived(project?.id ?? 0);
  let tasks = $state<WorkItem[]>([]);
  let categories = $state<WorkCategory[]>([]);
  let members = $state<WorkMember[]>([]);
  let projectsList = $state<WorkProject[]>([]);
  let customers = $state<Customer[]>([]);
  let cashMovements = $state<CashMovement[]>([]);
  let invoices = $state<Invoice[]>([]);
  let companyFinancialSummaries = $state<CompanyFinancialSummary[]>([]);
  let loading = $state(true);
  let loadedDataProjectUid = $state("");
  let tasksLoaded = $state(false);
  let categoriesLoaded = $state(false);
  let membersLoaded = $state(false);
  let projectsLoaded = $state(false);
  let customersLoaded = $state(false);
  let cashMovementsLoaded = $state(false);
  let invoicesLoaded = $state(false);
  let companyFinancialSummariesLoaded = $state(false);
  let sectionDataLoading = $state(false);
  let projectDescriptionExpanded = $state(false);

  let viewMode = $state<"lista" | "kanban">(
    browser && localStorage.getItem("hexa-project-view") === "kanban" ? "kanban" : "lista",
  );
  let workScope = $state<"sprint" | "backlog">("sprint");
  let draggedTaskId = $state<number | null>(null);
  type KanbanStatus = WorkStatus | "client_validation";
  let dragOverStatus = $state<KanbanStatus | null>(null);
  let dragOverParentId = $state<number | null>(null);
  let suppressTaskClick = $state(false);
  let statusUpdatingTaskId = $state<number | null>(null);
  let kanbanScrollLeft = $state(0);
  let kanbanAutoScrollTimer: ReturnType<typeof setInterval> | null = null;
  let kanbanAutoScrollSpeed = 0;
  let kanbanAutoScrollElement: HTMLElement | null = null;
  let kanbanBoardElement = $state<HTMLElement | null>(null);
  let kanbanDragCancelled = false;
  let kanbanLastPointerX = 0;
  let collapsedParentIds = $state<Set<number>>(new Set());
  let collapsedInitializedProject = $state("");

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
    project_type: "own" as WorkProjectKind,
    client_company_id: "",
    customer_id: "",
    value: "",
    milestones: [] as { id?: number; amount: string; target_month: string }[],
    start_date: "",
    target_date: "",
    logo_data_url: "",
  });
  let cashModalOpen = $state(false);
  let cashSaving = $state(false);
  let cashForm = $state({
    kind: "income" as CashKind,
    amount: "",
    description: "",
  });
  let documentsModalOpen = $state(false);
  let documentsSaving = $state(false);
  let documentUploading = $state(false);
  let uploadFile = $state<File | null>(null);
  let uploadFileInput = $state<HTMLInputElement | null>(null);
  let uploadError = $state("");
  let documentDragActive = $state(false);
  let projectLogoDragActive = $state(false);
  let documentsForm = $state<WorkProjectDocumentInput[]>([]);
  let requestsModalOpen = $state(false);
  let requestSaving = $state(false);
  let editingRequestId = $state<string | null>(null);
  let requestComment = $state("");
  let requestForm = $state({
    type: "suggestion" as WorkProjectRequestType,
    title: "",
    description: "",
    requester: "",
    priority: "normal" as WorkPriority,
    impact: "",
    status: "new" as WorkProjectRequestStatus,
    reviewer_id: "",
  });
  let briefModalOpen = $state(false);
  let briefSaving = $state(false);
  let briefForm = $state({
    summary: "", problem: "", objectives: "", users: "", scope: "", out_of_scope: "",
    functional_requirements: "", non_functional_requirements: "", acceptance_criteria: "",
    risks: "", dependencies: "", success_metrics: "", notes: "",
    frontend: "", backend: "", app: "", database: "", infrastructure: "", deployment: "",
    integrations: "", plugins: "", ai: "", tools: "", repository_url: "", documentation_url: "",
    staging_url: "", production_url: "",
  });
  const briefTechFields = [
    { label: "Frontend", key: "frontend" }, { label: "Backend", key: "backend" }, { label: "App móvil / escritorio", key: "app" },
    { label: "Base de datos", key: "database" }, { label: "Infraestructura", key: "infrastructure" },
    { label: "Despliegue", key: "deployment" }, { label: "Integraciones", key: "integrations" }, { label: "Plugins y streaming", key: "plugins" },
    { label: "IA", key: "ai" }, { label: "Herramientas", key: "tools" },
  ] as const;

  // Task Detail Modal State
  let detailModalOpen = $state(false);
  let editingTask = $state<WorkItem | null>(null);
  let newTaskParent = $state<WorkItem | null>(null);
  let taskSaving = $state(false);
  let reviewDraft = $state("");
  let reviewSaving = $state(false);
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
    { value: "pending", label: "Pendientes" },
    { value: "inbox", label: "Backlog" },
    { value: "planned", label: "Planificado" },
    { value: "in_progress", label: "En progreso" },
    { value: "validation", label: "Validación" },
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
    { value: "inbox", label: "Backlog" },
    { value: "planned", label: "Planificado" },
    { value: "in_progress", label: "En progreso" },
    { value: "validation", label: "Validación" },
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
    { value: "", label: "Sin contacto específico" },
    ...customers.map((customer) => ({
      value: String(customer.id),
      label: customer.name,
      hint: customer.nif || customer.email || undefined,
    })),
  ]);

  const projectTypeOptions = [
    { value: "own", label: "Dev · producto propio" },
    { value: "client", label: "Dev · cliente / servicio facturable" },
    { value: "internal", label: "Dev · empresa del grupo" },
  ];
  const clientCompanyOptions = $derived([
    { value: "", label: "Seleccionar empresa" },
    ...$session.companies.map((company) => ({ value: String(company.id), label: company.trade_name, hint: company.code })),
  ]);
  const projectType = (value?: WorkProjectKind, customerId?: number | null) =>
    value ?? (customerId != null ? "client" : "own");
  const projectTypeLabel = (value?: WorkProjectKind, customerId?: number | null) => {
    const kind = projectType(value, customerId);
    return kind === "client" ? "Dev · Cliente" : kind === "internal" ? "Dev · Interno" : "Dev · Propio";
  };
  const projectCompanyName = (companyId?: number | null) =>
    companyId ? $session.companies.find((company) => company.id === companyId)?.trade_name ?? "Empresa" : "";
  const projectLogo = (value: WorkProject) => {
    if (value.logo_data_url) return value.logo_data_url;
    const kind = projectType(value.project_type, value.customer_id);
    // A client project has no visual fallback: the customer only sees an
    // image when one was explicitly uploaded for that project.
    if (kind === "client") return "";
    const logoCompanyId = kind === "own"
      ? value.company_id
      : value.task_company_id ?? value.company_id;
    return $session.companies.find((company) => company.id === logoCompanyId)?.logo_data_url ?? "";
  };
  const hexaCompanyId = () =>
    $session.companies.find((company) => company.code.toUpperCase() === "DEV")?.id
    ?? $session.companies.find((company) => /hexa/i.test(company.trade_name) && company.kind === "software_studio")?.id
    ?? $session.activeCompanyId;

  const projectCustomer = $derived.by(() => {
    const customerId = project?.customer_id;
    return customerId
      ? customers.find((customer) => customer.id === customerId) ?? null
      : null;
  });

  const kanbanColumns = $derived.by((): { status: KanbanStatus; label: string; tone: "neutral" | "ok" | "warn" | "danger" | "info" | "ai" }[] => [
    { status: "inbox", label: "Backlog", tone: "neutral" },
    { status: "planned", label: "Planificado", tone: "warn" },
    { status: "in_progress", label: "En progreso", tone: "ai" },
    { status: "blocked", label: "Bloqueado", tone: "danger" },
    { status: "validation", label: "Validación", tone: "info" },
    ...(projectType(project?.project_type, project?.customer_id) === "client"
      ? [{ status: "client_validation" as const, label: "Validar cliente", tone: "warn" as const }]
      : []),
    { status: "done", label: "Hecho", tone: "ok" },
  ]);
  const visibleKanbanColumns = $derived(
    filterStatus === "archived"
      ? [{ status: "archived" as KanbanStatus, label: "Archivado", tone: "neutral" as const }]
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

  async function loadData(refreshSection = true) {
    if (!projectReference) return;
    loading = true;
    try {
      const p = await api.getWorkProject(projectReference);
      // Los proyectos internos se gestionan en el espacio de trabajo de su
      // empresa propietaria. Cambiamos el contexto antes de cargar sus tareas.
      if (p.project_type === "internal" && p.task_company_id && p.task_company_id !== $session.activeCompanyId) {
        const workspace = await api.setActiveCompany(p.task_company_id);
        setActiveCompanyLocal(workspace);
        return;
      }
      if (loadedDataProjectUid !== p.uid) {
        tasks = [];
        categories = [];
        members = [];
        projectsList = [];
        customers = [];
        cashMovements = [];
        invoices = [];
        companyFinancialSummaries = [];
        tasksLoaded = categoriesLoaded = membersLoaded = projectsLoaded = customersLoaded = cashMovementsLoaded = invoicesLoaded = companyFinancialSummariesLoaded = false;
        loadedDataProjectUid = p.uid;
        projectDescriptionExpanded = false;
      } else if (refreshSection) {
        tasksLoaded = categoriesLoaded = membersLoaded = projectsLoaded = customersLoaded = cashMovementsLoaded = invoicesLoaded = companyFinancialSummariesLoaded = false;
      }
      project = p;
      if (projectReference !== p.uid) {
        await goto(`/proyectos/${p.uid}${$page.url.search}`, { replaceState: true, noScroll: true });
      }
      if ($page.url.searchParams.get("estado") === "pendientes") filterStatus = "pending";
      loading = false;
      void loadSectionData(activeProjectSection, p);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al cargar el proyecto", "err");
    } finally {
      loading = false;
    }
  }

  async function loadSectionData(section: ProjectSection, currentProject = project) {
    if (!currentProject || sectionDataLoading) return;
    // El progreso forma parte de la cabecera en todas las secciones.
    const needsTasks = true;
    const needsMembers = ["resumen", "plan", "trabajo", "equipo", "actividad", "solicitudes"].includes(section);
    const needsProjects = ["resumen", "plan", "trabajo", "equipo", "actividad"].includes(section);
    const needsCategories = section === "trabajo";
    const needsCustomers = section === "resumen";
    const needsCash = section === "economia";
    const requests: Promise<void>[] = [];
    if (needsTasks && !tasksLoaded) requests.push(api.listWorkItems({ project_id: currentProject.id }).then((value) => {
      tasks = value;
      tasksLoaded = true;
      if (collapsedInitializedProject !== currentProject.uid) {
        collapsedParentIds = new Set(value.filter((task) => task.parent_id != null).map((task) => task.parent_id as number));
        collapsedInitializedProject = currentProject.uid;
      }
    }));
    if (needsCategories && !categoriesLoaded) requests.push(api.listWorkCategories().then((value) => { categories = value; categoriesLoaded = true; }));
    if (needsMembers && !membersLoaded) requests.push(api.listWorkMembers().then((value) => { members = value; membersLoaded = true; }));
    if (needsProjects && !projectsLoaded) requests.push(api.listWorkProjects().then((value) => { projectsList = value; projectsLoaded = true; }));
    if (needsCustomers && !customersLoaded) requests.push(api.listCustomers(hexaCompanyId()).then((value) => { customers = value; customersLoaded = true; }));
    if (needsCash && !cashMovementsLoaded) requests.push(api.listCashMovements().then((value) => { cashMovements = value; cashMovementsLoaded = true; }));
    if (needsCash && !invoicesLoaded) requests.push(api.listInvoices().then((value) => { invoices = value; invoicesLoaded = true; }));
    if (needsCash && !companyFinancialSummariesLoaded) requests.push(api.groupFinancialSummary().then((value) => { companyFinancialSummaries = value; companyFinancialSummariesLoaded = true; }));
    if (!requests.length) return;
    sectionDataLoading = true;
    try {
      await Promise.all(requests);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudieron cargar los datos de esta sección", "err");
    } finally {
      sectionDataLoading = false;
    }
  }

  const activeSectionDataReady = $derived.by(() => {
    switch (activeProjectSection) {
      case "trabajo": return tasksLoaded && categoriesLoaded && membersLoaded && projectsLoaded;
      case "resumen": return tasksLoaded && membersLoaded && projectsLoaded && customersLoaded;
      case "plan":
      case "equipo":
      case "actividad": return tasksLoaded && membersLoaded && projectsLoaded;
      case "solicitudes": return tasksLoaded && membersLoaded;
      case "economia": return cashMovementsLoaded && invoicesLoaded && companyFinancialSummariesLoaded;
      case "documentos": return true;
    }
  });

  $effect(() => {
    const _cid = $session.activeCompanyId;
    const _reference = projectReference;
    loadData(false);
  });

  $effect(() => {
    const section = activeProjectSection;
    const currentProject = project;
    if (currentProject) void loadSectionData(section, currentProject);
  });

  $effect(() => {
    if (browser) localStorage.setItem("hexa-project-view", viewMode);
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
    const openTasks = tasks.filter(isTaskPendingWork);
    const overdue = openTasks.filter((task) => isTaskOverdue(task, today)).length;
    const dueSoon = openTasks.filter((task) => isTaskDueSoon(task, today)).length;
    const urgent = openTasks.filter((task) => task.priority === "urgent").length;
    const unassigned = openTasks.filter((task) => !taskAssigneeId(task)).length;
    const targetOverdue = Boolean(
      project?.target_date &&
      project.status !== "done" &&
      project.status !== "archived" &&
      new Date(`${project.target_date.slice(0, 10)}T00:00:00`) < today,
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
  const projectIssuedInvoices = $derived(
    invoices.filter((invoice) => invoice.project_id === projectId && invoice.status === "issued"),
  );
  const projectBilledCents = $derived(
    projectIssuedInvoices.reduce((sum, invoice) => sum + invoice.total_cents, 0),
  );
  const projectCollectedCents = $derived(
    projectCashMovements
      .filter((movement) => movement.kind === "income")
      .reduce((sum, movement) => sum + movement.amount_cents, 0),
  );
  const projectMilestoneTotalCents = $derived(
    project?.revenue_milestones.reduce((sum, milestone) => sum + milestone.amount_cents, 0) ?? 0,
  );
  const projectSpentCents = $derived(
    projectCashMovements
      .filter((movement) => movement.kind === "expense")
      .reduce((sum, movement) => sum + movement.amount_cents, 0),
  );
  const projectFinanceCompanyId = $derived(project?.task_company_id ?? project?.client_company_id ?? project?.company_id ?? 0);
  const projectCompanyFinancialSummary = $derived(companyFinancialSummaries.find((summary) => summary.company_id === projectFinanceCompanyId));
  const projectInvestmentCents = $derived(projectCompanyFinancialSummary?.investment_income_cents ?? 0);
  const projectLoanCents = $derived(projectCompanyFinancialSummary?.loan_income_cents ?? 0);
  const economicSeries = $derived(project ? buildProjectEconomicSeries(project, projectCashMovements, new Date(), invoices) : []);
  const economicChartMax = $derived(Math.max(1, ...economicSeries.flatMap((point) => [point.planned_cents, point.billed_cents])));
  const economicPlannedPoints = $derived(economicSeries.map((point, index) => `${36 + index * (648 / Math.max(1, economicSeries.length - 1))},${112 - (point.planned_cents / economicChartMax) * 76}`).join(" "));
  const economicBilledPoints = $derived(economicSeries.map((point, index) => `${36 + index * (648 / Math.max(1, economicSeries.length - 1))},${112 - (point.billed_cents / economicChartMax) * 76}`).join(" "));
  const selectedSprint = $derived(project ? currentSprint(normalizeProjectManagement(project.management).cycles) : null);
  const selectedSprintTaskIds = $derived(new Set(sprintTasks(selectedSprint, tasks).map((task) => task.id)));

  // Filter tasks
  const filteredTasks = $derived(
    sortTasksByDueDate(tasks.filter((task) => {
      if (workScope === "sprint" && selectedSprint && !selectedSprintTaskIds.has(task.id)) return false;
      if (filterText.trim()) {
        const q = filterText.trim().toLowerCase();
        const titleMatch = task.title.toLowerCase().includes(q);
        const descMatch = (task.description || "").toLowerCase().includes(q);
        const catMatch = (task.category?.name || "").toLowerCase().includes(q);
        if (!titleMatch && !descMatch && !catMatch) return false;
      }
      if (filterStatus === "pending" && !isTaskPendingWork(task)) return false;
      if (filterStatus && filterStatus !== "pending" && task.status !== filterStatus) return false;
      if (filterType && task.type !== filterType) return false;
      if (filterPriority && task.priority !== filterPriority) return false;
      if (filterAssignee && String(taskAssigneeId(task) || "") !== filterAssignee) return false;
      return true;
    }))
  );
  function taskSubtasks(taskId: number) {
    return sortTasksByDueDate(tasks.filter((task) => task.parent_id === taskId && task.status !== "archived"));
  }

  function visibleSubtasks(taskId: number) {
    return filteredTasks.filter((task) => task.parent_id === taskId);
  }

  const parentTasksForView = $derived(
    sortTasksByDueDate(tasks.filter((task) => {
      if (task.parent_id != null) return false;
      if (task.status === "archived" && filterStatus !== "archived") return false;
      return filteredTasks.some((visible) => visible.id === task.id || visible.parent_id === task.id);
    })),
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

  function hasSubtaskAtRisk(taskId: number) {
    return taskSubtasks(taskId).some((task) => task.status === "blocked" || isTaskOverdue(task));
  }

  function hasSubtaskDueSoon(taskId: number) {
    return taskSubtasks(taskId).some((task) => isTaskDueSoon(task));
  }

  function taskIsDanger(task: WorkItem) {
    return isTaskOverdue(task) || hasSubtaskAtRisk(task.id);
  }

  function taskIsDueSoon(task: WorkItem) {
    return !taskIsDanger(task) && (isTaskDueSoon(task) || hasSubtaskDueSoon(task.id));
  }

  function sprintExecutionMode(task: WorkItem) {
    const rootId = task.parent_id ?? task.id;
    return selectedSprint?.execution_modes?.[String(rootId)] ?? null;
  }

  function sprintReviewerName(task: WorkItem) {
    const rootId = task.parent_id ?? task.id;
    const reviewerId = selectedSprint?.reviewer_ids?.[String(rootId)];
    return reviewerId ? members.find((member) => member.id === reviewerId)?.display_name ?? "Revisor" : "";
  }

  function taskOrChildrenAwaitClient(task: WorkItem) {
    return awaitsClientValidation(task) || taskSubtasks(task.id).some(awaitsClientValidation);
  }

  function columnTasks(status: KanbanStatus) {
    if (status === "archived") {
      return parentTasksForView.filter(
        (task) => task.status === "archived" || visibleSubtasks(task.id).some((child) => child.status === "archived"),
      );
    }
    if (status === "client_validation") {
      return parentTasksForView.filter(taskOrChildrenAwaitClient);
    }
    if (status === "validation") {
      return parentTasksForView.filter((task) => task.status === status && !taskOrChildrenAwaitClient(task));
    }
    return parentTasksForView.filter((task) => task.status === status);
  }

  function taskStatusLabel(s: string) {
    switch (s) {
      case "inbox": return "Backlog";
      case "planned": return "Planificado";
      case "in_progress": return "En progreso";
      case "validation": return "Validación";
      case "client_validation": return "Validar cliente";
      case "blocked": return "Bloqueado";
      case "done": return "Hecho";
      case "archived": return "Archivado";
      default: return s;
    }
  }

  function visualWorkStatus(status: KanbanStatus): WorkStatus {
    return status === "client_validation" ? "validation" : status;
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

  function requestTypeLabel(type: WorkProjectRequestType) {
    return ({ suggestion: "Sugerencia", improvement: "Mejora", issue: "Incidencia", feature: "Nueva funcionalidad", question: "Consulta" })[type];
  }

  function requestStatusLabel(status: WorkProjectRequestStatus) {
    return ({ new: "Nueva", reviewing: "En revisión", accepted: "Aceptada", rejected: "Rechazada", converted: "Convertida en tarea" })[status];
  }

  function requestStatusTone(status: WorkProjectRequestStatus): "neutral" | "ok" | "warn" | "danger" | "info" {
    if (status === "accepted" || status === "converted") return "ok";
    if (status === "rejected") return "danger";
    if (status === "reviewing") return "info";
    return "warn";
  }

  function statusBadgeTone(s: string): "neutral" | "ok" | "warn" | "danger" | "info" | "ai" {
    switch (s) {
      case "done": return "ok";
      case "in_progress": return "ai";
      case "validation": return "info";
      case "blocked": return "danger";
      case "planned": return "warn";
      default: return "neutral";
    }
  }

  function statusDotClass(status: WorkStatus) {
    switch (status) {
      case "planned": return "bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.12)]";
      case "in_progress": return "bg-purple-400 shadow-[0_0_0_3px_rgba(192,132,252,0.12)]";
      case "validation": return "bg-sky-400 shadow-[0_0_0_3px_rgba(56,189,248,0.14)]";
      case "blocked": return "bg-rose-400 shadow-[0_0_0_3px_rgba(251,113,133,0.12)]";
      case "done": return "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]";
      default: return "bg-slate-400 shadow-[0_0_0_3px_rgba(148,163,184,0.1)]";
    }
  }

  function statusBorderClass(status: WorkStatus) {
    switch (status) {
      case "planned": return "border-amber-400/55 bg-amber-500/[0.06]";
      case "in_progress": return "border-cyan-400/55 bg-cyan-500/[0.06]";
      case "validation": return "border-sky-400/65 bg-sky-500/[0.08]";
      case "blocked": return "border-rose-400/60 bg-rose-500/[0.07]";
      case "done": return "border-emerald-400/50 bg-emerald-500/[0.05]";
      default: return "border-slate-400/40 bg-slate-500/[0.04]";
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
        assignee_id: $currentUser?.id ?? null,
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
      project_type: projectType(project.project_type, project.customer_id),
      client_company_id: project.client_company_id ? String(project.client_company_id) : "",
      customer_id: project.customer_id ? String(project.customer_id) : "",
      value: String((project.value_cents / 100).toFixed(2)).replace(".", ","),
      milestones: project.revenue_milestones.map((milestone) => ({
        id: milestone.id,
        amount: String((milestone.amount_cents / 100).toFixed(2)).replace(".", ","),
        target_month: milestone.target_month,
      })),
      start_date: project.start_date ? project.start_date.slice(0, 10) : "",
      target_date: project.target_date ? project.target_date.slice(0, 10) : "",
      logo_data_url: project.logo_data_url ?? "",
    };
    editProjectModalOpen = true;
  }

  async function handleProjectLogo(file: File | undefined) {
    if (!file) return;
    try {
      editProjectForm.logo_data_url = await projectLogoDataUrl(file);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo cargar el logo", "err");
    }
  }

  function dropProjectLogo(event: DragEvent) {
    event.preventDefault();
    projectLogoDragActive = false;
    void handleProjectLogo(event.dataTransfer?.files?.[0]);
  }

  function setEditProjectType(value: string) {
    const projectType = value as WorkProjectKind;
    editProjectForm.project_type = projectType;
    if (projectType !== "client") {
      editProjectForm.customer_id = "";
    }
    if (projectType === "own") {
      editProjectForm.client_company_id = "";
      editProjectForm.value = "";
    }
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
    if (editProjectForm.project_type === "client" && hasInvalidMoneyInput(editProjectForm.value)) {
      showToast("Introduce un valor contratado válido", "err");
      return;
    }
    const invalidMilestone = editProjectForm.milestones.some((milestone) => {
      return hasInvalidMoneyInput(milestone.amount);
    });
    if (editProjectForm.project_type !== "client" && invalidMilestone) {
      showToast("Revisa los importes de los hitos mensuales", "err");
      return;
    }
    if (editProjectForm.project_type !== "client" && hasDuplicateMilestoneMonths(editProjectForm.milestones)) {
      showToast("No puedes repetir el mismo mes en dos hitos", "err");
      return;
    }
    if (editProjectForm.project_type === "internal" && !editProjectForm.client_company_id) {
      showToast("Selecciona la empresa propietaria", "err");
      return;
    }
    editProjectSaving = true;
    try {
      await api.upsertWorkProject({
        id: project.id,
        name: editProjectForm.name.trim(),
        description: editProjectForm.description.trim(),
        status: editProjectForm.status,
        project_type: editProjectForm.project_type,
        client_company_id: editProjectForm.project_type === "own" || !editProjectForm.client_company_id ? null : Number(editProjectForm.client_company_id),
        customer_id: editProjectForm.project_type === "client" && editProjectForm.customer_id ? Number(editProjectForm.customer_id) : null,
        value_cents: editProjectForm.project_type === "client"
          ? (projectValue ?? 0)
          : 0,
        monthly_estimate_cents: editProjectForm.project_type !== "client"
          ? editProjectForm.milestones.reduce(
              (sum, milestone) => sum + (parseEurosInput(milestone.amount) ?? 0),
              0,
            )
          : 0,
        revenue_target_date: null,
        revenue_milestones: editProjectForm.project_type !== "client"
          ? editProjectForm.milestones
              .map((milestone) => ({
                id: milestone.id,
                amount_cents: parseEurosInput(milestone.amount) ?? 0,
                target_month: milestone.target_month,
              }))
              .filter((milestone) => milestone.amount_cents > 0 && milestone.target_month)
          : [],
        start_date: editProjectForm.start_date || null,
        target_date: editProjectForm.target_date || null,
        logo_data_url: editProjectForm.logo_data_url,
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
    const targetMonth = nextMilestoneMonth(milestoneMonthOptions, editProjectForm.milestones);
    if (!targetMonth) {
      showToast("No quedan más meses disponibles para añadir otro hito", "err");
      return;
    }
    editProjectForm.milestones = [
      ...editProjectForm.milestones,
      { amount: "", target_month: targetMonth },
    ];
  }

  function removeEditMilestone(index: number) {
    editProjectForm.milestones = editProjectForm.milestones.filter(
      (_, itemIndex) => itemIndex !== index,
    );
  }

  function openDocumentsModal() {
    if (!project) return;
    uploadFile = null;
    uploadError = "";
    documentsForm = project.documents.map((document) => ({
      id: document.id,
      title: document.title,
      kind: document.kind,
      location: document.location,
      notes: document.notes,
    }));
    documentsModalOpen = true;
  }

  function openBriefModal() {
    if (!project) return;
    const brief = normalizeProjectBrief(project.brief, project.tech_stack);
    briefForm = {
      summary: brief.summary || project.prd || "", problem: brief.problem, objectives: brief.objectives,
      users: brief.users, scope: brief.scope, out_of_scope: brief.out_of_scope,
      functional_requirements: brief.functional_requirements,
      non_functional_requirements: brief.non_functional_requirements,
      acceptance_criteria: brief.acceptance_criteria, risks: brief.risks,
      dependencies: brief.dependencies, success_metrics: brief.success_metrics, notes: brief.notes,
      frontend: brief.technology.frontend.join(", "), backend: brief.technology.backend.join(", "), app: brief.technology.app.join(", "),
      database: brief.technology.database.join(", "), infrastructure: brief.technology.infrastructure.join(", "),
      deployment: brief.technology.deployment.join(", "), integrations: brief.technology.integrations.join(", "), plugins: brief.technology.plugins.join(", "),
      ai: brief.technology.ai.join(", "), tools: brief.technology.tools.join(", "),
      repository_url: brief.technology.repository_url, documentation_url: brief.technology.documentation_url,
      staging_url: brief.technology.staging_url, production_url: brief.technology.production_url,
    };
    briefModalOpen = true;
  }

  async function saveProjectBrief() {
    if (!project || briefSaving) return;
    briefSaving = true;
    try {
      const brief = normalizeProjectBrief({
        ...briefForm,
        technology: {
          frontend: parseTechStack(briefForm.frontend), backend: parseTechStack(briefForm.backend), app: parseTechStack(briefForm.app),
          database: parseTechStack(briefForm.database), infrastructure: parseTechStack(briefForm.infrastructure),
          deployment: parseTechStack(briefForm.deployment), integrations: parseTechStack(briefForm.integrations), plugins: parseTechStack(briefForm.plugins),
          ai: parseTechStack(briefForm.ai), tools: parseTechStack(briefForm.tools),
          repository_url: briefForm.repository_url, documentation_url: briefForm.documentation_url,
          staging_url: briefForm.staging_url, production_url: briefForm.production_url,
        },
      });
      await api.upsertWorkProject({
        id: project.id,
        name: project.name,
        prd: normalizeProjectPrd(brief.summary),
        tech_stack: Object.values(brief.technology).filter(Array.isArray).flat() as string[],
        brief,
      });
      briefModalOpen = false;
      showToast("Ficha técnica actualizada");
      await loadData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo guardar la ficha técnica", "err");
    } finally {
      briefSaving = false;
    }
  }

  function addProjectDocument() {
    documentsForm = [...documentsForm, { title: "", kind: "link", location: "", notes: "" }];
  }

  function removeProjectDocument(index: number) {
    documentsForm = documentsForm.filter((_, itemIndex) => itemIndex !== index);
  }

  function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
  }

  function selectProjectDocumentFile(file: File | null) {
    uploadFile = file;
    uploadError = "";
    if (file && file.size > 20 * 1024 * 1024) {
      uploadError = `El fichero pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y supera el límite de 20 MB.`;
    }
  }

  async function uploadProjectDocument(fileOverride?: File) {
    const file = fileOverride ?? uploadFile;
    if (!project || !file || documentUploading) return;
    uploadError = "";
    if (file.size > 20 * 1024 * 1024) {
      uploadError = `El fichero pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y supera el límite de 20 MB.`;
      return;
    }
    documentUploading = true;
    try {
      const drivePlugin = (await api.listPlugins()).find((plugin) => plugin.plugin_key === "google_drive");
      if (!drivePlugin?.enabled) throw new Error("Activa Google Drive en Ajustes → Plugins");
      const result = await api.uploadProjectFile({
        provider: "google_drive",
        project_id: project.id,
        name: file.name,
        mime_type: file.type || "application/octet-stream",
        content_base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      }, drivePlugin.config.folder_id ?? "");
      documentsForm = [{
        title: result.name,
        kind: "link",
        location: result.web_url,
        notes: `Google Drive · ${result.mime_type} · ${result.size} bytes`,
      }, ...documentsForm];
      uploadFile = null;
      if (uploadFileInput) uploadFileInput.value = "";
      showToast("Fichero subido. Revisa el título y guarda la documentación");
    } catch (error) {
      uploadError = error instanceof Error ? error.message : "No se pudo subir el fichero";
      showToast(uploadError, "err");
    } finally {
      documentUploading = false;
    }
  }

  function dropProjectDocument(event: DragEvent) {
    event.preventDefault();
    documentDragActive = false;
    const file = event.dataTransfer?.files?.[0] ?? null;
    selectProjectDocumentFile(file);
    if (file && file.size <= 20 * 1024 * 1024) void uploadProjectDocument(file);
  }

  async function saveProjectDocuments() {
    if (!project || documentsSaving) return;
    const validationError = validateProjectDocuments(documentsForm);
    if (validationError) {
      showToast(validationError, "err");
      return;
    }
    documentsSaving = true;
    try {
      await api.upsertWorkProject({
        id: project.id,
        name: project.name,
        documents: normalizeProjectDocuments(documentsForm),
      });
      documentsModalOpen = false;
      showToast("Documentación del proyecto actualizada");
      await loadData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al guardar la documentación", "err");
    } finally {
      documentsSaving = false;
    }
  }

  function resetRequestForm() {
    editingRequestId = null;
    requestComment = "";
    requestForm = { type: "suggestion", title: "", description: "", requester: "", priority: "normal", impact: "", status: "new", reviewer_id: "" };
  }

  function openRequestsModal(request?: WorkProjectRequest) {
    if (request) {
      editingRequestId = request.id;
      requestForm = {
        type: request.type, title: request.title, description: request.description,
        requester: request.requester, priority: request.priority, impact: request.impact,
        status: request.status, reviewer_id: request.reviewer_id ? String(request.reviewer_id) : "",
      };
      requestComment = "";
    } else resetRequestForm();
    requestsModalOpen = true;
  }

  async function persistProjectRequests(requests: WorkProjectRequest[]) {
    if (!project) return;
    await api.upsertWorkProject({ id: project.id, name: project.name, requests });
  }

  async function saveProjectRequest() {
    if (!project || requestSaving) return;
    if (!requestForm.title.trim() || !requestForm.description.trim()) {
      showToast("Indica el título y la descripción de la solicitud", "err");
      return;
    }
    requestSaving = true;
    try {
      const now = new Date().toISOString();
      const existing = (project.requests ?? []).find((item) => item.id === editingRequestId);
      const request: WorkProjectRequest = {
        id: existing?.id ?? crypto.randomUUID(),
        ...requestForm,
        title: requestForm.title.trim(), description: requestForm.description.trim(),
        requester: requestForm.requester.trim(), impact: requestForm.impact.trim(),
        reviewer_id: requestForm.reviewer_id ? Number(requestForm.reviewer_id) : null,
        task_id: existing?.task_id ?? null,
        messages: existing?.messages ?? [], created_at: existing?.created_at ?? now, updated_at: now,
      };
      if (requestComment.trim()) request.messages = [...request.messages, { id: crypto.randomUUID(), author: $currentUser?.username ?? "Equipo", text: requestComment.trim(), created_at: now }];
      const requests = existing
        ? (project.requests ?? []).map((item) => item.id === request.id ? request : item)
        : [request, ...(project.requests ?? [])];
      await persistProjectRequests(requests);
      showToast(existing ? "Solicitud actualizada" : "Solicitud registrada");
      await loadData();
      editingRequestId = request.id;
      requestComment = "";
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo guardar la solicitud", "err");
    } finally { requestSaving = false; }
  }

  async function deleteProjectRequest(request: WorkProjectRequest) {
    if (!project || requestSaving) return;
    const accepted = await confirmDialog(`¿Quieres eliminar «${request.title}»? Esta acción no se puede deshacer.`, {
      title: "Eliminar solicitud",
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!accepted) return;
    requestSaving = true;
    try {
      await persistProjectRequests((project.requests ?? []).filter((item) => item.id !== request.id));
      requestsModalOpen = false;
      resetRequestForm();
      showToast("Solicitud eliminada");
      await loadData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo eliminar la solicitud", "err");
    } finally {
      requestSaving = false;
    }
  }

  async function convertRequestToTask(request: WorkProjectRequest) {
    if (!project || requestSaving || request.task_id) return;
    requestSaving = true;
    try {
      const task = await api.upsertWorkItem({
        title: request.title, description: `${request.description}${request.impact ? `\n\nImpacto: ${request.impact}` : ""}${request.requester ? `\n\nSolicitado por: ${request.requester}` : ""}`,
        project_id: project.id, type: request.type === "issue" ? "issue" : request.type === "suggestion" ? "idea" : "task",
        priority: request.priority, status: "inbox", assignee_id: request.reviewer_id,
        source_type: "project_request", source_key: request.id,
      });
      const now = new Date().toISOString();
      const updated = { ...request, status: "converted" as const, task_id: task.id, updated_at: now };
      await persistProjectRequests((project.requests ?? []).map((item) => item.id === request.id ? updated : item));
      requestsModalOpen = false;
      showToast("Solicitud enviada al backlog");
      await loadData();
      openEditTaskModal(task);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo convertir la solicitud", "err");
    } finally { requestSaving = false; }
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
      assignee_id: $currentUser?.id ? String($currentUser.id) : "",
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
          assignee_id: $currentUser?.id ?? null,
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
            assignee_id: $currentUser?.id ?? null,
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
      assignee_id: parent.assignee_id ? String(parent.assignee_id) : ($currentUser?.id ? String($currentUser.id) : ""),
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
    reviewDraft = "";
    detailModalOpen = true;
  }

  async function addReviewMessage(kind: "comment" | "changes_requested" | "approved") {
    if (!editingTask || reviewSaving) return;
    const text = reviewDraft.trim();
    if (kind !== "approved" && !text) {
      showToast("Escribe el comentario de validación", "err");
      return;
    }
    reviewSaving = true;
    try {
      const requiresClientApproval = kind === "approved" && projectType(project?.project_type, project?.customer_id) === "client";
      if (requiresClientApproval) {
        const saved = await api.submitTaskForClientValidation(editingTask.id);
        editingTask = saved;
        detailForm.status = saved.status;
        tasks = tasks.map((task) => task.id === saved.id ? saved : task);
        reviewDraft = "";
        const notification = saved.client_notification;
        showToast(notification?.warning ?? `Validación interna aprobada · ${notification?.notified ?? 0} aviso${notification?.notified === 1 ? "" : "s"} enviado${notification?.notified === 1 ? "" : "s"}`, notification?.failed ? "err" : undefined);
        return;
      }
      const status: WorkStatus = kind === "approved" && !requiresClientApproval ? "done" : kind === "changes_requested" ? "in_progress" : "validation";
      const saved = await api.upsertWorkItem({
        id: editingTask.id,
        title: editingTask.title,
        status,
        review_messages: [
          ...(editingTask.review_messages ?? []),
          {
            id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
            author_id: $currentUser?.id ?? 0,
            author_name: $currentUser?.display_name ?? "Usuario",
            message: text || (requiresClientApproval ? "Validación interna superada. Pendiente de aprobación del cliente." : "Tarea validada y aprobada."),
            created_at: new Date().toISOString(),
            kind,
          },
        ],
      });
      editingTask = saved;
      detailForm.status = saved.status;
      tasks = tasks.map((task) => task.id === saved.id ? saved : task);
      reviewDraft = "";
      showToast(kind === "approved" ? "Tarea aprobada" : kind === "changes_requested" ? "Cambios solicitados" : "Comentario añadido");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo guardar la validación", "err");
    } finally {
      reviewSaving = false;
    }
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
  function syncParentStatuses(taskList: WorkItem[], parentIds: Array<number | null | undefined>) {
    const affected = new Set(parentIds.filter((id): id is number => id != null));
    return taskList.map((item) => {
      if (!affected.has(item.id)) return item;
      const children = taskList.filter((child) => child.parent_id === item.id && child.status !== "archived");
      if (!children.length) return item;
      const status: WorkStatus = children.every((child) => child.status === "done")
        ? "done"
        : children.some((child) => child.status === "blocked")
          ? "blocked"
          : children.some((child) => child.status === "validation")
            ? "validation"
            : children.some((child) => child.status === "in_progress")
              ? "in_progress"
              : children.some((child) => child.status === "planned")
                ? "planned"
                : "inbox";
      return item.status === status ? item : { ...item, status };
    });
  }

  function taskCardRect(taskId: number) {
    return document.querySelector<HTMLElement>(`[data-kanban-task-id="${taskId}"]`)?.getBoundingClientRect();
  }

  async function animateMovedTask(taskId: number, previousRect?: DOMRect) {
    await tick();
    const element = document.querySelector<HTMLElement>(`[data-kanban-task-id="${taskId}"]`);
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const currentRect = element.getBoundingClientRect();
    if (previousRect && !reducedMotion) {
      const deltaX = previousRect.left - currentRect.left;
      const deltaY = previousRect.top - currentRect.top;
      if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
        element.animate(
          [
            { transform: `translate(${deltaX}px, ${deltaY}px)`, opacity: 0.72, boxShadow: "0 0 0 2px rgba(168,85,247,.5)" },
            { transform: "translate(0, 0)", opacity: 1, boxShadow: "0 0 0 0 rgba(168,85,247,0)" },
          ],
          { duration: 420, easing: "cubic-bezier(.22,.8,.3,1)" },
        );
      }
    }
    const margin = 20;
    const outsideViewport = currentRect.left < margin || currentRect.right > window.innerWidth - margin
      || currentRect.top < margin || currentRect.bottom > window.innerHeight - margin;
    if (outsideViewport) {
      element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    }
  }

  async function updateTaskStatus(task: WorkItem, newStatus: KanbanStatus) {
    if (newStatus === "client_validation") {
      if (!$isAdmin) {
        showToast("Solo un administrador puede enviar tareas a validar al cliente", "err");
        return;
      }
      if (task.status !== "validation") {
        showToast("La tarea debe pasar primero por Validación interna", "err");
        return;
      }
      if (awaitsClientValidation(task)) return;
      statusUpdatingTaskId = task.id;
      try {
        const saved = await api.submitTaskForClientValidation(task.id);
        tasks = syncParentStatuses(tasks.map((item) => item.id === saved.id ? { ...item, ...saved } : item), [saved.parent_id]);
        const notification = saved.client_notification;
        showToast(notification?.warning ?? `Tarea enviada al cliente · ${notification?.notified ?? 0} aviso${notification?.notified === 1 ? "" : "s"} por WhatsApp`, notification?.failed ? "err" : undefined);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "No se pudo solicitar la validación del cliente", "err");
      } finally {
        statusUpdatingTaskId = null;
      }
      return;
    }
    if (task.status === newStatus || statusUpdatingTaskId === task.id) return;
    const previousTasks = tasks;
    const previousRect = taskCardRect(task.id);
    statusUpdatingTaskId = task.id;
    tasks = syncParentStatuses(
      tasks.map((item) => item.id === task.id ? { ...item, status: newStatus } : item),
      [task.parent_id],
    );
    void animateMovedTask(task.id, previousRect);
    try {
      const saved = await api.upsertWorkItem({
        id: task.id,
        title: task.title,
        status: newStatus,
      });
      tasks = syncParentStatuses(
        tasks.map((item) => item.id === saved.id ? { ...item, ...saved } : item),
        [saved.parent_id],
      );
      void animateMovedTask(saved.id);
      showToast(`Estado actualizado a ${taskStatusLabel(newStatus)}`);
    } catch (err) {
      tasks = previousTasks;
      void animateMovedTask(task.id);
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
    const previousTasks = tasks;
    const previousParentId = task.parent_id;
    const previousRect = taskCardRect(task.id);
    statusUpdatingTaskId = task.id;
    tasks = syncParentStatuses(
      tasks.map((item) => item.id === task.id ? { ...item, parent_id: parent.id, project_id: parent.project_id } : item),
      [previousParentId, parent.id],
    );
    void animateMovedTask(task.id, previousRect);
    try {
      const saved = await api.upsertWorkItem({
        id: task.id,
        title: task.title,
        parent_id: parent.id,
      });
      tasks = syncParentStatuses(
        tasks.map((item) => item.id === saved.id ? { ...item, ...saved } : item),
        [previousParentId, saved.parent_id],
      );
      void animateMovedTask(saved.id);
      showToast(`«${task.title}» ahora es subtarea de «${parent.title}»`);
    } catch (err) {
      tasks = previousTasks;
      void animateMovedTask(task.id);
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
    kanbanLastPointerX = event.clientX || Math.max(0, event.screenX - window.screenX);
    kanbanDragCancelled = false;
    suppressTaskClick = true;
    document.addEventListener("dragover", handleKanbanBoardDragOver, true);
    document.addEventListener("drag", handleKanbanBoardDragOver, true);
    document.addEventListener("keydown", handleKanbanDragKeydown, true);
  }

  function stopKanbanAutoScroll() {
    kanbanAutoScrollSpeed = 0;
    kanbanAutoScrollElement = null;
    if (kanbanAutoScrollTimer !== null) clearInterval(kanbanAutoScrollTimer);
    kanbanAutoScrollTimer = null;
  }

  function runKanbanAutoScroll() {
    if (!kanbanAutoScrollElement || kanbanAutoScrollSpeed === 0) {
      stopKanbanAutoScroll();
      return;
    }
    const previous = kanbanAutoScrollElement.scrollLeft;
    kanbanAutoScrollElement.scrollLeft += kanbanAutoScrollSpeed;
    kanbanScrollLeft = kanbanAutoScrollElement.scrollLeft;
    if (kanbanAutoScrollElement.scrollLeft === previous) {
      stopKanbanAutoScroll();
      return;
    }
  }

  function ensureKanbanAutoScroll() {
    if (!kanbanAutoScrollElement || kanbanAutoScrollSpeed === 0) return;
    // Chrome on macOS can suspend requestAnimationFrame during native drag.
    // A short interval keeps scrolling independently from the render loop.
    if (kanbanAutoScrollTimer === null) {
      kanbanAutoScrollTimer = setInterval(runKanbanAutoScroll, 24);
    }
  }

  function startKanbanAutoScroll(direction: -1 | 1, event?: DragEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    if (draggedTaskId === null || !kanbanBoardElement) return;
    kanbanAutoScrollElement = kanbanBoardElement;
    kanbanAutoScrollSpeed = direction * 28;
    runKanbanAutoScroll();
    ensureKanbanAutoScroll();
  }

  function handleKanbanBoardDragOver(event: DragEvent) {
    if (draggedTaskId === null || !kanbanBoardElement) return;
    if (event.type === "dragover") event.preventDefault();
    const board = kanbanBoardElement;
    const rect = board.getBoundingClientRect();
    // Safari/macOS often reports clientX=0 during native HTML drag. screenX
    // remains available, so use it as a fallback and retain the last valid
    // coordinate when the browser emits an empty drag frame.
    const screenRelativeX = event.screenX ? event.screenX - window.screenX : 0;
    const pointerX = event.clientX || screenRelativeX || kanbanLastPointerX;
    if (!pointerX) return;
    kanbanLastPointerX = pointerX;
    const visibleLeft = Math.max(0, rect.left);
    const visibleRight = Math.min(window.innerWidth, rect.right);
    const edgeSize = Math.min(140, (visibleRight - visibleLeft) * 0.2);
    const leftDistance = pointerX - visibleLeft;
    const rightDistance = visibleRight - pointerX;
    const maxSpeed = 22;
    kanbanAutoScrollElement = board;
    kanbanAutoScrollSpeed = leftDistance < edgeSize
      ? -maxSpeed * (1 - Math.max(0, leftDistance) / edgeSize)
      : rightDistance < edgeSize
        ? maxSpeed * (1 - Math.max(0, rightDistance) / edgeSize)
        : 0;
    if (kanbanAutoScrollSpeed === 0) {
      stopKanbanAutoScroll();
    } else {
      runKanbanAutoScroll();
      ensureKanbanAutoScroll();
    }
  }

  function handleKanbanDragKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || draggedTaskId === null) return;
    event.preventDefault();
    event.stopPropagation();
    kanbanDragCancelled = true;
    draggedTaskId = null;
    dragOverStatus = null;
    dragOverParentId = null;
    finishKanbanDragTracking();
  }

  function finishKanbanDragTracking() {
    stopKanbanAutoScroll();
    document.removeEventListener("dragover", handleKanbanBoardDragOver, true);
    document.removeEventListener("drag", handleKanbanBoardDragOver, true);
    document.removeEventListener("keydown", handleKanbanDragKeydown, true);
  }

  function handleTaskDragEnd() {
    finishKanbanDragTracking();
    draggedTaskId = null;
    dragOverStatus = null;
    dragOverParentId = null;
    kanbanDragCancelled = false;
    kanbanLastPointerX = 0;
    setTimeout(() => {
      suppressTaskClick = false;
    }, 0);
  }

  function handleColumnDragOver(event: DragEvent, status: KanbanStatus) {
    if (draggedTaskId === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dragOverStatus = status;
  }

  function handleTaskDrop(event: DragEvent, status: KanbanStatus) {
    event.preventDefault();
    finishKanbanDragTracking();
    if (kanbanDragCancelled) {
      kanbanDragCancelled = false;
      draggedTaskId = null;
      dragOverStatus = null;
      return;
    }
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
    finishKanbanDragTracking();
    if (kanbanDragCancelled) {
      kanbanDragCancelled = false;
      draggedTaskId = null;
      dragOverParentId = null;
      dragOverStatus = null;
      return;
    }
    const transferredId = Number(event.dataTransfer?.getData("text/plain"));
    const taskId = draggedTaskId ?? (Number.isFinite(transferredId) ? transferredId : null);
    const task = tasks.find((item) => item.id === taskId);
    draggedTaskId = null;
    dragOverParentId = null;
    dragOverStatus = null;
    if (task) void updateTaskParent(task, parent);
  }

  onDestroy(() => {
    if (browser) finishKanbanDragTracking();
  });


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
      {#if projectsList.length !== 1}
        <a
          href="/proyectos"
          class="inline-flex items-center gap-2 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-purple-bright)] transition"
        >
          ← Volver a Proyectos
        </a>
      {:else}<span></span>{/if}
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
        <div class="flex min-w-0 flex-1 items-start gap-4">
          {#if projectLogo(project)}
            <img src={projectLogo(project)} alt="Logo de {project.name}" class="h-20 w-20 shrink-0 rounded-2xl border border-white/10 object-cover shadow-lg" />
          {/if}
          <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-3 mb-2">
            <h1 class="text-2xl font-bold text-[var(--color-text)]">
              {project.name}
            </h1>
            <Badge tone={projectStatusTone(project.status)}>
              {projectStatusLabel(project.status)}
            </Badge>
          </div>

          {#if project.description}
            <div class="relative mb-3">
              <div class="overflow-hidden transition-[max-height] duration-500 ease-out {projectDescriptionExpanded ? 'max-h-[80rem]' : 'max-h-[3.25rem]'}">
                <RichDescription value={project.description} class="text-sm leading-relaxed text-[var(--color-muted)]" />
              </div>
              {#if !projectDescriptionExpanded}
                <div class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--color-obsidian-panel)] to-transparent"></div>
              {/if}
            </div>
          {/if}

          <div class="flex flex-wrap items-center gap-6 text-xs text-[var(--color-muted-dim)]">
            <span>
              {projectTypeLabel(project.project_type, project.customer_id)}:
              <strong class="text-[var(--color-text)]">
                {project.client_company_id
                  ? projectCompanyName(project.client_company_id)
                  : project.customer_id
                    ? projectCustomer?.name ?? "Cliente"
                    : "Sin empresa externa"}
              </strong>
            </span>
            {#if project.start_date}
              <span>Inicio: <strong class="text-[var(--color-text)]">{formatDate(project.start_date)}</strong></span>
            {/if}
            <span>Objetivo: <strong class="text-[var(--color-text)]">{formatDate(project.target_date)}</strong></span>
            {#if project.description}
              <button
                type="button"
                class="ml-auto inline-flex items-center gap-1 pl-4 font-medium text-[var(--color-purple-bright)] hover:text-white"
                aria-expanded={projectDescriptionExpanded}
                onclick={() => (projectDescriptionExpanded = !projectDescriptionExpanded)}
              >
                {projectDescriptionExpanded ? "Ver menos" : "Ver más"}
                <span class="transition-transform duration-300 {projectDescriptionExpanded ? 'rotate-180' : ''}" aria-hidden="true">⌄</span>
              </button>
            {/if}
          </div>
          </div>
        </div>

        <ProjectProgress total={totalTasks} completed={completedTasks} blocked={blockedTasks} progress={progressPercent} ready={tasksLoaded} />
      </div>
    </Card>

    <nav class="mb-6 flex gap-2 overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-black/20 p-2" aria-label="Secciones del proyecto" data-project-sections>
      {#each projectSections as section}
        <button
          type="button"
          aria-current={activeProjectSection === section.id ? "page" : undefined}
          class="shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition {activeProjectSection === section.id ? 'bg-purple-500/20 text-[var(--color-purple-bright)] shadow-[inset_0_0_0_1px_rgba(192,132,252,.25)]' : 'text-[var(--color-muted)] hover:bg-white/[0.04] hover:text-[var(--color-text)]'}"
          onclick={() => openProjectSection(section.id)}
        >{section.label}</button>
      {/each}
    </nav>

    {#if !activeSectionDataReady}
      <Card lift={false} class="mb-6 border border-[var(--color-border)] bg-black/10 p-6" data-project-section-loading>
        <div class="flex items-center gap-3 text-sm text-[var(--color-muted)]">
          <span class="h-4 w-4 animate-spin rounded-full border-2 border-purple-400/30 border-t-purple-300" aria-hidden="true"></span>
          <span>Cargando {projectSections.find((section) => section.id === activeProjectSection)?.label.toLowerCase()}…</span>
        </div>
      </Card>
    {:else}

    {#if activeProjectSection === "plan"}
    <ProjectManagementCenter project={project} {tasks} {members} projects={projectsList} mode="plan" onsaved={(saved) => (project = saved)} />
    <Card lift={false} class="mb-6 border border-[var(--color-border)] bg-black/10 p-4" data-project-technical-brief>
      {@const projectBrief = normalizeProjectBrief(project.brief, project.tech_stack)}
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span class="section-label">DEFINICIÓN DEL PROYECTO</span>
          <p class="mt-1 text-xs text-[var(--color-muted-dim)]">PRD y tecnologías principales para orientar al equipo.</p>
        </div>
        <div class="flex items-center gap-2">
          <Badge tone={projectTechnologyCount(projectBrief) ? "ok" : "warn"}>{projectTechnologyCount(projectBrief)} tecnologías</Badge>
          {#if $isAdmin}<Button variant="secondary" onclick={openBriefModal}>{projectBrief.summary || projectTechnologyCount(projectBrief) ? "Editar ficha" : "+ Completar ficha"}</Button>{/if}
        </div>
      </div>
      <div class="mt-4 grid gap-4 xl:grid-cols-[minmax(18rem,1fr)_minmax(0,2fr)]">
        <div class="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-300/80">Resumen del producto</p>
          {#if projectBrief.summary}
            <RichDescription value={projectBrief.summary} />
          {:else}
            <p class="text-xs text-[var(--color-muted-dim)]">Todavía no se ha definido el resumen.</p>
          {/if}
          <div class="mt-4 grid grid-cols-2 gap-2 text-[11px]">
            <span class="rounded-lg bg-black/20 px-2 py-1.5 text-[var(--color-muted)]">Alcance {projectBrief.scope ? "✓" : "—"}</span>
            <span class="rounded-lg bg-black/20 px-2 py-1.5 text-[var(--color-muted)]">Requisitos {projectBrief.functional_requirements ? "✓" : "—"}</span>
            <span class="rounded-lg bg-black/20 px-2 py-1.5 text-[var(--color-muted)]">Aceptación {projectBrief.acceptance_criteria ? "✓" : "—"}</span>
            <span class="rounded-lg bg-black/20 px-2 py-1.5 text-[var(--color-muted)]">Riesgos {projectBrief.risks ? "✓" : "—"}</span>
          </div>
        </div>
        <div class="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
          <p class="mb-3 text-xs font-semibold uppercase tracking-wide text-purple-300/80">Mapa tecnológico</p>
          {#if projectTechnologyCount(projectBrief)}
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {#each [
                ["Frontend", projectBrief.technology.frontend], ["Backend", projectBrief.technology.backend], ["App", projectBrief.technology.app],
                ["Datos", projectBrief.technology.database], ["Infra", projectBrief.technology.infrastructure],
                ["Deploy", projectBrief.technology.deployment], ["Integraciones", projectBrief.technology.integrations], ["Plugins", projectBrief.technology.plugins],
                ["IA", projectBrief.technology.ai], ["Herramientas", projectBrief.technology.tools]
              ] as group}
                {#if group[1].length}
                  <div><p class="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted-dim)]">{group[0]}</p><div class="flex flex-wrap gap-1">{#each group[1] as technology}<TechnologyBadge name={technology} />{/each}</div></div>
                {/if}
              {/each}
            </div>
          {:else}
            <p class="text-xs text-[var(--color-muted-dim)]">Todavía no se ha indicado el stack.</p>
          {/if}
          <div class="mt-4 flex flex-wrap gap-2 text-xs">
            {#if projectBrief.technology.repository_url}<a class="text-[var(--color-purple-bright)] hover:underline" href={projectBrief.technology.repository_url} target="_blank" rel="noreferrer">Repositorio ↗</a>{/if}
            {#if projectBrief.technology.documentation_url}<a class="text-[var(--color-purple-bright)] hover:underline" href={projectBrief.technology.documentation_url} target="_blank" rel="noreferrer">Docs ↗</a>{/if}
            {#if projectBrief.technology.staging_url}<a class="text-[var(--color-purple-bright)] hover:underline" href={projectBrief.technology.staging_url} target="_blank" rel="noreferrer">Staging ↗</a>{/if}
            {#if projectBrief.technology.production_url}<a class="text-[var(--color-purple-bright)] hover:underline" href={projectBrief.technology.production_url} target="_blank" rel="noreferrer">Producción ↗</a>{/if}
          </div>
        </div>
      </div>
    </Card>

    {/if}

    {#if activeProjectSection === "documentos"}
    <Card lift={false} class="mb-6 border border-[var(--color-border)] bg-black/10 p-4" data-project-documents>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span class="section-label">DOCUMENTACIÓN</span>
          <p class="mt-1 text-xs text-[var(--color-muted-dim)]">Enlaces, rutas de archivos y notas útiles del proyecto.</p>
        </div>
        {#if $isAdmin}
          <Button variant="secondary" onclick={openDocumentsModal}>{project.documents.length ? "Gestionar" : "+ Añadir documento"}</Button>
        {/if}
      </div>
      {#if project.documents.length > 0}
        <div class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {#each project.documents as document (document.id)}
            {@const href = projectDocumentHref(document)}
            <div class="min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold text-[var(--color-text)]">{document.title}</p>
                  <p class="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-purple-300/80">
                    {document.kind === "link" ? "Enlace" : document.kind === "file" ? "Archivo / ruta" : "Nota"}
                  </p>
                </div>
                {#if href}
                  <a href={href} target="_blank" rel="noreferrer" class="shrink-0 text-xs text-[var(--color-purple-bright)] hover:underline">Abrir ↗</a>
                {/if}
              </div>
              {#if document.location}
                <p class="mt-2 truncate font-mono text-[10px] text-[var(--color-muted-dim)]" title={document.location}>{document.location}</p>
              {/if}
              {#if document.notes}
                <p class="mt-2 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-[var(--color-muted)]">{document.notes}</p>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="mt-3 rounded-xl border border-dashed border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-muted-dim)]">Todavía no hay documentación vinculada.</p>
      {/if}
    </Card>
    {/if}

    {#if activeProjectSection === "equipo"}
      <ProjectManagementCenter project={project} {tasks} {members} projects={projectsList} mode="team" onsaved={(saved) => (project = saved)} />
    {/if}

    {#if activeProjectSection === "actividad"}
      <ProjectManagementCenter project={project} {tasks} {members} projects={projectsList} mode="activity" />
    {/if}

    {#if activeProjectSection === "solicitudes"}
    <Card lift={false} class="mb-6 border border-[var(--color-border)] bg-black/10 p-4" data-project-requests>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span class="section-label">SOLICITUDES Y SUGERENCIAS</span>
          <p class="mt-1 text-xs text-[var(--color-muted-dim)]">Ideas, incidencias y peticiones pendientes de decisión antes de convertirse en trabajo.</p>
        </div>
        <div class="flex items-center gap-2">
          <Badge tone={(project.requests ?? []).some((item) => item.status === "new") ? "warn" : "neutral"}>
            {(project.requests ?? []).filter((item) => !["rejected", "converted"].includes(item.status)).length} abiertas
          </Badge>
          <Button variant="secondary" onclick={() => openRequestsModal()}>+ Nueva solicitud</Button>
        </div>
      </div>
      {#if (project.requests ?? []).length}
        <div class="mt-3 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
          {#each (project.requests ?? []) as request (request.id)}
            <button type="button" onclick={() => openRequestsModal(request)} class="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-left transition hover:border-purple-400/35 hover:bg-purple-500/[0.05]">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0"><p class="truncate text-sm font-semibold text-[var(--color-text)]">{request.title}</p><p class="mt-1 text-[10px] font-bold uppercase tracking-wide text-purple-300/80">{requestTypeLabel(request.type)}{request.requester ? ` · ${request.requester}` : ""}</p></div>
                <Badge tone={requestStatusTone(request.status)}>{requestStatusLabel(request.status)}</Badge>
              </div>
              <p class="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--color-muted)]">{request.description}</p>
              <div class="mt-3 flex items-center justify-between text-[10px] text-[var(--color-muted-dim)]"><span>Prioridad {priorityLabel(request.priority).toLowerCase()}</span><span>{formatDate(request.updated_at)}</span></div>
            </button>
          {/each}
        </div>
      {:else}
        <p class="mt-3 rounded-xl border border-dashed border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-muted-dim)]">No hay solicitudes. Registra aquí una idea o petición antes de comprometerla como tarea.</p>
      {/if}
    </Card>
    {/if}

    {#if activeProjectSection === "economia"}
    <Card lift={false} class="mb-6 border border-[var(--color-border-strong)] p-5">
      <details open>
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400">
          <span class="section-label">ECONOMÍA DEL PROYECTO</span>
          <span class="text-xs text-[var(--color-purple-bright)]">Mostrar / ocultar</span>
        </summary>
      <div class="mb-4 mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-xs text-[var(--color-muted-dim)]">
            {projectType(project.project_type, project.customer_id) === "client"
              ? "Valor contratado, cobros y gastos registrados en Caja."
              : projectType(project.project_type, project.customer_id) === "internal"
                ? "Seguimiento interno del grupo; los movimientos se registran en la empresa gestora."
                : "Objetivo económico estimado para este proyecto propio."}
          </p>
        </div>
        {#if projectType(project.project_type, project.customer_id) === "client"}
          <div class="flex gap-2">
            <Button variant="secondary" onclick={() => openCashModal("expense")}>− Registrar gasto</Button>
            <Button variant="primary" onclick={() => openCashModal("income")}>+ Registrar cobro</Button>
          </div>
        {/if}
      </div>
      {#if projectType(project.project_type, project.customer_id) === "client"}
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-xl border border-purple-400/20 bg-purple-500/[0.06] p-3">
            <p class="text-xs text-[var(--color-muted)]">Valor contratado</p>
            <p class="mt-1 text-xl font-semibold text-radiant">{formatEUR(project.value_cents)}</p>
          </div>
          <div class="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] p-3">
            <p class="text-xs text-[var(--color-muted)]">Cobrado</p>
            <p class="mt-1 text-xl font-semibold text-emerald-300">{formatEUR(projectCollectedCents)}</p>
          </div>
          <div class="rounded-xl border border-rose-400/20 bg-rose-500/[0.06] p-3">
            <p class="text-xs text-[var(--color-muted)]">Gastado</p>
            <p class="mt-1 text-xl font-semibold text-rose-300">{formatEUR(projectSpentCents)}</p>
          </div>
          <div class="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.06] p-3">
            <p class="text-xs text-[var(--color-muted)]">Resultado de caja</p>
            <p class="mt-1 text-xl font-semibold text-cyan-300">{formatEUR(projectCollectedCents - projectSpentCents)}</p>
          </div>
        </div>
      {:else}
        <div class="rounded-xl border border-purple-400/20 bg-purple-500/[0.06] p-3">
          <p class="text-xs text-[var(--color-muted)]">Estimación total de hitos</p>
          <p class="mt-1 text-xl font-semibold text-radiant">
            {formatEUR(projectMilestoneTotalCents)}
          </p>
        </div>
      {/if}
      {#if economicSeries.length > 0}
        <div class="mt-3 grid items-stretch gap-3 {projectType(project.project_type, project.customer_id) !== 'client' && project.revenue_milestones.length > 0 ? 'lg:grid-cols-[minmax(0,1fr)_15rem]' : ''}">
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
        {#if projectType(project.project_type, project.customer_id) !== "client" && project.revenue_milestones.length > 0}
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
      <section class="mt-5 rounded-xl border border-cyan-300/20 bg-cyan-500/[0.025] p-4">
        <div>
          <span class="section-label">FINANCIACIÓN DE LA EMPRESA</span>
          <p class="mt-1 text-xs text-[var(--color-muted)]">Vista consolidada de inversión y préstamos recibidos por la empresa vinculada al proyecto.</p>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <div class="rounded-xl border border-purple-300/15 bg-purple-500/[0.05] p-4">
            <p class="text-[10px] font-bold uppercase tracking-wider text-purple-200/70">Inversión recibida</p>
            <strong class="mt-2 block text-xl text-purple-200">{formatEUR(projectInvestmentCents)}</strong>
          </div>
          <div class="rounded-xl border border-cyan-300/15 bg-cyan-500/[0.05] p-4">
            <p class="text-[10px] font-bold uppercase tracking-wider text-cyan-200/70">Préstamos recibidos</p>
            <strong class="mt-2 block text-xl text-cyan-200">{formatEUR(projectLoanCents)}</strong>
          </div>
          <div class="rounded-xl border border-emerald-300/15 bg-emerald-500/[0.05] p-4">
            <p class="text-[10px] font-bold uppercase tracking-wider text-emerald-200/70">Financiación recibida</p>
            <strong class="mt-2 block text-xl text-emerald-200">{formatEUR(projectInvestmentCents + projectLoanCents)}</strong>
          </div>
        </div>
        <p class="mt-3 text-[11px] text-[var(--color-muted-dim)]">Las rondas, socios y préstamos se administran desde Finanzas → Financiación.</p>
      </section>
      <ProjectGrants {project} readonly />
      </details>
    </Card>
    {/if}

    {#if activeProjectSection === "resumen"}
    <ProjectManagementCenter project={project} {tasks} {members} projects={projectsList} mode="summary" onsaved={(saved) => (project = saved)} />
    <div class="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <button type="button" onclick={() => openProjectSection("trabajo")} class="rounded-2xl border border-purple-400/20 bg-purple-500/[0.06] p-4 text-left transition hover:border-purple-400/40">
        <p class="text-2xl font-semibold text-purple-200">{totalTasks - completedTasks}</p><p class="mt-1 text-xs text-[var(--color-muted)]">Tareas pendientes · abrir trabajo →</p>
      </button>
      <button type="button" onclick={() => openProjectSection("solicitudes")} class="rounded-2xl border border-amber-400/20 bg-amber-500/[0.05] p-4 text-left transition hover:border-amber-400/40">
        <p class="text-2xl font-semibold text-amber-200">{(project.requests ?? []).filter((item) => !["rejected", "converted"].includes(item.status)).length}</p><p class="mt-1 text-xs text-[var(--color-muted)]">Solicitudes abiertas · revisar →</p>
      </button>
      <button type="button" onclick={() => openProjectSection("documentos")} class="rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.05] p-4 text-left transition hover:border-cyan-400/40">
        <p class="text-2xl font-semibold text-cyan-200">{project.documents.length}</p><p class="mt-1 text-xs text-[var(--color-muted)]">Documentos vinculados · abrir →</p>
      </button>
      <button type="button" onclick={() => openProjectSection("economia")} class="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.05] p-4 text-left transition hover:border-emerald-400/40">
        <p class="text-2xl font-semibold text-emerald-200">{formatEUR(projectType(project.project_type, project.customer_id) === "client" ? projectBilledCents : projectMilestoneTotalCents)}</p><p class="mt-1 text-xs text-[var(--color-muted)]">{projectType(project.project_type, project.customer_id) === "client" ? "Facturado" : "Hitos previstos"} · economía →</p>
      </button>
    </div>
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
    {/if}

    {#if activeProjectSection === "trabajo"}
    <SprintCenter project={project} {tasks} {members} onsaved={(saved) => (project = saved)} ontaskupdated={(saved) => (tasks = tasks.map((task) => task.id === saved.id ? saved : task))} />
    <!-- Project work sections -->
    <div id="project-work-sections" class="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <span class="section-label">{workScope === "sprint" && selectedSprint ? selectedSprint.name : "BACKLOG DEL PROYECTO"}</span>
        <p class="mt-1 text-xs text-[var(--color-muted-dim)]">{workScope === "sprint" && selectedSprint ? "El Kanban muestra únicamente el alcance comprometido del sprint." : "Organiza y refina aquí todo el trabajo antes de llevarlo a un sprint."}</p>
      </div>
      <div class="flex items-center gap-2"><div class="inline-flex rounded-xl border border-[var(--color-border)] bg-black/20 p-1"><button type="button" class="rounded-lg px-3 py-1.5 text-xs {workScope === 'sprint' ? 'bg-purple-500/25 text-purple-100' : 'text-[var(--color-muted)]'}" onclick={() => (workScope = "sprint")} disabled={!selectedSprint}>Sprint actual</button><button type="button" class="rounded-lg px-3 py-1.5 text-xs {workScope === 'backlog' ? 'bg-purple-500/25 text-purple-100' : 'text-[var(--color-muted)]'}" onclick={() => (workScope = "backlog")}>Backlog completo</button></div><span class="text-xs tabular text-[var(--color-muted)]">{filteredTasks.length} tareas</span></div>
    </div>

    <!-- Quick Capture Form for this Project -->
    {#if workScope === "backlog" || !selectedSprint}<Card lift={false} class="mb-6 border border-[var(--color-border)] bg-purple-950/10 p-4">
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
    </Card>{/if}

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
        title="No hay apartados en este proyecto"
        description={tasks.length === 0 ? "Este proyecto todavía no tiene apartados de trabajo. Crea el primero para empezar a organizarlo." : "No hay apartados que coincidan con los filtros aplicados."}
      >
        <Button variant="primary" onclick={openNewTaskModal}>+ Añadir apartado</Button>
      </EmptyState>
    {:else if viewMode === "lista"}
      <div class="space-y-3">
        {#each parentTasksForView as task (task.id)}
          {@const subtasks = taskSubtasks(task.id)}
          {@const visibleChildren = visibleSubtasks(task.id)}
          {@const completedChildren = subtasks.filter((item) => item.status === "done").length}
          {@const childProgress = subtasks.length ? Math.round((completedChildren / subtasks.length) * 100) : 0}
          <Card lift={false} class="relative overflow-visible border p-0 hover:z-50 {taskIsDanger(task) ? 'border-rose-500/60 bg-rose-500/[0.06]' : taskIsDueSoon(task) ? 'border-amber-400/55 bg-amber-500/[0.06]' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'}">
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
                  {#if sprintExecutionMode(task)}<Badge tone={sprintExecutionMode(task) === "ai" ? "ai" : sprintExecutionMode(task) === "hybrid" ? "info" : "neutral"}>{sprintExecutionMode(task) === "ai" ? "IA" : sprintExecutionMode(task) === "hybrid" ? "IA + persona" : "Persona"}{sprintReviewerName(task) ? ` · revisa ${sprintReviewerName(task)}` : ""}</Badge>{/if}
                  {#if hasSubtaskAtRisk(task.id)}<Badge tone="danger">Subtarea en peligro</Badge>{/if}
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
                {#if task.assignee_name}<AssigneeAvatar name={task.assignee_name} avatar={task.assignee_avatar_data_url} status={task.status} />{/if}
                {#if taskDueDate(task)}<span class="text-xs tabular {isTaskOverdue(task) ? 'font-semibold text-rose-300' : isTaskDueSoon(task) ? 'font-semibold text-amber-300' : 'text-[var(--color-muted-dim)]'}">📅 {formatDate(taskDueDate(task))}</span>{/if}
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
                      class="group/child relative flex w-full flex-wrap items-center gap-3 border-l-2 px-3 py-3 text-left transition hover:bg-purple-500/[0.06] {isTaskOverdue(child) ? 'border-l-rose-500 bg-rose-500/[0.07]' : isTaskDueSoon(child) ? 'border-l-amber-400 bg-amber-500/[0.06]' : 'border-l-transparent'}"
                      onclick={() => openEditTaskModal(child)}
                    >
                      <span class="h-2 w-2 shrink-0 rounded-full {statusDotClass(child.status)}"></span>
                      <div class="min-w-0 flex-1">
                        <p class="text-sm font-medium text-[var(--color-text)] group-hover/child:text-[var(--color-purple-bright)] {child.status === 'done' ? 'line-through opacity-60' : ''}">{child.title}</p>
                        {#if child.description}<RichDescription value={child.description} class="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-muted-dim)]" />{/if}
                      </div>
                      <Badge tone={statusBadgeTone(child.status)}>{taskStatusLabel(child.status)}</Badge>
                      {#if child.assignee_name}<AssigneeAvatar name={child.assignee_name} avatar={child.assignee_avatar_data_url} size="xs" status={child.status} />{/if}
                      {#if taskDueDate(child)}<span class="text-[11px] tabular {isTaskOverdue(child) ? 'font-semibold text-rose-300' : isTaskDueSoon(child) ? 'font-semibold text-amber-300' : 'text-[var(--color-muted-dim)]'}">{formatDate(taskDueDate(child))}</span>{/if}
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
          Las cabeceras permanecen visibles al desplazarte. En pantalla táctil o pantallas estrechas, desliza horizontalmente para ver todas las columnas, incluida «Hecho».
        </p>
        <div class="sticky top-0 z-[100] mb-3 overflow-hidden rounded-xl bg-[var(--color-obsidian)]/95 py-2 shadow-[0_12px_24px_-18px_rgba(0,0,0,0.95)] backdrop-blur" data-kanban-sticky-headers>
          <div
            class="flex w-max gap-4"
            style:transform={`translateX(-${kanbanScrollLeft}px)`}
          >
            {#each visibleKanbanColumns as col}
              <div class="flex w-[20rem] min-w-[20rem] shrink-0 items-center justify-between rounded-xl border-b border-[var(--color-border-soft)] bg-[var(--color-obsidian-panel)] px-3 py-2">
                <Badge tone={col.tone}>{col.label}</Badge>
                <span class="text-xs font-bold text-[var(--color-muted-dim)]">{columnTasks(col.status).length}</span>
              </div>
            {/each}
          </div>
        </div>
        <div
          bind:this={kanbanBoardElement}
          class="flex w-full min-w-0 max-w-full items-stretch gap-4 overflow-x-auto pb-4 {draggedTaskId === null ? 'snap-x' : 'snap-none'}"
          data-kanban-horizontal-scroll
          onscroll={(event) => (kanbanScrollLeft = event.currentTarget.scrollLeft)}
        >
        {#each visibleKanbanColumns as col, colIndex}
          {@const colTasks = columnTasks(col.status)}
          <div
            role="group"
            aria-label={`Columna ${col.label}`}
            class="relative flex min-h-[300px] w-[20rem] min-w-[20rem] shrink-0 snap-start self-stretch flex-col rounded-2xl border p-3 transition-all hover:z-10 {dragOverStatus === col.status
              ? 'border-[var(--color-purple-bright)] bg-purple-500/10 ring-2 ring-purple-400/20'
              : 'border-[var(--color-border)] bg-black/20'}"
            ondragover={(event) => handleColumnDragOver(event, col.status)}
            ondrop={(event) => handleTaskDrop(event, col.status)}
          >
            <!-- Column Task Cards -->
            <div class="space-y-2 flex-1">
              {#each colTasks as task (task.id)}
                {@const subtasks = visibleSubtasks(task.id)}
                {@const allSubtasks = taskSubtasks(task.id)}
                {@const completedChildren = allSubtasks.filter((item) => item.status === "done").length}
                {@const childProgress = allSubtasks.length ? Math.round((completedChildren / allSubtasks.length) * 100) : 0}
                <Card
                  data-kanban-task-id={task.id}
                  lift={true}
                  draggable={statusUpdatingTaskId !== task.id && !hasSubtasks(task.id)}
                  aria-label={hasSubtasks(task.id) ? `Tarea ${task.title} con estado automático` : `Arrastrar ${task.parent_id ? "subtarea" : "tarea"} ${task.title}`}
                  class="relative overflow-visible border p-0 transition-all hover:z-[60] select-none {hasSubtasks(task.id)
                      ? 'cursor-default border-[var(--color-border-strong)] bg-black/30'
                      : 'cursor-grab active:cursor-grabbing border-[var(--color-border-soft)] hover:border-[var(--color-border-strong)]'} {taskIsDanger(task) ? '!border-rose-500/65 bg-rose-500/[0.07]' : taskIsDueSoon(task) ? '!border-amber-400/60 bg-amber-500/[0.06]' : ''} {draggedTaskId === task.id
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
                      {#if sprintExecutionMode(task)}<Badge tone={sprintExecutionMode(task) === "ai" ? "ai" : sprintExecutionMode(task) === "hybrid" ? "info" : "neutral"}>{sprintExecutionMode(task) === "ai" ? "IA" : sprintExecutionMode(task) === "hybrid" ? "IA + humano" : "Humano"}</Badge>{/if}
                      {#if hasSubtaskAtRisk(task.id)}<Badge tone="danger">Subtarea en peligro</Badge>{/if}
                      {#if task.category}
                        <span
                          class="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style="background-color: {task.category.color}22; color: {task.category.color}"
                        >
                          {task.category.name}
                        </span>
                      {/if}
                    </div>

                    {#if task.assignee_name || taskDueDate(task)}
                      <div class="flex items-center justify-between text-[10px] text-[var(--color-muted-dim)] pt-1 border-t border-white/5">
                        {#if task.assignee_name}<AssigneeAvatar name={task.assignee_name} avatar={task.assignee_avatar_data_url} size="xs" status={visualWorkStatus(col.status)} />{:else}<span></span>{/if}
                        <span class={isTaskOverdue(task) ? "font-semibold text-rose-300" : isTaskDueSoon(task) ? "font-semibold text-amber-300" : ""}>{taskDueDate(task) ? `📅 ${formatDate(taskDueDate(task))}` : ""}</span>
                      </div>
                    {/if}
                  </div>

                  {#if subtasks.length > 0 && !isParentCollapsed(task.id)}
                    <div class="border-t border-[var(--color-border-soft)] bg-black/20 p-2">
                      <div class="space-y-1 border-l border-purple-400/25 pl-2">
                        {#each subtasks as child (child.id)}
                          <div
                            data-kanban-task-id={child.id}
                            role="button"
                            tabindex="0"
                            draggable={statusUpdatingTaskId !== child.id}
                            aria-label={`Arrastrar subtarea ${child.title}`}
                            class="group/subtask relative flex w-full cursor-grab items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left transition hover:z-[70] active:cursor-grabbing {statusBorderClass(visualWorkStatus(col.status))} {isTaskOverdue(child) ? '!border-l-rose-500 ring-1 ring-rose-500/20' : isTaskDueSoon(child) ? '!border-l-amber-400 ring-1 ring-amber-400/20' : ''} {draggedTaskId === child.id ? 'scale-[0.98] opacity-40' : ''} {statusUpdatingTaskId === child.id ? 'cursor-wait opacity-60' : ''}"
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
                            <span class="min-w-[7rem] basis-0 flex-1 truncate text-[10px] text-[var(--color-muted)] {child.status === 'done' ? 'line-through opacity-60' : ''}" title={child.title}>{child.title}</span>
                            {#if child.assignee_name}<AssigneeAvatar name={child.assignee_name} avatar={child.assignee_avatar_data_url} size="xs" status={visualWorkStatus(col.status)} />{/if}
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
        {#if draggedTaskId !== null}
          <div
            class="fixed inset-y-0 left-0 z-[300] w-24 bg-gradient-to-r from-purple-500/15 to-transparent"
            aria-hidden="true"
            ondragenter={(event) => startKanbanAutoScroll(-1, event)}
            ondragover={(event) => startKanbanAutoScroll(-1, event)}
            ondragleave={stopKanbanAutoScroll}
          ></div>
          <div
            class="fixed inset-y-0 right-0 z-[300] w-24 bg-gradient-to-l from-purple-500/15 to-transparent"
            aria-hidden="true"
            ondragenter={(event) => startKanbanAutoScroll(1, event)}
            ondragover={(event) => startKanbanAutoScroll(1, event)}
            ondragleave={stopKanbanAutoScroll}
          ></div>
        {/if}
      </div>
    {/if}
    {/if}
    {/if}
  {/if}
</section>

<!-- Edit Project Modal (Admin) -->
<Modal
  open={editProjectModalOpen}
  title="Editar Proyecto"
  size="xl"
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

    {#if editProjectForm.project_type !== "own"}
    <div
      class="space-y-2 rounded-xl border border-dashed p-3 transition {projectLogoDragActive ? 'border-purple-400 bg-purple-500/10' : 'border-[var(--color-border)]'}"
      role="group"
      aria-label="Subir imagen del proyecto"
      ondragenter={(event) => { event.preventDefault(); projectLogoDragActive = true; }}
      ondragover={(event) => { event.preventDefault(); projectLogoDragActive = true; }}
      ondragleave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) projectLogoDragActive = false; }}
      ondrop={dropProjectLogo}
      data-project-logo-dropzone
    >
      <div class="flex flex-wrap items-center gap-4">
        {#if editProjectForm.logo_data_url}
          <img src={editProjectForm.logo_data_url} alt="Vista previa del proyecto" class="h-20 w-20 rounded-xl border border-[var(--color-border)] object-cover" />
        {:else}
          <div class="grid h-20 w-20 place-items-center rounded-xl border border-dashed border-[var(--color-border)] text-2xl text-[var(--color-muted)]">◫</div>
        {/if}
        <div class="min-w-0 flex-1 space-y-2">
          <div>
            <p class="text-xs font-medium text-[var(--color-text)]">Imagen del proyecto</p>
            <p class="text-[11px] text-[var(--color-muted-dim)]">Arrastra aquí una imagen o selecciónala. PNG, JPG o WebP, máximo 1 MB.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <label class="cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs hover:bg-white/5">
              Subir imagen
              <input class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onchange={(event) => handleProjectLogo(event.currentTarget.files?.[0])} />
            </label>
            {#if editProjectForm.logo_data_url}
              <Button type="button" variant="ghost" onclick={() => (editProjectForm.logo_data_url = "")}>Quitar</Button>
            {/if}
          </div>
        </div>
      </div>
    </div>
    {/if}

    <Select
      label="Estado"
      options={projectStatusOptions}
      bind:value={editProjectForm.status}
    />

    <Select
      label="Tipo de proyecto"
      options={projectTypeOptions}
      bind:value={editProjectForm.project_type}
      onvaluechange={setEditProjectType}
    />

    {#if editProjectForm.project_type === "internal"}
      <Select
        label="Empresa propietaria"
        options={clientCompanyOptions}
        bind:value={editProjectForm.client_company_id}
        placeholder="Seleccionar empresa"
      />
    {/if}

    {#if editProjectForm.project_type === "client"}
      <Select
        label="Cliente de HEXA / contacto (opcional)"
        options={customerOptions}
        bind:value={editProjectForm.customer_id}
        placeholder="Sin cliente/contacto específico"
      />
      <p class="-mt-2 text-[11px] text-[var(--color-muted-dim)]">Se selecciona del catálogo de clientes de HEXA.</p>
    {/if}

    {#if editProjectForm.project_type === "client"}
      <div class="space-y-1">
        <label for="edit-project-value" class="text-xs font-medium text-[var(--color-muted)]">Valor contratado (€)</label>
        <MoneyInput id="edit-project-value" bind:value={editProjectForm.value} placeholder="0,00" class="text-sm" ariaLabel="Valor económico estimado (€)" />
      </div>
    {:else}
      <div class="space-y-3 rounded-xl border border-[var(--color-border)] p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-xs font-medium text-[var(--color-text)]">Hitos mensuales</p>
            <p class="text-[11px] text-[var(--color-muted-dim)]">Importe estimado y mes/año objetivo.</p>
          </div>
          <Button type="button" variant="secondary" disabled={!nextMilestoneMonth(milestoneMonthOptions, editProjectForm.milestones)} onclick={addEditMilestone}>+ Añadir hito</Button>
        </div>
        {#each editProjectForm.milestones as milestone, index}
          <div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <MoneyInput class="text-sm" bind:value={milestone.amount} placeholder="Importe (€)" />
            <Select
              options={availableMilestoneMonths(milestoneMonthOptions, editProjectForm.milestones, index)}
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

    <DateRangePicker label="Periodo del proyecto" bind:start={editProjectForm.start_date} bind:end={editProjectForm.target_date} />

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

<Modal open={briefModalOpen} title="Definición del proyecto" size="fluid" onclose={() => !briefSaving && (briefModalOpen = false)}>
  <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); saveProjectBrief(); }}>
    <details open class="rounded-xl border border-[var(--color-border)] bg-black/15 p-4"><summary class="cursor-pointer font-semibold text-[var(--color-text)]">1. Resumen y propósito</summary><div class="mt-4 grid gap-3 md:grid-cols-2">
      <label class="md:col-span-2 text-sm"><span class="mb-1 block text-[var(--color-muted)]">Resumen ejecutivo</span><textarea class="field min-h-28 w-full" bind:value={briefForm.summary} placeholder="Qué es el producto y qué valor aporta"></textarea></label>
      <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Problema y contexto</span><textarea class="field min-h-28 w-full" bind:value={briefForm.problem}></textarea></label>
      <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Objetivos</span><textarea class="field min-h-28 w-full" bind:value={briefForm.objectives}></textarea></label>
      <label class="md:col-span-2 text-sm"><span class="mb-1 block text-[var(--color-muted)]">Usuarios y perfiles</span><textarea class="field min-h-20 w-full" bind:value={briefForm.users}></textarea></label>
    </div></details>
    <details open class="rounded-xl border border-[var(--color-border)] bg-black/15 p-4"><summary class="cursor-pointer font-semibold text-[var(--color-text)]">2. Alcance y requisitos</summary><div class="mt-4 grid gap-3 md:grid-cols-2">
      <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Dentro del alcance</span><textarea class="field min-h-28 w-full" bind:value={briefForm.scope}></textarea></label>
      <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Fuera del alcance</span><textarea class="field min-h-28 w-full" bind:value={briefForm.out_of_scope}></textarea></label>
      <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Requisitos funcionales</span><textarea class="field min-h-36 w-full" bind:value={briefForm.functional_requirements}></textarea></label>
      <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Requisitos no funcionales</span><textarea class="field min-h-36 w-full" bind:value={briefForm.non_functional_requirements} placeholder="Seguridad, rendimiento, disponibilidad…"></textarea></label>
      <label class="md:col-span-2 text-sm"><span class="mb-1 block text-[var(--color-muted)]">Criterios de aceptación</span><textarea class="field min-h-28 w-full" bind:value={briefForm.acceptance_criteria}></textarea></label>
    </div></details>
    <details open class="rounded-xl border border-purple-400/20 bg-purple-500/[0.04] p-4"><summary class="cursor-pointer font-semibold text-[var(--color-text)]">3. Stack tecnológico</summary><p class="mt-1 text-xs text-[var(--color-muted-dim)]">Selecciona tecnologías conocidas o añade una personalizada.</p><div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {#each briefTechFields as field}
        <TechnologyPicker label={field.label} category={field.key} bind:value={briefForm[field.key]} />
      {/each}
    </div><div class="mt-4 grid gap-3 sm:grid-cols-2">
      <Input label="Repositorio" bind:value={briefForm.repository_url} placeholder="https://github.com/…" /><Input label="Documentación" bind:value={briefForm.documentation_url} placeholder="https://…" />
      <Input label="Staging" bind:value={briefForm.staging_url} placeholder="https://staging…" /><Input label="Producción" bind:value={briefForm.production_url} placeholder="https://…" />
    </div></details>
    <details class="rounded-xl border border-[var(--color-border)] bg-black/15 p-4"><summary class="cursor-pointer font-semibold text-[var(--color-text)]">4. Riesgos, dependencias y éxito</summary><div class="mt-4 grid gap-3 md:grid-cols-2">
      <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Riesgos</span><textarea class="field min-h-24 w-full" bind:value={briefForm.risks}></textarea></label><label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Dependencias</span><textarea class="field min-h-24 w-full" bind:value={briefForm.dependencies}></textarea></label>
      <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Métricas de éxito</span><textarea class="field min-h-24 w-full" bind:value={briefForm.success_metrics}></textarea></label><label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Notas adicionales</span><textarea class="field min-h-24 w-full" bind:value={briefForm.notes}></textarea></label>
    </div></details>
    <div class="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
      <Button type="button" variant="ghost" disabled={briefSaving} onclick={() => (briefModalOpen = false)}>Cancelar</Button>
      <Button type="submit" disabled={briefSaving}>{briefSaving ? "Guardando…" : "Guardar ficha"}</Button>
    </div>
  </form>
</Modal>

<Modal open={requestsModalOpen} title={editingRequestId ? "Detalle de la solicitud" : "Nueva solicitud o sugerencia"} size="xl" onclose={() => !requestSaving && (requestsModalOpen = false)}>
  <form class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]" onsubmit={(event) => { event.preventDefault(); saveProjectRequest(); }}>
    <div class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <Select label="Tipo" options={[{ value: "suggestion", label: "Sugerencia" }, { value: "improvement", label: "Mejora" }, { value: "issue", label: "Incidencia" }, { value: "feature", label: "Nueva funcionalidad" }, { value: "question", label: "Consulta" }]} bind:value={requestForm.type} />
        <Select label="Estado" options={[{ value: "new", label: "Nueva" }, { value: "reviewing", label: "En revisión" }, { value: "accepted", label: "Aceptada" }, { value: "rejected", label: "Rechazada" }, { value: "converted", label: "Convertida en tarea" }]} bind:value={requestForm.status} />
      </div>
      <Input label="Título" bind:value={requestForm.title} placeholder="¿Qué se solicita o propone?" required />
      <label class="block text-sm"><span class="mb-1 block text-[var(--color-muted)]">Descripción</span><textarea class="field min-h-32 w-full" bind:value={requestForm.description} placeholder="Necesidad, comportamiento esperado y contexto…" required></textarea></label>
      <div class="grid gap-3 sm:grid-cols-2">
        <Input label="Solicitante" bind:value={requestForm.requester} placeholder="Cliente, contacto o equipo" />
        <Select label="Prioridad" options={[{ value: "low", label: "Baja" }, { value: "normal", label: "Normal" }, { value: "high", label: "Alta" }, { value: "urgent", label: "Urgente" }]} bind:value={requestForm.priority} />
      </div>
      <label class="block text-sm"><span class="mb-1 block text-[var(--color-muted)]">Impacto esperado</span><textarea class="field min-h-20 w-full" bind:value={requestForm.impact} placeholder="A quién afecta, beneficio, urgencia o alcance…"></textarea></label>
      <Select label="Responsable de revisión" options={[{ value: "", label: "Sin asignar" }, ...members.map((member) => ({ value: String(member.id), label: member.display_name }))]} bind:value={requestForm.reviewer_id} />
      <div class="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] pt-4">
        <Button type="button" variant="ghost" disabled={requestSaving} onclick={() => (requestsModalOpen = false)}>Cancelar</Button>
        {#if editingRequestId}
          {@const requestToConvert = (project?.requests ?? []).find((item) => item.id === editingRequestId)}
          <Button type="button" variant="danger" disabled={requestSaving} onclick={() => requestToConvert && deleteProjectRequest(requestToConvert)}>Eliminar</Button>
          {#if requestToConvert && !requestToConvert.task_id && requestForm.status === "accepted"}<Button type="button" variant="secondary" disabled={requestSaving} onclick={() => convertRequestToTask(requestToConvert)}>Enviar al backlog</Button>{/if}
          {#if requestToConvert?.task_id}<Button type="button" variant="secondary" onclick={() => { const linkedTask = tasks.find((item) => item.id === requestToConvert.task_id); requestsModalOpen = false; if (linkedTask) openEditTaskModal(linkedTask); }}>Abrir tarea vinculada</Button>{/if}
        {/if}
        <Button type="submit" disabled={requestSaving}>{requestSaving ? "Guardando…" : editingRequestId ? "Guardar cambios" : "Registrar solicitud"}</Button>
      </div>
    </div>
    <aside class="rounded-xl border border-sky-400/20 bg-sky-500/[0.04] p-4">
      <p class="font-semibold text-[var(--color-text)]">Seguimiento</p>
      <p class="mt-1 text-xs text-[var(--color-muted-dim)]">Anota decisiones, aclaraciones y respuestas del solicitante.</p>
      {#if editingRequestId}
        {@const currentRequest = (project?.requests ?? []).find((item) => item.id === editingRequestId)}
        <div class="mt-4 max-h-64 space-y-2 overflow-y-auto">
          {#each currentRequest?.messages ?? [] as message (message.id)}
            <div class="rounded-lg border border-white/[0.07] bg-black/20 p-2.5"><div class="flex justify-between gap-2 text-[10px] text-[var(--color-muted-dim)]"><strong class="text-sky-200">{message.author}</strong><span>{formatDate(message.created_at)}</span></div><p class="mt-1 whitespace-pre-line text-xs text-[var(--color-muted)]">{message.text}</p></div>
          {:else}<p class="rounded-lg border border-dashed border-white/10 p-3 text-xs text-[var(--color-muted-dim)]">Sin comentarios todavía.</p>{/each}
        </div>
        <label class="mt-4 block text-xs"><span class="mb-1 block text-[var(--color-muted)]">Añadir comentario al guardar</span><textarea class="field min-h-24 w-full" bind:value={requestComment} placeholder="Decisión, duda o respuesta…"></textarea></label>
      {:else}
        <div class="mt-4 rounded-lg border border-dashed border-white/10 p-3 text-xs leading-relaxed text-[var(--color-muted-dim)]">Guarda primero la solicitud para iniciar su historial de conversación.</div>
      {/if}
    </aside>
  </form>
</Modal>

<Modal
  open={documentsModalOpen}
  title="Documentación del proyecto"
  size="xl"
  onclose={() => !documentsSaving && (documentsModalOpen = false)}
>
  <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); saveProjectDocuments(); }}>
    <div
      class="rounded-xl border border-dashed p-3 transition {documentDragActive ? 'border-purple-300 bg-purple-500/15' : 'border-purple-400/25 bg-purple-500/[0.06]'}"
      ondragenter={(event) => { event.preventDefault(); documentDragActive = true; }}
      ondragover={(event) => { event.preventDefault(); documentDragActive = true; }}
      ondragleave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) documentDragActive = false; }}
      ondrop={dropProjectDocument}
      role="group"
      aria-label="Subir documentación del proyecto"
      data-project-document-upload
      data-project-document-dropzone
    >
      <p class="text-sm font-medium text-[var(--color-text)]">Subir un fichero</p>
      <p class="mt-1 text-xs text-[var(--color-muted)]">Arrástralo aquí para subirlo directamente o selecciónalo. Proveedor actual: Google Drive.</p>
      <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label class="flex min-w-0 flex-1 flex-col gap-1 text-xs text-[var(--color-muted)]">
          Fichero (máximo 20 MB)
          <input bind:this={uploadFileInput} type="file" class="field text-xs" onchange={(event) => selectProjectDocumentFile(event.currentTarget.files?.[0] ?? null)} />
        </label>
        <Button type="button" variant="secondary" disabled={!uploadFile || documentUploading || Boolean(uploadError)} onclick={() => uploadProjectDocument()}>
          {documentUploading ? "Subiendo…" : "Subir a Google Drive"}
        </Button>
      </div>
      {#if uploadFile && !uploadError}
        <p class="mt-2 text-xs text-emerald-300">Seleccionado: {(uploadFile.size / 1024 / 1024).toFixed(1)} MB · listo para subir.</p>
      {/if}
      {#if uploadError}
        <p class="mt-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200" role="alert">{uploadError}</p>
      {/if}
    </div>
    <div class="flex items-center justify-between gap-3">
      <p class="text-xs text-[var(--color-muted)]">Añade enlaces web, rutas de archivos compartidos o notas internas.</p>
      <Button type="button" variant="secondary" onclick={addProjectDocument}>+ Documento</Button>
    </div>
    <div class="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
      {#each documentsForm as document, index}
        <div class="space-y-3 rounded-xl border border-[var(--color-border)] bg-black/15 p-3">
          <div class="grid gap-3 sm:grid-cols-[1fr_11rem_auto]">
            <div class="space-y-1">
              <label for={`project-document-title-${index}`} class="text-xs text-[var(--color-muted)]">Título</label>
              <input id={`project-document-title-${index}`} class="field w-full text-sm" bind:value={document.title} placeholder="PRD, Figma, acta…" required />
            </div>
            <Select label="Tipo" options={[{ value: "link", label: "Enlace" }, { value: "file", label: "Archivo / ruta" }, { value: "note", label: "Nota" }]} bind:value={document.kind} />
            <Button type="button" variant="ghost" onclick={() => removeProjectDocument(index)}>Eliminar</Button>
          </div>
          {#if document.kind !== "note"}
            <div class="space-y-1">
              <label for={`project-document-location-${index}`} class="text-xs text-[var(--color-muted)]">{document.kind === "link" ? "URL" : "Ruta o ubicación"}</label>
              <input id={`project-document-location-${index}`} class="field w-full font-mono text-xs" bind:value={document.location} placeholder={document.kind === "link" ? "https://…" : "/proyectos/documentos/…"} required />
            </div>
          {/if}
          <div class="space-y-1">
            <label for={`project-document-notes-${index}`} class="text-xs text-[var(--color-muted)]">Notas</label>
            <textarea id={`project-document-notes-${index}`} class="field min-h-20 w-full resize-y text-sm" bind:value={document.notes} placeholder="Contexto, versión o instrucciones de acceso…"></textarea>
          </div>
        </div>
      {/each}
      {#if documentsForm.length === 0}
        <p class="rounded-xl border border-dashed border-[var(--color-border)] p-4 text-center text-xs text-[var(--color-muted-dim)]">Pulsa «+ Documento» para empezar.</p>
      {/if}
    </div>
    <div class="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
      <Button type="button" variant="ghost" disabled={documentsSaving} onclick={() => (documentsModalOpen = false)}>Cancelar</Button>
      <Button type="submit" variant="primary" disabled={documentsSaving}>{documentsSaving ? "Guardando…" : "Guardar documentación"}</Button>
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
      <MoneyInput bind:value={cashForm.amount} placeholder="0,00" required ariaLabel="Importe (€)" />
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
  size="xl"
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
      <DatePicker bind:value={importDueDate} ariaLabel="Fecha de entrega predeterminada" />
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
      {#each sortTasksByDueDate(tasks.filter((task) => task.parent_id == null)) as parent (parent.id)}
        <label class="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04]">
          <input
            type="checkbox"
            checked={selectedTaskIds.has(parent.id)}
            onchange={() => toggleTaskForDeletion(parent.id)}
            class="mt-0.5 h-4 w-4 accent-rose-500"
          />
          <span class="min-w-0 text-sm font-semibold text-[var(--color-text)]">{parent.title}</span>
        </label>
        {#each sortTasksByDueDate(tasks.filter((task) => task.parent_id === parent.id)) as child (child.id)}
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
  size="xl"
  onclose={() => (detailModalOpen = false)}
>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleSaveTask();
    }}
    class="space-y-4 pt-1"
  >
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

    <DateRangePicker label="Periodo de la tarea" bind:start={detailForm.start_date} bind:end={detailForm.due_date} />

    {#if editingTask && (editingTask.status === "validation" || (editingTask.review_messages?.length ?? 0) > 0)}
      <section class="space-y-3 rounded-xl border border-sky-400/25 bg-sky-500/[0.05] p-4">
        <div>
          <p class="text-sm font-semibold text-sky-100">Validación de la tarea</p>
          <p class="text-xs text-[var(--color-muted)]">Comentarios entre el responsable, el revisor o la IA antes de aprobar el trabajo.</p>
        </div>
        <div class="max-h-52 space-y-2 overflow-y-auto">
          {#if !(editingTask.review_messages?.length)}
            <p class="rounded-lg bg-black/20 px-3 py-3 text-xs text-[var(--color-muted-dim)]">Todavía no hay comentarios de revisión.</p>
          {/if}
          {#each editingTask.review_messages ?? [] as message (message.id)}
            <div class="rounded-lg border px-3 py-2 {message.kind === 'changes_requested' ? 'border-rose-400/30 bg-rose-500/[0.08]' : message.kind === 'approved' ? 'border-emerald-400/30 bg-emerald-500/[0.08]' : 'border-white/10 bg-black/20'}">
              <div class="flex items-center justify-between gap-3 text-[10px] text-[var(--color-muted-dim)]">
                <strong class="text-[var(--color-text)]">{message.author_name}</strong>
                <span>{new Date(message.created_at).toLocaleString("es-ES")}</span>
              </div>
              <p class="mt-1 whitespace-pre-wrap text-xs text-[var(--color-muted)]">{message.message}</p>
            </div>
          {/each}
        </div>
        {#if editingTask.status === "validation"}
          <textarea class="field min-h-20 w-full text-sm" bind:value={reviewDraft} placeholder="Indica qué está bien o qué debe corregirse…"></textarea>
          <div class="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={reviewSaving} onclick={() => addReviewMessage("comment")}>Añadir comentario</Button>
            <Button type="button" variant="danger" disabled={reviewSaving} onclick={() => addReviewMessage("changes_requested")}>Solicitar cambios</Button>
            {#if projectType(project?.project_type, project?.customer_id) === "client" && awaitsClientValidation(editingTask)}
              <Badge tone="info">Pendiente de validación del cliente</Badge>
            {:else}
              <Button type="button" variant="primary" disabled={reviewSaving} onclick={() => addReviewMessage("approved")}>{projectType(project?.project_type, project?.customer_id) === "client" ? "Aprobar internamente" : "Aprobar y marcar hecha"}</Button>
            {/if}
          </div>
        {/if}
      </section>
    {/if}

    <div class="flex items-center justify-between border-t border-[var(--color-border)] pt-4">
      {#if editingTask}
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="danger" type="button" onclick={handleArchiveTask}>Archivar</Button>
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
