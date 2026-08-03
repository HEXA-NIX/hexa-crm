<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api/client";
  import type {
    Customer,
    CashMovement,
    DashboardStats,
    Sale,
    Settings,
    WorkItem,
    WorkProject,
  } from "$lib/types";
  import { formatEUR } from "$lib/money";
  import KpiCard from "$lib/components/KpiCard.svelte";
  import Card from "$lib/components/Card.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import { showToast } from "$lib/stores/ui";
  import { estimateDaysOfCover, qtySoldForProduct } from "$lib/inventory/stock-cover";
  import { countsInBusinessTotals } from "$lib/sales/cancel-sale";
  import { isOnboardingDone } from "$lib/onboarding/state";
  import { backupAgeDays, needsBackupReminder } from "$lib/backup/backup-status";
  import { dashboardHealth } from "$lib/dashboard/health";
  import { activeCompany, session } from "$lib/stores/session";
  import { PROJECT_COMPANY_CODE } from "$lib/company/context";
  import { buildProjectRevenueProjection } from "$lib/projects/revenue-projection";
  import { economicGoalProgress, monthlyEconomicGoal } from "$lib/projects/economic-goal";

  let stats = $state<DashboardStats | null>(null);
  let sales = $state<Sale[]>([]);
  let sold14d = $state<Record<number, number>>({});
  let loading = $state(true);
  let onboardingPending = $state(false);
  let settings = $state<Settings | null>(null);
  let centralSynchronizedAt = $state<string | null>(null);
  let devProjects = $state<WorkProject[]>([]);
  let devTasks = $state<WorkItem[]>([]);
  let devCustomers = $state<Customer[]>([]);
  let devCashMovements = $state<CashMovement[]>([]);
  let devLoading = $state(false);

  let alertTasks = $state<Record<string, number>>({});
  const isDevCompany = $derived($activeCompany?.code === PROJECT_COMPANY_CODE);

  $effect(() => {
    const _companyId = $session.activeCompanyId;
    if (!isDevCompany) return;

    devLoading = true;
    Promise.all([
      api.listWorkProjects(),
      api.listWorkItems(),
      api.listCustomers(),
      api.listCashMovements(),
    ])
      .then(([projects, tasks, customers, cashMovements]) => {
        devProjects = projects;
        devTasks = tasks;
        devCustomers = customers;
        devCashMovements = cashMovements;
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : "Error al cargar proyectos", "err");
      })
      .finally(() => {
        devLoading = false;
      });
  });

  onMount(async () => {
    try {
      onboardingPending = !isOnboardingDone();
      [stats, sales, settings] = await Promise.all([
        api.dashboardStats(),
        api.listSales(),
        api.getSettings(),
      ]);
      centralSynchronizedAt = $session.remote ? new Date().toISOString() : null;

      if (api.supportsWorkManagement()) {
        try {
          const workItems = await api.listWorkItems();
          const taskMap: Record<string, number> = {};
          for (const item of workItems) {
            if (item.source_type === "dashboard_alert" && item.source_key && item.status !== "archived") {
              taskMap[item.source_key] = item.id;
            }
          }
          alertTasks = taskMap;
        } catch {
          /* ignore */
        }
      }

      // Build sold map for low-stock cover hints (last 14d, cap fetches)
      const cutoff = Date.now() - 14 * 86400000;
      const recentSales = sales
        .filter(
          (s) =>
            countsInBusinessTotals(s.status) && new Date(s.sold_at).getTime() >= cutoff,
        )
        .slice(0, 40);
      const lines: { product_id: number; qty: number; returned_qty?: number }[] = [];
      for (const s of recentSales) {
        try {
          const d = await api.getSale(s.id);
          if (d.lines) {
            for (const l of d.lines) {
              lines.push({
                product_id: l.product_id,
                qty: l.qty,
                returned_qty: l.returned_qty,
              });
            }
          }
        } catch {
          /* skip */
        }
      }
      const map: Record<number, number> = {};
      for (const p of stats?.low_stock ?? []) {
        map[p.id] = qtySoldForProduct(lines, p.id);
      }
      sold14d = map;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "err");
    } finally {
      loading = false;
    }
  });

  async function handleCreateTask(alert: { id: string; title: string; detail: string; href: string }) {
    try {
      const task = await api.captureDashboardAlert({
        alertId: alert.id,
        title: alert.title,
        detail: alert.detail,
        href: alert.href,
      });
      showToast("Tarea creada en Trabajo");
      alertTasks = { ...alertTasks, [alert.id]: task.id };
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al crear tarea", "err");
    }
  }

  const recent = $derived(sales.slice(0, 6));
  const showBackupReminder = $derived(needsBackupReminder(settings?.last_backup_at));
  const backupDays = $derived(backupAgeDays(settings?.last_backup_at));
  const health = $derived(dashboardHealth(sales, stats?.low_stock ?? [], showBackupReminder));
  const trendMax = $derived(Math.max(...health.trend.map((day) => day.cents), 1));
  const deltaLabel = (delta: number | null) => delta === null ? "Sin referencia" : `${delta > 0 ? "+" : ""}${delta}% vs ayer`;
  const activeDevProjects = $derived(
    devProjects.filter((project) => project.status === "active" || project.status === "planned"),
  );
  const openDevTasks = $derived(
    devTasks.filter((task) => !["done", "archived"].includes(task.status)),
  );
  const blockedDevTasks = $derived(devTasks.filter((task) => task.status === "blocked"));
  const wonProjectValueCents = $derived(
    devProjects
      .filter((project) => project.customer_id != null && project.status !== "archived")
      .reduce((sum, project) => sum + project.value_cents, 0),
  );
  const billedProjectCents = $derived(
    devCashMovements
      .filter((movement) => movement.project_id != null && movement.kind === "income")
      .reduce((sum, movement) => sum + movement.amount_cents, 0),
  );
  const totalExpenseMovements = $derived(
    devCashMovements.filter((movement) => movement.kind === "expense"),
  );
  const totalSpentCents = $derived(
    totalExpenseMovements
      .reduce((sum, movement) => sum + movement.amount_cents, 0),
  );
  const billedMarginCents = $derived(billedProjectCents - totalSpentCents);
  const projectRevenueProjection = $derived(
    buildProjectRevenueProjection(devProjects, devCashMovements),
  );
  const projectRevenuePositiveMax = $derived(
    Math.max(
      ...projectRevenueProjection.flatMap((month) => [
        month.income_cents,
        month.projection_cents,
      ]),
      0,
    ),
  );
  const projectRevenueExpenseMax = $derived(
    Math.max(...projectRevenueProjection.map((month) => month.expense_cents), 0),
  );
  const projectRevenueChartRange = $derived(
    Math.max(projectRevenuePositiveMax + projectRevenueExpenseMax, 1),
  );
  const projectRevenuePositiveShare = $derived(
    (projectRevenuePositiveMax / projectRevenueChartRange) * 100,
  );
  const projectRevenueExpenseShare = $derived(100 - projectRevenuePositiveShare);
  const currentRevenueProjection = $derived(
    projectRevenueProjection.find((month) => month.is_current),
  );
  const currentMonthKey = $derived(new Date().toISOString().slice(0, 7));
  const currentEconomicGoalCents = $derived(
    monthlyEconomicGoal(settings?.monthly_economic_goals, $session.activeCompanyId, currentMonthKey),
  );
  const currentEconomicGoalProgress = $derived(
    economicGoalProgress(currentRevenueProjection?.income_cents ?? 0, currentEconomicGoalCents),
  );
  const completedDevTasks = $derived(devTasks.filter((task) => task.status === "done").length);
  const devTaskCompletion = $derived(
    devTasks.length ? Math.round((completedDevTasks / devTasks.length) * 100) : 0,
  );
  const upcomingDevTasks = $derived(
    openDevTasks
      .filter((task) => task.due_date)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      .slice(0, 6),
  );
  const recentDevProjects = $derived(
    [...devProjects]
      .filter((project) => project.status !== "archived")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 5),
  );
  const projectProgress = (projectId: number) => {
    const projectTasks = devTasks.filter((task) => task.project_id === projectId);
    if (projectTasks.length === 0) return 0;
    return Math.round(
      (projectTasks.filter((task) => task.status === "done").length / projectTasks.length) * 100,
    );
  };
  const projectCustomerName = (customerId: number | null) =>
    customerId
      ? devCustomers.find((customer) => customer.id === customerId)?.name ?? "Cliente"
      : "Proyecto propio";
