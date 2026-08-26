import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PORTFOLIO = readFileSync(resolve(__dirname, "../../routes/proyectos/+page.svelte"), "utf8");
const DETAIL = readFileSync(resolve(__dirname, "../../routes/proyectos/[id]/+page.svelte"), "utf8");

describe("estructura UI de proyectos", () => {
  it("protege la creación de proyectos por rol", () => {
    expect(PORTFOLIO).toMatch(/\{#if \$isAdmin\}[\s\S]*?\+ Nuevo proyecto/);
  });

  it("muestra el logo compacto o la inicial en cada tarjeta del portafolio", () => {
    expect(PORTFOLIO).toContain("data-project-card-logo");
    expect(PORTFOLIO).toContain("project.logo_data_url");
    expect(PORTFOLIO).toContain("project.name.trim().charAt(0)");
  });

  it("ofrece limpieza de filtros y conserva las preferencias de vista", () => {
    expect(PORTFOLIO).toContain("clearFilters");
    expect(PORTFOLIO).toContain("hexa-projects-sort");
    expect(DETAIL).toContain("clearTaskFilters");
    expect(DETAIL).toContain("hexa-project-view");
  });

  it("mantiene economía y salud bajo divulgación progresiva", () => {
    expect((DETAIL.match(/<details/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((DETAIL.match(/<details open/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(DETAIL).toContain("ECONOMÍA DEL PROYECTO");
    expect(DETAIL).toContain("SALUD Y SEÑALES");
    expect(DETAIL).toContain("Hitos previstos");
    expect(DETAIL).toContain("group-hover:block");
  });

  it("muestra y permite gestionar documentación vinculada al proyecto", () => {
    expect(DETAIL).toContain("data-project-documents");
    expect(DETAIL).toContain("Documentación del proyecto");
    expect(DETAIL).toContain("saveProjectDocuments");
    expect(DETAIL).toContain("projectDocumentHref");
    expect(DETAIL).toContain("data-project-document-dropzone");
    expect(DETAIL).toContain("dropProjectDocument");
    expect(DETAIL).toContain("data-project-logo-dropzone");
  });

  it("gestiona solicitudes y permite convertir las aceptadas en tareas", () => {
    expect(DETAIL).toContain("data-project-requests");
    expect(DETAIL).toContain("SOLICITUDES Y SUGERENCIAS");
    expect(DETAIL).toContain("saveProjectRequest");
    expect(DETAIL).toContain("convertRequestToTask");
    expect(DETAIL).toContain("Enviar al backlog");
  });

  it("separa la validación interna de la validación del cliente", () => {
    expect(DETAIL).toContain('status: "client_validation" as const');
    expect(DETAIL).toContain('label: "Validar cliente"');
    expect(DETAIL).toContain("submitTaskForClientValidation");
    expect(DETAIL).toContain("Solo un administrador puede enviar tareas a validar al cliente");
  });

  it("preselecciona al usuario de la sesión en el trabajo nuevo", () => {
    expect(DETAIL).toContain('assignee_id: $currentUser?.id ? String($currentUser.id) : ""');
    expect(DETAIL).toContain("assignee_id: $currentUser?.id ?? null");
  });

  it("incluye PRD y stack tecnológico en la ficha del proyecto", () => {
    expect(DETAIL).toContain("data-project-technical-brief");
    expect(DETAIL).toContain("Resumen y propósito");
    expect(DETAIL).toContain("Stack tecnológico");
    expect(DETAIL).toContain("Mapa tecnológico");
    expect(DETAIL).toContain('size="fluid"');
    expect(DETAIL).toContain('size="xl"');
  });

  it("hace visible el apartado de trabajo aunque el proyecto todavía esté vacío", () => {
    expect(DETAIL).toContain('id="project-work-sections"');
    expect(DETAIL).toContain("<SprintCenter");
    expect(DETAIL).toContain("No hay apartados en este proyecto");
  });

  it("dispone de una vista explícita para archivadas y Kanban móvil", () => {
    expect(DETAIL).toContain('filterStatus === "archived"');
    expect(DETAIL).toContain("overflow-x-auto");
    expect(DETAIL).toContain("w-full min-w-0 max-w-full items-stretch");
    expect(DETAIL).toContain("pantalla táctil");
  });

  it("mantiene columnas Kanban legibles y títulos visibles con scroll horizontal", () => {
    expect(DETAIL).toContain("data-kanban-horizontal-scroll");
    expect(DETAIL).toContain("data-kanban-sticky-headers");
    expect(DETAIL).toContain("kanbanScrollLeft");
    expect(DETAIL).toContain("event.currentTarget.scrollLeft");
    expect(DETAIL).toContain("overflow-x-auto");
    expect(DETAIL).toContain("sticky top-0 z-[100]");
    expect(DETAIL).toContain("w-[20rem] min-w-[20rem] shrink-0");
    expect(DETAIL).toContain("snap-start self-stretch flex-col");
    expect(DETAIL).not.toContain("flex h-full min-h-[300px]");
    expect(DETAIL).toContain("handleKanbanBoardDragOver");
    expect(DETAIL).toContain('document.addEventListener("dragover", handleKanbanBoardDragOver, true)');
    expect(DETAIL).toContain('document.addEventListener("drag", handleKanbanBoardDragOver, true)');
    expect(DETAIL).toContain("bind:this={kanbanBoardElement}");
    expect(DETAIL).toContain("setInterval(runKanbanAutoScroll, 24)");
    expect(DETAIL).toContain("draggedTaskId === null ? 'snap-x' : 'snap-none'");
    expect(DETAIL).toContain("stopKanbanAutoScroll");
    expect(DETAIL).toContain("kanbanAutoScrollElement.scrollLeft += kanbanAutoScrollSpeed");
    expect(DETAIL).toContain("const visibleRight = Math.min(window.innerWidth, rect.right)");
    expect(DETAIL).toContain("event.screenX - window.screenX");
    expect(DETAIL).toContain("kanbanLastPointerX");
    expect(DETAIL).not.toContain("event.clientY < rect.top");
    expect(DETAIL).not.toContain("handleKanbanBoardDragLeave");
    expect(DETAIL).toContain("handleKanbanDragKeydown");
    expect(DETAIL).toContain('event.key !== "Escape"');
    expect(DETAIL).toContain("kanbanDragCancelled");
    expect(DETAIL).toContain("min-w-[7rem] basis-0 flex-1 truncate");
    expect(DETAIL).not.toContain("xl:grid-cols-6");
  });

  it("permite ocultar o mostrar todas las subtareas de una vez", () => {
    expect(DETAIL).toContain("toggleAllSubtasks");
    expect(DETAIL).toContain("allSubtasksCollapsed");
    expect(DETAIL).toContain("Ocultar subtareas");
    expect(DETAIL).toContain("Mostrar subtareas");
  });

  it("separa los controles de vista y las acciones de edición en dos filas", () => {
    expect(DETAIL).toContain("data-task-view-actions");
    expect(DETAIL).toContain("data-task-edit-actions");
  });

  it("permite plegar individualmente las subtareas en Kanban", () => {
    expect(DETAIL).toContain("data-kanban-subtask-toggle");
    expect(DETAIL).toMatch(/data-kanban-subtask-toggle[\s\S]*?toggleParent\(event, task\.id\)/);
    expect(DETAIL).toContain("data-kanban-card-actions");
    expect(DETAIL).toMatch(/data-kanban-card-header[^>]*>[\s\S]*?w-full[\s\S]*?data-kanban-card-actions/);
  });

  it("mueve tarjetas Kanban sin recargar el proyecto y conserva visible la tarea", () => {
    const statusFlow = DETAIL.match(/async function updateTaskStatus[\s\S]*?\n  async function updateTaskParent/)?.[0] ?? "";
    const parentFlow = DETAIL.match(/async function updateTaskParent[\s\S]*?\n  function handleTaskDragStart/)?.[0] ?? "";
    expect(statusFlow).not.toContain("loadData(");
    expect(parentFlow).not.toContain("loadData(");
    expect(DETAIL).toContain("animateMovedTask");
    expect(DETAIL).toContain("data-kanban-task-id");
    expect(DETAIL).toContain("scrollIntoView");
    expect(DETAIL).toContain("prefers-reduced-motion");
    expect(DETAIL).toContain("element.animate");
  });

  it("carga los datos bajo demanda según la pestaña activa", () => {
    expect(DETAIL).toContain("loadSectionData(activeProjectSection, p)");
    expect(DETAIL).toContain('const needsCategories = section === "trabajo"');
    expect(DETAIL).toContain('const needsCash = section === "economia"');
    expect(DETAIL).toMatch(/project = p;[\s\S]*?loading = false;[\s\S]*?loadSectionData/);
  });

  it("mantiene compacta la descripción del proyecto hasta que se pide verla completa", () => {
    expect(DETAIL).toContain("projectDescriptionExpanded");
    expect(DETAIL).toContain('max-h-[3.25rem]');
    expect(DETAIL).toContain('"Ver menos" : "Ver más"');
    expect(DETAIL).toContain("bg-gradient-to-t");
    expect(DETAIL).toContain('class="ml-auto inline-flex');
  });

  it("no muestra estados vacíos mientras carga los datos de una pestaña", () => {
    expect(DETAIL).toContain("activeSectionDataReady");
    expect(DETAIL).toContain("data-project-section-loading");
    expect(DETAIL).toContain("ready={tasksLoaded}");
  });
});
