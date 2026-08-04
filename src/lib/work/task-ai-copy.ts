import type { WorkItem, WorkProject } from "$lib/types";

function itemBlock(item: WorkItem, heading: string): string[] {
  const lines = [heading, `Estado: ${item.status}`, `Prioridad: ${item.priority}`];
  if (item.description.trim()) lines.push("", item.description.trim());
  return lines;
}

/** Produces a self-contained Markdown brief suitable for pasting into an AI. */
export function formatTaskForAi(
  task: WorkItem,
  subtasks: WorkItem[],
  project?: Pick<WorkProject, "name" | "description"> | null,
): string {
  const lines = [`# Tarea: ${task.title}`];
  if (project?.name) lines.push("", `Proyecto: ${project.name}`);
  lines.push("", ...itemBlock(task, "## Contexto de la tarea"));

  if (subtasks.length > 0) {
    lines.push("", "## Subtareas");
    for (const subtask of subtasks) {
      const checked = subtask.status === "done" ? "x" : " ";
      lines.push(`- [${checked}] ${subtask.title} — Estado: ${subtask.status}; prioridad: ${subtask.priority}`);
      if (subtask.description.trim()) {
        for (const descriptionLine of subtask.description.trim().split(/\r?\n/)) {
          lines.push(`  ${descriptionLine}`);
        }
      }
    }
  }

  lines.push(
    "",
    "## Instrucción para la IA",
    "Completa esta tarea y todas las subtareas pendientes. Usa la información anterior como requisitos, conserva lo que ya esté completado y explica claramente el resultado final y cualquier punto que necesite validación humana.",
  );
  return lines.join("\n");
}
