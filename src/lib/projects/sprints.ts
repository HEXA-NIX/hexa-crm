import type { ProjectCycle, WorkItem } from "$lib/types";

export type SprintStage = NonNullable<ProjectCycle["stage"]>;

export const SPRINT_STAGES: SprintStage[] = ["refinement", "poker", "planning", "active", "review", "retrospective", "completed"];

export function sprintStageLabel(stage: SprintStage) {
  return ({ refinement: "Refinamiento", poker: "Sprint Poker", planning: "Planificación", active: "En ejecución", review: "Revisión", retrospective: "Retrospectiva", completed: "Cerrado" })[stage];
}

export function currentSprint(cycles: ProjectCycle[]) {
  return cycles.find((cycle) => cycle.status === "active")
    ?? cycles.find((cycle) => cycle.status === "planned" && cycle.stage !== "completed")
    ?? null;
}

export function sprintTasks(cycle: ProjectCycle | null, tasks: WorkItem[]) {
  if (!cycle) return [];
  const ids = new Set(cycle.task_ids ?? []);
  return tasks.filter((task) => ids.has(task.id) || (task.parent_id != null && ids.has(task.parent_id)));
}

export function taskReadiness(task: WorkItem) {
  const missing: string[] = [];
  if (!task.description.trim()) missing.push("descripción/contexto");
  if (!task.assignee_id && !task.effective_assignee_id) missing.push("responsable");
  if (!task.due_date && !task.effective_due_date) missing.push("fecha");
  return { ready: missing.length === 0, missing };
}

export function sprintMetrics(cycle: ProjectCycle, tasks: WorkItem[]) {
  const selected = sprintTasks(cycle, tasks);
  const roots = selected.filter((task) => (cycle.task_ids ?? []).includes(task.id));
  const completed = roots.filter((task) => task.status === "done").length;
  const points = roots.reduce((sum, task) => sum + (cycle.poker_points?.[String(task.id)] ?? 0), 0);
  const completedPoints = roots.filter((task) => task.status === "done").reduce((sum, task) => sum + (cycle.poker_points?.[String(task.id)] ?? 0), 0);
  const aiTasks = roots.filter((task) => ["ai", "hybrid"].includes(cycle.execution_modes?.[String(task.id)] ?? "human")).length;
  return { total: roots.length, completed, points, completedPoints, aiTasks, progress: roots.length ? Math.round(completed / roots.length * 100) : 0 };
}

export function pokerPending(cycle: ProjectCycle) {
  return (cycle.task_ids ?? []).filter((id) => !((cycle.poker_points?.[String(id)] ?? 0) > 0));
}

export function suggestAiEstimate(task: WorkItem, childCount = 0) {
  let points = task.priority === "urgent" ? 8 : task.priority === "high" ? 5 : 3;
  if (task.description.length > 500) points += 2;
  if (childCount > 2) points += 2;
  points = [1, 2, 3, 5, 8, 13, 21].find((value) => value >= points) ?? 21;
  const confidence = task.description.length > 120 ? (childCount ? "high" : "medium") : "low";
  return { points, confidence: confidence as "low" | "medium" | "high", rationale: confidence === "low" ? "Falta contexto detallado; conviene refinar antes de comprometer." : "Estimación basada en prioridad, contexto y desglose disponible." };
}
