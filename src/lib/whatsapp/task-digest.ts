import type { WorkItem, WorkProject } from "$lib/types";
import { isTaskPendingWork } from "$lib/work/task-dates";

function validDay(value: string | null | undefined): number | null {
  const raw = typeof value === "string" ? value.trim().slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const result = new Date(`${raw}T00:00:00`).getTime();
  return Number.isFinite(result) ? result : null;
}

export function upcomingTasksForDigest(tasks: WorkItem[], now = new Date(), days = 7): WorkItem[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + days * 86_400_000;
  return tasks
    .filter(isTaskPendingWork)
    .filter((task) => {
      const due = validDay(task.due_date);
      return due !== null && due <= end;
    })
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)) || a.title.localeCompare(b.title, "es"));
}

export function buildTaskDigestMessages(tasks: WorkItem[], projects: WorkProject[], generatedAt = new Date(), appUrl = ""): string[] {
  const today = new Date(generatedAt.getFullYear(), generatedAt.getMonth(), generatedAt.getDate()).getTime();
  const weekAgo = today - 7 * 86_400_000;
  const dueSoon = upcomingTasksForDigest(tasks, generatedAt);
  const projectIds = [...new Set(dueSoon.map((task) => task.project_id).filter((id): id is number => id != null))];
  const baseUrl = appUrl.replace(/\/$/, "");
  const blocks = projectIds.map((projectId) => {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return "";
    const projectTasks = tasks.filter((task) => task.project_id === projectId && task.status !== "archived");
    const completed = projectTasks.filter((task) => task.status === "done").length;
    const percent = projectTasks.length ? Math.round((completed / projectTasks.length) * 100) : 0;
    const recentCompleted = projectTasks.filter((task) => {
      if (task.status !== "done") return false;
      const completedAt = new Date(task.completed_at || task.updated_at).getTime();
      return Number.isFinite(completedAt) && completedAt >= weekAgo;
    }).length;
    const actionable = dueSoon.filter((task) => task.project_id === projectId);
    const overdue = actionable.filter((task) => (validDay(task.due_date) ?? today) < today).length;
    const link = baseUrl ? `${baseUrl}/proyectos/${project.uid}?estado=pendientes` : "";
    return [
      `📁 *${project.name}*`,
      `▰ ${percent}% completado · ${completed}/${projectTasks.length} tareas`,
      `✅ ${recentCompleted} terminadas en los últimos 7 días`,
      `📅 ${actionable.length} pendientes con vencimiento próximo${overdue ? ` · ⚠️ ${overdue} vencidas` : ""}`,
      link ? `🔗 Ver tareas pendientes: ${link}` : "",
    ].filter(Boolean).join("\n");
  }).filter(Boolean);

  const unassigned = dueSoon.filter((task) => task.project_id == null).length;
  if (unassigned) blocks.push(`📥 *Sin proyecto*\n📅 ${unassigned} tareas pendientes con vencimiento próximo${baseUrl ? `\n🔗 Ver pendientes: ${baseUrl}/trabajo` : ""}`);
  const header = `✨ *Resumen semanal · Hexa CRM*\n${generatedAt.toLocaleDateString("es-ES")}\n`;
  if (!blocks.length) return [`${header}\n✅ Todo al día: no hay tareas vencidas ni previstas para los próximos 7 días.`];
  return [`${header}\n${blocks.join("\n\n")}`];
}
