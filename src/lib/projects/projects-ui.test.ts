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
    expect(DETAIL).toContain("Convertir en tarea");
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

  it("dispone de una vista explícita para archivadas y Kanban móvil", () => {
    expect(DETAIL).toContain('filterStatus === "archived"');
    expect(DETAIL).toContain("overflow-x-auto");
    expect(DETAIL).toContain("pantalla táctil");
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
});
