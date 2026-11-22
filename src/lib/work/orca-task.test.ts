import { describe, expect, it } from "vitest";
import type { WorkItem } from "$lib/types";
import { canDispatchToOrca, formatTaskForOrca, orcaExecutionLabel, workItemUpdateInput } from "./orca-task";

const task = {
  id: 7,
  company_id: 1,
  parent_id: null,
  category_id: null,
  project_id: 2,
  assignee_id: null,
  created_by: 1,
  title: "Preparar informe",
  description: "Con criterios verificables",
  type: "task",
  status: "planned",
  priority: "normal",
  start_date: null,
  due_date: null,
  sort_order: 0,
  source_type: null,
  source_key: null,
  source_href: null,
  completed_at: null,
  created_at: "2026-08-03T00:00:00.000Z",
  updated_at: "2026-08-03T00:00:00.000Z",
} satisfies WorkItem;

describe("integración de tareas con Orca", () => {
  it("solo permite despachar tareas principales abiertas y no activas en Orca", () => {
    expect(canDispatchToOrca(task)).toBe(true);
    expect(canDispatchToOrca({ ...task, parent_id: 3 })).toBe(false);
    expect(canDispatchToOrca({ ...task, status: "done" })).toBe(false);
    expect(canDispatchToOrca({ ...task, source_type: "orca_running" })).toBe(false);
  });

  it("mantiene los campos de la tarea al actualizar metadatos de ejecución", () => {
    expect(workItemUpdateInput(task, { source_type: "orca_queued", source_key: "run-1" })).toMatchObject({
      id: 7,
      title: "Preparar informe",
      project_id: 2,
      source_type: "orca_queued",
      source_key: "run-1",
    });
  });

  it("genera un encargo verificable y etiquetas legibles", () => {
    expect(formatTaskForOrca(task, [], { name: "Hexa", description: "" })).toContain("crea un commit");
    expect(orcaExecutionLabel({ source_type: "orca_queued" })).toBe("Orca · En cola");
  });
});
