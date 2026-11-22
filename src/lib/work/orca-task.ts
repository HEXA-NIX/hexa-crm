import type { WorkItem, WorkItemInput, WorkProject } from "$lib/types";
import { formatTaskForAi } from "./task-ai-copy";

export const ORCA_SOURCE = {
  queued: "orca_queued",
  running: "orca_running",
  completed: "orca_completed",
  failed: "orca_failed",
} as const;

export type OrcaExecutionState = keyof typeof ORCA_SOURCE | "none";

export function orcaExecutionState(task: Pick<WorkItem, "source_type">): OrcaExecutionState {
  const entry = Object.entries(ORCA_SOURCE).find(([, value]) => value === task.source_type);
  return (entry?.[0] as OrcaExecutionState | undefined) ?? "none";
}

export function orcaExecutionLabel(task: Pick<WorkItem, "source_type">): string | null {
  switch (orcaExecutionState(task)) {
    case "queued": return "Orca · En cola";
    case "running": return "Orca · Trabajando";
    case "completed": return "Orca · Completada";
    case "failed": return "Orca · Bloqueada";
    default: return null;
  }
}

export function canDispatchToOrca(task: Pick<WorkItem, "parent_id" | "status" | "source_type">) {
  const state = orcaExecutionState(task);
  return task.parent_id == null && !["done", "archived"].includes(task.status) && !["queued", "running"].includes(state);
}

export function workItemUpdateInput(task: WorkItem, overrides: Partial<WorkItemInput> = {}): WorkItemInput {
  return {
    id: task.id,
    parent_id: task.parent_id,
    title: task.title,
    description: task.description,
    type: task.type,
    status: task.status,
    priority: task.priority,
    category_id: task.category_id,
    project_id: task.project_id,
    assignee_id: task.assignee_id,
    start_date: task.start_date,
    due_date: task.due_date,
    sort_order: task.sort_order,
    source_type: task.source_type,
    source_key: task.source_key,
    source_href: task.source_href,
    ...overrides,
  };
}

export function formatTaskForOrca(
  task: WorkItem,
  subtasks: WorkItem[],
  project?: Pick<WorkProject, "name" | "description"> | null,
) {
  return [
    formatTaskForAi(task, subtasks, project),
    "",
    "## Flujo de entrega obligatorio",
    "Trabaja de forma autónoma en el worktree asignado por Orca.",
    "Respeta AGENTS.md y parte de la rama dev.",
    "Implementa únicamente el alcance descrito, ejecuta los tests y el build relevantes y corrige cualquier fallo causado por tus cambios.",
    "Cuando todo esté verificado, crea un commit con un mensaje completo en español. No hagas push ni merge a dev o main.",
    "Si existe un bloqueo real, no marques el trabajo como terminado: explica el bloqueo claramente en tu respuesta final.",
  ].join("\n");
}
