import type { WorkItem } from "$lib/types";

function dueTime(task: Pick<WorkItem, "due_date">): number {
  if (!task.due_date) return Number.POSITIVE_INFINITY;
  const value = new Date(`${task.due_date.slice(0, 10)}T00:00:00`).getTime();
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function isTaskOverdue(task: Pick<WorkItem, "due_date" | "status">, now = new Date()): boolean {
  if (!task.due_date || !isTaskPendingWork(task)) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return dueTime(task) < today;
}

export function isTaskPendingWork(task: Pick<WorkItem, "status">): boolean {
  return !["validation", "done", "archived"].includes(task.status);
}

export function isTaskDueSoon(task: Pick<WorkItem, "due_date" | "status">, now = new Date(), days = 7): boolean {
  if (!task.due_date || !isTaskPendingWork(task)) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = dueTime(task);
  return due >= today && due <= today + days * 86_400_000;
}

export function sortTasksByDueDate<T extends Pick<WorkItem, "due_date" | "sort_order" | "title">>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) =>
    dueTime(a) - dueTime(b) || a.sort_order - b.sort_order || a.title.localeCompare(b.title, "es"),
  );
}
