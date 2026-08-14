<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { sidebarCollapsed } from "$lib/stores/ui";
  import Logo from "$lib/components/Logo.svelte";
  import { PRODUCT_DISPLAY_NAME, PRODUCT_TAGLINE } from "$lib/product";
  import { api } from "$lib/api/client";
  import { activeCompany, isAdmin } from "$lib/stores/session";
  import type { WorkProject } from "$lib/types";
  import { isProjectCompany, isProjectPortfolioCompany } from "$lib/company/context";

  let {
    forceExpanded = false,
    onNavigate,
    onLogout,
  }: {
    forceExpanded?: boolean;
    onNavigate?: () => void;
    /** Cerrar sesión (layout wire). */
    onLogout?: () => void | Promise<void>;
  } = $props();
  let salesMenuOpen = $state(false);
  let salesTriggerElement = $state<HTMLElement | null>(null);
  let salesPopoverPosition = $state({ top: 0, left: 0 });
  let workspaceProjects = $state<WorkProject[]>([]);

  const collapsed = $derived(forceExpanded ? false : $sidebarCollapsed);
  const showWork = $derived(
    api.supportsWorkManagement() && isProjectCompany($activeCompany),
  );
  const directProject = $derived(
    showWork && !isProjectPortfolioCompany($activeCompany) && workspaceProjects.length === 1
      ? workspaceProjects[0]
      : null,
  );
  const projectEntry = $derived({
    href: directProject ? `/proyectos/${directProject.uid}` : "/proyectos",
    label: directProject ? "Gestión" : "Proyectos",
    icon: "projects",
  });
  const projectGroup = $derived(directProject
    ? { label: "GESTIÓN", links: [projectEntry, { href: "/clientes", label: "Clientes", icon: "customers" }, { href: "/trabajo", label: "Trabajo", icon: "projects" }, { href: "/roadmap", label: "Roadmap", icon: "sales" }] }
    : { label: "PROYECTOS", links: [projectEntry, { href: "/clientes", label: "Clientes", icon: "customers" }, { href: "/trabajo", label: "Trabajo", icon: "projects" }, { href: "/roadmap", label: "Roadmap", icon: "sales" }] });

  $effect(() => {
    const companyId = $activeCompany?.id ?? null;
    void $page.url.pathname;
    if (!showWork || companyId == null) {
      workspaceProjects = [];
      return;
    }
    const requestedCompanyId = companyId;
    void api.listWorkProjects().then((projects) => {
      if (($activeCompany?.id ?? null) !== requestedCompanyId) return;
      workspaceProjects = projects;
    }).catch(() => {
      if (($activeCompany?.id ?? null) === requestedCompanyId) workspaceProjects = [];
    });
  });

  const iconPaths: Record<string, string> = {
    pulse: '<path d="M4 17V9m5 8V5m5 12v-6m5 6V3"/><path d="m4 6 5-3 5 4 5-4"/>',
    sales: '<path d="M4 19V5h16v14z"/><path d="M7 15l3-3 2 2 5-5"/>',
    invoice: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    cash: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M7 9h.01M17 15h.01"/>',
    inventory: '<path d="m4 8 8-4 8 4-8 4z"/><path d="M4 8v8l8 4 8-4V8M12 12v8"/>',
    customers: '<circle cx="9" cy="8" r="3"/><path d="M3 19c.5-3 2.5-5 6-5s5.5 2 6 5M16 5a3 3 0 0 1 0 6M17 14c2.5.5 3.5 2 4 5"/>',
    projects: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 5V3h8v2M8 10h8M8 14h5"/>',
    taxes: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2z"/><path d="M8 15l2.5-2.5 2 1.8L16 11l1.5 2"/><path d="M8 8h.01"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-5L9 6a7 7 0 0 0-1.7 1L5 6 3 9.5 5.1 11a7 7 0 0 0 0 2L3 14.5 5 18l2.3-1a7 7 0 0 0 1.7 1l.5 3h5l.5-3a7 7 0 0 0 1.7-1l2.3 1 2-3.5-2.1-1.5a7 7 0 0 0 .1-1z"/>',
  };

  function iconSvg(name: string) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${iconPaths[name] ?? iconPaths.sales}</svg>`;
  }

  const navigationGroups = $derived([
    {
      label: "VISIÓN",
      links: [{ href: "/", label: "Dashboard", icon: "pulse" }],
    },
    ...(!showWork
      ? [{
          label: "OPERACIÓN",
          links: [
            { href: "/inventario", label: "Inventario", icon: "inventory" },
            { href: "/clientes", label: "Clientes", icon: "customers" },
          ],
        }]
      : []),
    {
      label: "FINANZAS",
      links: [
        { href: "/caja", label: "Caja", icon: "cash" },
        { href: "/ventas", label: "Ventas", icon: "sales" },
        { href: "/gastos", label: "Facturas recibidas", icon: "invoice" },
        { href: "/impuestos", label: "Impuestos", icon: "taxes" },
      ],
    },
    ...(showWork ? [projectGroup] : []),
    ...($isAdmin
      ? [{
          label: "PERSONAS",
          links: [{ href: "/personal", label: "Personal", icon: "customers" }],
        }]
      : []),
    {
      label: "SISTEMA",
      links: [{ href: "/ajustes", label: "Ajustes", icon: "settings" }],
    },
  ]);

  /** Deep-links that open create flows (?nuevo=1). */
  const quick = $derived([
    ...(showWork ? [{ href: "/trabajo?nuevo=1", label: "Nueva tarea" }] : []),
    ...(!showWork ? [{ href: "/ventas?nuevo=1", label: "Nueva venta" }] : []),
    ...(!showWork ? [{ href: "/inventario?nuevo=1", label: "Nuevo producto" }] : []),
    { href: "/clientes?nuevo=1", label: "Nuevo cliente" },
    { href: "/caja?nuevo=1", label: "Movimiento de caja" },
  ]);

  function active(href: string, path: string) {
    const base = href.split("?")[0];
    if (base === "/") return path === "/";
    if (href.includes("?")) return path === href;
    return path.startsWith(base);
  }

  function nav() {
    salesMenuOpen = false;
    salesTriggerElement = null;
    onNavigate?.();
  }

  function positionSalesPopover() {
    if (!salesTriggerElement || typeof window === "undefined") return;
    const rect = salesTriggerElement.getBoundingClientRect();
    const menuWidth = 224;
    const menuHeight = 178;
    const gap = 8;
    let left = rect.right + gap;
    if (left + menuWidth > window.innerWidth - gap) left = rect.left - menuWidth - gap;
    let top = rect.top - menuHeight - gap;
    if (top < gap) top = rect.bottom + gap;
    salesPopoverPosition = {
      top: Math.min(Math.max(gap, top), Math.max(gap, window.innerHeight - menuHeight - gap)),
      left: Math.min(Math.max(gap, left), Math.max(gap, window.innerWidth - menuWidth - gap)),
    };
  }

  function toggleSalesMenu(event: MouseEvent) {
    event.preventDefault();
    salesTriggerElement = event.currentTarget as HTMLElement;
    salesMenuOpen = !salesMenuOpen;
    if (salesMenuOpen) requestAnimationFrame(positionSalesPopover);
  }

  $effect(() => {
    void $page.url.pathname;
    salesMenuOpen = false;
  });

  onMount(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".sidebar-sales-trigger, .sidebar-sales-popover")) {
        salesMenuOpen = false;
        salesTriggerElement = null;
      }
    };
    document.addEventListener("click", close);
    const reposition = () => salesMenuOpen && positionSalesPopover();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("click", close);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  });

  async function logout() {
    onNavigate?.();
    await onLogout?.();
  }
</script>

<aside
  class="crm-sidebar flex h-full w-full flex-col transition-all duration-300 {collapsed ? 'md:w-[76px]' : 'md:w-[17.5rem]'}"
  data-sidebar
>
  <div class="border-b border-[var(--color-border)] px-5 py-5 sm:py-6">
    {#if !collapsed && $activeCompany}
      <div class="flex items-center gap-3">
        <img src={$activeCompany.logo_data_url || "/logo-mark.svg"} alt="Logo de {$activeCompany.trade_name}" class="company-logo-frame h-10 w-10 shrink-0 rounded-xl object-contain" />
        <div class="min-w-0">
          <p class="truncate text-base font-semibold text-[var(--color-text)]">{$activeCompany.trade_name}</p>
          <p class="truncate text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted-dim)]">{$activeCompany.code} · HEXA CRM</p>
        </div>
      </div>
    {:else}
      <div class="flex items-center gap-3">
        <Logo size={40} class="rounded-xl shadow-[0_0_20px_rgba(168,85,247,0.25)]" />
        {#if !collapsed}
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold tracking-wide text-[var(--color-text)]">{PRODUCT_DISPLAY_NAME}</p>
            <p class="truncate text-[11px] text-[var(--color-muted-dim)]" title={PRODUCT_TAGLINE}>RETAIL OPERATING SYSTEM</p>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="flex-1 overflow-y-auto p-3">

    <nav class="space-y-0.5" aria-label="Navegación principal">
      {#each navigationGroups as group, groupIndex}
        <section class:mt-4={groupIndex > 0} aria-label={group.label}>
          {#if !collapsed}
            <p class="section-label mb-2 px-2">{group.label}</p>
          {/if}
          <div class="space-y-0.5">
            {#each group.links as link}
              <div class="sidebar-link-wrap">
              <a
                href={link.href}
                onclick={(event) => { if (link.label === "Ventas") toggleSalesMenu(event); else nav(); }}
                class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 {link.label === 'Ventas' ? 'sidebar-sales-trigger' : ''} {group.label === 'VENTAS' && link.label !== 'Ventas' ? 'ml-7 pl-3 text-[var(--color-muted)]' : ''} {active(
                  link.href,
                  $page.url.pathname + $page.url.search
                )
                  ? 'nav-active'
                  : 'text-[var(--color-muted)] hover:bg-purple-500/[0.08] hover:text-[var(--color-purple-bright)]'}"
                title={link.label}
              >
                {#if link.icon}<span
                  class="sidebar-icon w-5 text-center text-base opacity-90 {active(link.href, $page.url.pathname + $page.url.search)
                    ? 'text-radiant'
                    : ''}"
                >
                  {@html iconSvg(link.icon)}
                </span>{/if}
                {#if !collapsed}
                  <span class="font-medium">{link.label}</span>
                {/if}
              </a>
              {#if link.label === "Ventas" && salesMenuOpen && !collapsed}
                <div
                  class="sidebar-sales-popover"
                  role="menu"
                  style={`top:${salesPopoverPosition.top}px;left:${salesPopoverPosition.left}px`}
                >
                  <a href="/facturas" onclick={nav} role="menuitem">Facturas</a>
                  <a href="/presupuestos" onclick={nav} role="menuitem">Presupuestos</a>
                  <a href="/servicios" onclick={nav} role="menuitem">Servicios</a>
                </div>
              {/if}
              </div>
            {/each}
          </div>
        </section>
      {/each}
    </nav>

    {#if !collapsed}
      <p class="section-label mb-2 mt-6 px-2">Accesos rápidos</p>
      <div class="space-y-0.5" data-quick-actions>
        {#each quick as q}
          <a
            href={q.href}
            onclick={nav}
            class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--color-muted)] transition hover:bg-purple-500/[0.08] hover:text-[var(--color-purple)]"
          >
            <span class="text-radiant text-sm">+</span>
            <span>{q.label}</span>
          </a>
        {/each}
      </div>
    {/if}
  </div>

  <div class="space-y-2 border-t border-[var(--color-border)] p-3">
    {#if onLogout}
      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[var(--color-muted)] transition hover:bg-rose-500/10 hover:text-rose-200"
        onclick={logout}
        data-logout
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
      >
        <span class="w-5 text-center">⎋</span>
        {#if !collapsed}
          <span class="font-medium">Cerrar sesión</span>
        {/if}
      </button>
    {/if}
    {#if !forceExpanded}
      <button
        type="button"
        class="hidden w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)] transition hover:border-purple-400/30 hover:bg-purple-500/10 hover:text-[var(--color-purple-bright)] md:block"
        onclick={() => sidebarCollapsed.update((v) => !v)}
      >
        {collapsed ? "»" : "« Contraer menú"}
      </button>
    {/if}
  </div>
</aside>

<style>
  .sidebar-icon :global(svg) { width:1.25rem; height:1.25rem; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; vertical-align:middle; }
  .sidebar-link-wrap { position:relative; }
  .sidebar-sales-popover { position:fixed; z-index:100000; width:14rem; min-width:14rem; margin:0; padding:.3rem; border:1px solid var(--color-border); border-radius:.6rem; background:var(--color-obsidian-elevated); box-shadow:0 18px 40px rgba(0,0,0,.48); }
  .sidebar-sales-popover a { display:block; border-radius:.4rem; color:var(--color-muted); padding:.55rem .7rem; font-size:.86rem; }
  .sidebar-sales-popover a:hover { background:var(--color-purple-soft); color:var(--color-purple-bright); }
</style>
