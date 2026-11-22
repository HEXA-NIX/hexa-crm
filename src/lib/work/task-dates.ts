import type { WorkItem } from "$lib/types";

type TaskWithEffectiveDueDate = Pick<WorkItem, "due_date" | "effective_due_date">;

export function taskDueDate(task: TaskWithEffectiveDueDate): string | null {
  return task.due_date ?? task.effective_due_date ?? null;
}

export function taskAssigneeId(task: Pick<WorkItem, "assignee_id" | "effective_assignee_id">): number | null {
  return task.assignee_id ?? task.effective_assignee_id ?? null;
}

function dueTime(task: TaskWithEffectiveDueDate): number {
  const dueDate = taskDueDate(task);
  if (!dueDate) return Number.POSITIVE_INFINITY;
  const value = new Date(`${dueDate.slice(0, 10)}T00:00:00`).getTime();
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function isTaskOverdue(task: Pick<WorkItem, "due_date" | "effective_due_date" | "status">, now = new Date()): boolean {
  if (!taskDueDate(task) || !isTaskPendingWork(task)) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return dueTime(task) < today;
}

export function isTaskPendingWork(task: Pick<WorkItem, "status">): boolean {
  return !["validation", "done", "archived"].includes(task.status);
}

export function isTaskDueSoon(task: Pick<WorkItem, "due_date" | "effective_due_date" | "status">, now = new Date(), days = 7): boolean {
  if (!taskDueDate(task) || !isTaskPendingWork(task)) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = dueTime(task);
  return due >= today && due <= today + days * 86_400_000;
}

export function sortTasksByDueDate<T extends Pick<WorkItem, "due_date" | "effective_due_date" | "sort_order" | "title">>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) =>
    dueTime(a) - dueTime(b) || a.sort_order - b.sort_order || a.title.localeCompare(b.title, "es"),
  );
}