</script>

{#if loading}
  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    {#each Array(4) as _}
      <div class="skeleton h-32"></div>
    {/each}
  </div>
{:else if stats}
  {#if isDevCompany}
  <section class="pulse-page">
    <div class="workspace-intro">
      <p class="workspace-index">01 / PULSO DE PROYECTOS</p>
      <div class="workspace-intro-row">
        <h2>Proyectos claros,<br /><em>prioridades visibles.</em></h2>
        <p>Una vista rápida de la cartera, las tareas pendientes y los clientes de HEXA.</p>
      </div>
    </div>

    {#if devLoading}
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {#each Array(4) as _}
          <div class="skeleton h-32"></div>
        {/each}
      </div>
    {:else}
      <p class="section-label mb-3">Estado de la cartera</p>
      <div class="pulse-metrics grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Valor conseguido" value={formatEUR(wonProjectValueCents)} hint={`${activeDevProjects.length} proyectos en cartera`} icon="◫" accent="violet" />
        <KpiCard label="Facturado" value={formatEUR(billedProjectCents)} hint={`${openDevTasks.length} tareas abiertas`} icon="€" accent="emerald" />
        <KpiCard label="Gastado" value={formatEUR(totalSpentCents)} hint={`${totalExpenseMovements.length} gastos registrados en Caja`} icon="−" accent="amber" />
        <KpiCard
          label="Margen facturado"
          value={formatEUR(billedMarginCents)}
          hint="Facturado menos todos los gastos"
          icon="◇"
          accent={billedMarginCents < 0 ? "rose" : "cyan"}
          valueTone={billedMarginCents < 0 ? "danger" : "default"}
        />
        <KpiCard label="Objetivo mensual" value={currentEconomicGoalCents ? `${currentEconomicGoalProgress}%` : "Sin definir"} hint={currentEconomicGoalCents ? `${formatEUR(currentRevenueProjection?.income_cents ?? 0)} de ${formatEUR(currentEconomicGoalCents)}` : "Defínelo en Proyectos"} icon="◎" accent={currentEconomicGoalProgress >= 100 ? "emerald" : "violet"} />
      </div>

      {#if devProjects.length === 0}
        <Card class="mt-4 border border-purple-400/30 bg-purple-500/10" lift={false}>
          <p class="text-sm font-medium text-[var(--color-purple-bright)]">Todavía no hay proyectos</p>
          <p class="mt-1 text-xs text-[var(--color-muted)]">Crea el primero y decide si pertenece a un cliente o es un proyecto propio.</p>
          <a href="/proyectos" class="mt-3 inline-block text-sm text-radiant hover:underline">Crear proyecto →</a>
        </Card>
      {/if}

      <Card class="relative mt-4 overflow-visible" lift={false}>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 class="section-label !normal-case !tracking-wide !text-sm">Ingresos y proyección propia</h2>
            <p class="mt-1 max-w-2xl text-xs text-[var(--color-muted)]">
              Los hitos de cada proyecto propio se mantienen mes a mes hasta que un nuevo hito cambia la estimación.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
            <span class="inline-flex items-center gap-1.5 text-[var(--color-muted)]">
              <span class="h-2.5 w-2.5 rounded-sm bg-emerald-400"></span>
              Ingresos reales
            </span>
            <span class="inline-flex items-center gap-1.5 text-[var(--color-muted)]">
              <span class="h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-purple-600 to-violet-300"></span>
              Hitos propios
            </span>
            <span class="inline-flex items-center gap-1.5 text-[var(--color-muted)]">
              <span class="h-2.5 w-2.5 rounded-sm bg-rose-400"></span>
              Gastos
            </span>
          </div>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <div class="rounded-xl border border-[var(--color-border)] bg-black/20 px-3 py-2.5">
            <p class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-dim)]">Ingresos este mes</p>
            <p class="mt-1 text-lg font-semibold tabular text-emerald-300">
              {formatEUR(currentRevenueProjection?.income_cents ?? 0)}
            </p>
          </div>
          <div class="rounded-xl border border-purple-400/20 bg-purple-500/[0.07] px-3 py-2.5">
            <p class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-dim)]">Proyección propia este mes</p>
            <p class="mt-1 text-lg font-semibold tabular text-[var(--color-purple-bright)]">
              {formatEUR(currentRevenueProjection?.projection_cents ?? 0)}
            </p>
          </div>
          <div class="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.05] px-3 py-2.5">
            <p class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-dim)]">Ejecución de tareas</p>
            <p class="mt-1 text-lg font-semibold tabular text-cyan-200">{devTaskCompletion}%</p>
            <p class="mt-0.5 text-[11px] text-[var(--color-muted-dim)]">{completedDevTasks} de {devTasks.length} completadas</p>
          </div>
        </div>

        {#if currentEconomicGoalCents}
          <div class="mt-4 rounded-xl border border-[var(--color-border)] bg-black/20 p-3">
            <div class="flex items-center justify-between gap-3 text-xs">
              <span class="font-medium text-[var(--color-text)]">Objetivo económico del mes</span>
              <span class="font-semibold tabular {currentEconomicGoalProgress >= 100 ? 'text-emerald-300' : 'text-[var(--color-purple-bright)]'}">{currentEconomicGoalProgress}%</span>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div class="h-full rounded-full bg-gradient-to-r from-purple-500 to-emerald-400" style={`width: ${Math.min(currentEconomicGoalProgress, 100)}%`}></div>
            </div>
            <p class="mt-2 text-[11px] text-[var(--color-muted-dim)]">
              {currentEconomicGoalProgress >= 100 ? `Objetivo superado en ${formatEUR((currentRevenueProjection?.income_cents ?? 0) - currentEconomicGoalCents)}.` : `Faltan ${formatEUR(Math.max(currentEconomicGoalCents - (currentRevenueProjection?.income_cents ?? 0), 0))} para alcanzarlo.`}
            </p>
          </div>
        {:else}
          <a href="/proyectos" class="mt-4 flex items-center justify-between rounded-xl border border-dashed border-purple-400/30 bg-purple-500/[0.05] p-3 text-xs text-[var(--color-muted)] transition hover:bg-purple-500/10">
            <span>Define un objetivo económico para medir el avance mensual.</span>
            <strong class="text-[var(--color-purple-bright)]">Configurar →</strong>
          </a>
        {/if}

        <div class="mt-5 overflow-x-auto pb-1">
          <div class="flex h-64 min-w-[780px]" aria-label="Gráfica mensual de ingresos, proyección propia y gastos">
            <div class="relative w-20 shrink-0 pb-9 pr-3 text-right">
              <div class="absolute inset-x-0 bottom-9 top-0">
                <span class="absolute right-3 top-0 text-[10px] tabular text-[var(--color-muted-dim)]">{formatEUR(projectRevenuePositiveMax)}</span>
                <span class="absolute right-3 -translate-y-1/2 text-[10px] font-semibold tabular text-[var(--color-muted)]" style={`top: ${projectRevenuePositiveShare}%`}>0 €</span>
                {#if projectRevenueExpenseShare >= 12}
                  <span class="absolute bottom-0 right-3 text-[10px] tabular text-rose-300/70">{formatEUR(-projectRevenueExpenseMax)}</span>
                {/if}
              </div>
            </div>

            <div class="relative min-w-0 flex-1">
              <div class="pointer-events-none absolute inset-x-0 top-0 h-[calc(100%-2.25rem)]">
                <span class="block border-t border-[var(--color-border-soft)]"></span>
                <span class="absolute inset-x-0 border-t border-dashed border-[var(--color-border-soft)]" style={`top: ${projectRevenuePositiveShare / 2}%`}></span>
                <span class="absolute inset-x-0 border-t border-[var(--color-border-strong)]" style={`top: ${projectRevenuePositiveShare}%`}></span>
                {#if projectRevenueExpenseMax > 0}
                  <span class="absolute inset-x-0 bottom-0 border-t border-rose-400/20"></span>
                {/if}
              </div>

              <div class="relative z-10 grid h-full grid-cols-12 gap-2 px-1">
                {#each projectRevenueProjection as month, monthIndex (month.month)}
                  <div class="group relative flex min-w-0 flex-col items-center hover:z-50">
                    <div class="pointer-events-none absolute top-1 z-[100] hidden w-48 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-obsidian-elevated)] p-3 text-left shadow-[0_18px_45px_rgba(0,0,0,0.55)] group-hover:block {monthIndex < 2 ? 'left-0' : monthIndex > projectRevenueProjection.length - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2'}">
                      <p class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-purple-bright)]">
                        {new Date(`${month.month}-01T12:00:00`).toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
                      </p>
                      <div class="mt-2 space-y-1">
                        <p class="flex items-center justify-between gap-2 text-[11px] text-[var(--color-muted)]">
                          <span>Ingresos</span>
                          <strong class="tabular text-emerald-300">{formatEUR(month.income_cents)}</strong>
                        </p>
                        <p class="flex items-center justify-between gap-2 text-[11px] text-[var(--color-muted)]">
                          <span>Hitos propios</span>
                          <strong class="tabular text-[var(--color-purple-bright)]">{formatEUR(month.projection_cents)}</strong>
                        </p>
                        <p class="flex items-center justify-between gap-2 text-[11px] text-[var(--color-muted)]">
                          <span>Gastos</span>
                          <strong class="tabular text-rose-300">{formatEUR(-month.expense_cents)}</strong>
                        </p>
                      </div>
                    </div>

                    <div class="relative min-h-0 w-full flex-1">
                      <div class="absolute inset-x-0 top-0 flex items-end justify-center gap-1 pb-px" style={`height: ${projectRevenuePositiveShare}%`}>
                        <div
                          class="w-3 rounded-t-sm bg-emerald-400/90 transition-[height] duration-300 group-hover:bg-emerald-300"
                          style={`height: ${month.income_cents && projectRevenuePositiveMax ? Math.max(4, (month.income_cents / projectRevenuePositiveMax) * 100) : 0}%`}
                        ></div>
                        <div
                          class="w-3 rounded-t-sm bg-gradient-to-t from-purple-600 to-violet-300 transition-[height] duration-300 group-hover:from-purple-500 group-hover:to-violet-200"
                          style={`height: ${month.projection_cents && projectRevenuePositiveMax ? Math.max(4, (month.projection_cents / projectRevenuePositiveMax) * 100) : 0}%`}
                        ></div>
                      </div>
                      <div class="absolute inset-x-0 flex items-start justify-center pt-px" style={`top: ${projectRevenuePositiveShare}%; height: ${projectRevenueExpenseShare}%`}>
                        <div
                          class="w-3 rounded-b-sm bg-rose-500/90 transition-[height] duration-300 group-hover:bg-rose-400"
                          style={`height: ${month.expense_cents && projectRevenueExpenseMax ? Math.max(4, (month.expense_cents / projectRevenueExpenseMax) * 100) : 0}%`}
                        ></div>
                      </div>
                    </div>
                    <div class="mt-2 flex h-8 flex-col items-center">
                      <span class="text-[10px] font-medium uppercase {month.is_current ? 'text-[var(--color-purple-bright)]' : 'text-[var(--color-muted-dim)]'}">
                        {month.label}
                      </span>
                      {#if month.is_current}
                        <span class="mt-0.5 h-1 w-1 rounded-full bg-[var(--color-purple-bright)]"></span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div class="mt-4 grid gap-4 lg:grid-cols-3">
        <Card class="lg:col-span-2" lift={false}>
          <div class="mb-4 flex items-center justify-between">
            <h2 class="section-label !normal-case !tracking-wide !text-sm">Proyectos recientes</h2>
            <a href="/proyectos" class="text-xs text-radiant hover:underline">Ver todos</a>
          </div>
          {#if recentDevProjects.length === 0}
            <p class="text-sm text-[var(--color-muted-dim)]">La cartera está vacía.</p>
          {:else}
            <div class="space-y-2">
              {#each recentDevProjects as project (project.id)}
                {@const progress = projectProgress(project.id)}
                <a href="/proyectos/{project.uid}" class="block rounded-xl border border-[var(--color-border)] bg-black/20 p-3 transition hover:border-purple-400/35 hover:bg-purple-500/10">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium text-[var(--color-text)]">{project.name}</p>
                      <p class="mt-0.5 text-[11px] text-[var(--color-muted-dim)]">{projectCustomerName(project.customer_id)}</p>
                    </div>
                    <span class="text-xs font-semibold text-[var(--color-purple-bright)]">{progress}%</span>
                  </div>
                  <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div class="h-full bg-gradient-to-r from-purple-500 to-indigo-400" style={`width: ${progress}%`}></div>
                  </div>
                </a>
              {/each}
            </div>
          {/if}
        </Card>

        <Card lift={false}>
          <div class="mb-4 flex items-center justify-between">
            <h2 class="section-label !normal-case !tracking-wide !text-sm">Próximos vencimientos</h2>
            <a href="/trabajo" class="text-xs text-radiant hover:underline">Ver trabajo</a>
          </div>
          {#if upcomingDevTasks.length === 0}
            <p class="text-sm text-[var(--color-muted-dim)]">No hay tareas abiertas con fecha.</p>
          {:else}
            <ul class="space-y-2">
              {#each upcomingDevTasks as task (task.id)}
                <li class="rounded-xl border border-[var(--color-border)] bg-black/20 px-3 py-2.5">
                  <p class="truncate text-sm font-medium text-[var(--color-text)]">{task.title}</p>
                  <p class="mt-0.5 text-[11px] text-[var(--color-muted-dim)]">
                    {task.due_date ? new Date(task.due_date).toLocaleDateString("es-ES") : ""}
                  </p>
                </li>
              {/each}
            </ul>
          {/if}
        </Card>
      </div>

      <Card class="mt-4" lift={false}>
        <h2 class="section-label mb-4 !normal-case !tracking-wide !text-sm">Acciones rápidas</h2>
        <div class="grid gap-2 sm:grid-cols-3">
          <a href="/proyectos" class="rounded-xl border border-[var(--color-border)] bg-black/20 px-4 py-3 text-sm font-medium text-[var(--color-purple-bright)] transition hover:border-purple-400/35 hover:bg-purple-500/10">+ Nuevo proyecto</a>
          <a href="/trabajo?nuevo=1" class="rounded-xl border border-[var(--color-border)] bg-black/20 px-4 py-3 text-sm font-medium transition hover:border-purple-400/35 hover:bg-purple-500/10">+ Nueva tarea</a>
          <a href="/clientes?nuevo=1" class="rounded-xl border border-[var(--color-border)] bg-black/20 px-4 py-3 text-sm font-medium transition hover:border-purple-400/35 hover:bg-purple-500/10">+ Nuevo cliente</a>
        </div>
      </Card>
    {/if}
  </section>
  {:else}
  <section class="pulse-page">
    <div class="workspace-intro">
      <p class="workspace-index">01 / PULSO DEL NEGOCIO</p>
      <div class="workspace-intro-row">
        <h2>Lo que importa,<br /><em>ahora.</em></h2>
        <p>Una lectura breve de ventas, caja y prioridades para abrir el día con criterio.</p>
      </div>
    </div>
  {#if $session.remote}
    <p class="mb-4 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100" data-central-status>
      CRM central · tenant {$session.remote.tenantCode} · datos actualizados {centralSynchronizedAt ? new Date(centralSynchronizedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "ahora"}. Sin conexión, las operaciones no se guardan localmente.
    </p>
  {/if}
  {#if onboardingPending}
    <Card class="mb-4 border border-purple-400/30 bg-purple-500/10" lift={false} data-onboarding-hint>
      <p class="text-sm font-medium text-[var(--color-purple-bright)]">Puesta en marcha pendiente</p>
      <p class="mt-1 text-xs text-[var(--color-muted)]">
        Completa el asistente inicial o ve a Ajustes para nombrar la tienda. Luego cobra tu primera
        venta en el TPV.
      </p>
      <a href="/ventas?nuevo=1" class="mt-2 inline-block text-sm text-radiant hover:underline">
        Ir a cobrar →
      </a>
    </Card>
  {/if}
  {#if showBackupReminder}
    <Card class="mb-4 border border-amber-400/30 bg-amber-500/10" lift={false} data-backup-reminder>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-sm font-medium text-amber-100">
            {backupDays === null ? "Aún no hay una copia de seguridad" : `La última copia tiene ${backupDays} días`}
          </p>
          <p class="mt-1 text-xs text-amber-100/75">
            Guarda un JSON local antes de continuar. No se envía nada a la nube.
          </p>
        </div>
        <a href="/ajustes" class="text-sm font-medium text-amber-100 underline-offset-2 hover:underline">
          Hacer copia →
        </a>
      </div>
    </Card>
  {/if}
  <!-- Resumen KPIs -->
  <p class="section-label mb-3">El día en cifras</p>
  <div class="pulse-metrics grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <KpiCard
      label="Ventas hoy"
      value={formatEUR(stats.sales_today_cents)}
      hint={`${stats.sales_today_count} ticket(s) · ${deltaLabel(health.sales_delta_percent)}`}
      icon="◎"
      accent="emerald"
    />
    <KpiCard
      label="Ventas del mes"
      value={formatEUR(stats.sales_month_cents)}
      hint="{stats.sales_month_count} ticket(s)"
      icon="◈"
      accent="violet"
    />
    <KpiCard
      label="Saldo de caja"
      value={formatEUR(stats.cash_balance_cents)}
      hint="Presupuesto actual"
      icon="€"
      accent="cyan"
    />
    <KpiCard
      label="IVA del mes"
      value={formatEUR(stats.vat_month_cents)}
      hint="Base {formatEUR(stats.base_month_cents)}"
      icon="%"
      accent="amber"
    />
  </div>

  <div class="pulse-story mt-4 grid gap-4 lg:grid-cols-3" data-dashboard-health>
    <Card class="pulse-trend lg:col-span-2" lift={false}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="section-label !normal-case !tracking-wide !text-sm">Pulso de hoy</h2>
          <p class="mt-1 text-sm text-[var(--color-muted)]">Ticket medio {formatEUR(health.average_ticket_cents)} · {deltaLabel(health.tickets_delta_percent)} en tickets</p>
        </div>
        <span class="text-xs text-[var(--color-muted-dim)]">Últimos 7 días</span>
      </div>
      <div class="mt-5 flex h-24 items-end gap-2" aria-label="Tendencia de ventas de los últimos siete días">
        {#each health.trend as day}
          <div class="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span class="text-[10px] tabular text-[var(--color-muted-dim)]">{day.cents ? formatEUR(day.cents) : "—"}</span>
            <div class="w-full rounded-t bg-gradient-to-t from-purple-600 to-violet-300/90 transition-[height] duration-300" style={`height: ${Math.max(6, Math.round((day.cents / trendMax) * 64))}px`}></div>
            <span class="text-[10px] text-[var(--color-muted-dim)]">{new Date(`${day.date}T12:00:00`).toLocaleDateString("es-ES", { weekday: "narrow" })}</span>
          </div>
        {/each}
      </div>
    </Card>
    <Card class="pulse-attention" lift={false}>
      <div class="mb-3 flex items-center justify-between"><h2 class="section-label !normal-case !tracking-wide !text-sm">Atención ahora</h2><Badge tone={health.alerts.length ? "warn" : "ok"}>{health.alerts.length || "OK"}</Badge></div>
      {#if health.alerts.length}
        <ul class="space-y-2">
          {#each health.alerts as alert (alert.id)}
            {@const taskId = alertTasks[alert.id]}
            <li class="rounded-lg border border-[var(--color-border)] bg-black/20 p-2.5 transition hover:border-purple-400/35">
              <div class="flex items-center justify-between gap-2">
                <a href={alert.href} class="block flex-1 min-w-0">
                  <p class="text-xs font-medium text-[var(--color-text)]">{alert.title}</p>
                  <p class="mt-0.5 text-[11px] text-[var(--color-muted-dim)]">{alert.detail} →</p>
                </a>
                {#if api.supportsWorkManagement()}
                  {#if taskId}
                    <a
                      href="/trabajo?item={taskId}"
                      class="shrink-0 rounded px-2 py-1 text-xs font-medium bg-purple-500/20 text-purple-200 hover:bg-purple-500/30 border border-purple-400/20"
                    >
                      Ver tarea
                    </a>
                  {:else}
                    <button
                      type="button"
                      onclick={() => handleCreateTask(alert)}
                      class="shrink-0 rounded px-2 py-1 text-xs font-medium bg-purple-600/30 text-purple-200 hover:bg-purple-600/50 border border-purple-400/20"
                    >
                      Crear tarea
                    </button>
                  {/if}
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-emerald-300">Todo bajo control. Sigue así.</p>
      {/if}
    </Card>
  </div>

  <Card class="pulse-ai-note mt-4" lift={false} data-dashboard-ai-slot>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="section-label !normal-case !tracking-wide !text-sm">Recomendación IA</h2>
        <p class="mt-1 text-sm text-[var(--color-muted)]">Pregunta por el resumen de hoy, stock o prioridades. Si Ollama está apagado, el resto del CRM sigue disponible.</p>
      </div>
      <p class="pulse-ai-hint">El asistente vive en el sello flotante <span>↘</span></p>
    </div>
  </Card>

  <div class="pulse-details mt-8 grid gap-4 lg:grid-cols-3">
    <!-- Stock alerts as pipeline-like cards -->
    <Card class="lg:col-span-1" lift={false}>
      <div class="mb-4 flex items-center justify-between">
        <h2 class="section-label !normal-case !tracking-wide !text-sm">Stock bajo</h2>
        <Badge tone={stats.low_stock.length ? "warn" : "ok"}>
          {stats.low_stock.length ? `${stats.low_stock.length}` : "OK"}
        </Badge>
      </div>
      {#if stats.low_stock.length === 0}
        <p class="text-sm text-[var(--color-muted-dim)]">Ningún producto bajo mínimo.</p>
      {:else}
        <ul class="space-y-2">
          {#each stats.low_stock as p}
            {@const cover = estimateDaysOfCover({
              stock: p.stock,
              qtySoldInHorizon: sold14d[p.id] ?? 0,
              horizonDays: 14,
            })}
            <li>
              <a
                href="/inventario?reponer=1"
                class="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 px-3 py-2.5 transition hover:border-purple-400/25 hover:bg-purple-500/10"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-[var(--color-text)]">{p.name}</p>
                  <p class="text-[11px] text-[var(--color-muted-dim)]">
                    {p.sku}{p.category ? ` · ${p.category}` : ""}
                  </p>
                </div>
                <div class="text-right">
                  <p class="tabular text-sm text-rose-300">{p.stock}</p>
                  <p class="text-[10px] text-[var(--color-muted-dim)]">
                    mín {p.min_stock} · {cover.display}
                  </p>
                </div>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <!-- Recent sales -->
    <Card class="lg:col-span-1" lift={false}>
      <div class="mb-4 flex items-center justify-between">
        <h2 class="section-label !normal-case !tracking-wide !text-sm">Últimas ventas</h2>
        <a href="/ventas" class="text-xs text-radiant hover:underline">Ver todas</a>
      </div>
      {#if recent.length === 0}
        <p class="text-sm text-[var(--color-muted-dim)]">Aún no hay tickets.</p>
      {:else}
        <ul class="space-y-2">
          {#each recent as s}
            <li
              class="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-black/20 px-3 py-2.5"
            >
              <div>
                <p class="text-sm font-medium">{s.number}</p>
                <p class="text-[11px] text-[var(--color-muted-dim)]">
                  {new Date(s.sold_at).toLocaleString("es-ES", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <span class="tabular text-sm font-medium text-radiant">
                {formatEUR(s.total_cents)}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <!-- Quick actions panel -->
    <Card class="lg:col-span-1" lift={false}>
      <h2 class="section-label mb-4 !normal-case !tracking-wide !text-sm">Acciones rápidas</h2>
      <div class="grid gap-2">
        <a
          href="/ventas?nuevo=1"
          class="group flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-black/20 px-4 py-3 transition hover:border-purple-400/35 hover:bg-purple-500/10"
        >
          <span class="kpi-icon !h-9 !w-9">◎</span>
          <div>
            <p class="text-sm font-medium text-[var(--color-purple-bright)] group-hover:text-radiant-bright">
              Nueva venta
            </p>
            <p class="text-[11px] text-[var(--color-muted-dim)]">TPV con IVA incluido</p>
          </div>
        </a>
        <a
          href="/inventario?nuevo=1"
          class="group flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-black/20 px-4 py-3 transition hover:border-purple-400/35 hover:bg-purple-500/10"
        >
          <span class="kpi-icon !h-9 !w-9">▣</span>
          <div>
            <p class="text-sm font-medium text-[var(--color-text)]">Nuevo producto</p>
            <p class="text-[11px] text-[var(--color-muted-dim)]">Alta rápida de stock</p>
          </div>
        </a>
        <a
          href="/caja?nuevo=1"
          class="group flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-black/20 px-4 py-3 transition hover:border-purple-400/35 hover:bg-purple-500/10"
        >
          <span class="kpi-icon !h-9 !w-9">€</span>
          <div>
            <p class="text-sm font-medium text-[var(--color-text)]">Movimiento de caja</p>
            <p class="text-[11px] text-[var(--color-muted-dim)]">Gasto o ingreso manual</p>
          </div>
        </a>
        <a
          href="/impuestos"
          class="group flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-black/20 px-4 py-3 transition hover:border-purple-400/35 hover:bg-purple-500/10"
        >
          <span class="kpi-icon !h-9 !w-9">%</span>
          <div>
            <p class="text-sm font-medium text-[var(--color-text)]">Libro IVA</p>
            <p class="text-[11px] text-[var(--color-muted-dim)]">Resumen fiscal</p>
          </div>
        </a>
      </div>
      <p class="mt-4 text-[11px] leading-relaxed text-[var(--color-muted-dim)]">
        Precios con IVA incluido (0 / 4 / 10 / 21 %). Control interno — no sustituye software homologado AEAT.
      </p>
    </Card>
  </div>
  </section>
  {/if}
{/if}
