import type {
  ProjectHealth,
  ProjectManagement,
  WorkItem,
  WorkProject,
} from "$lib/types";

export const EMPTY_PROJECT_MANAGEMENT: ProjectManagement = {
  lead_id: null,
  update_frequency_days: 7,
  task_estimates: {},
  updates: [],
  milestones: [],
  risks: [],
  decisions: [],
  dependencies: [],
  cycles: [],
  capacity: [],
};

export function normalizeProjectManagement(value?: Partial<ProjectManagement> | null): ProjectManagement {
  const source = value && typeof value === "object" ? value : {};
  return {
    lead_id: Number.isFinite(source.lead_id) ? Number(source.lead_id) : null,
    update_frequency_days: Number.isFinite(source.update_frequency_days)
      ? Math.max(1, Math.round(Number(source.update_frequency_days)))
      : 7,
    task_estimates: source.task_estimates && typeof source.task_estimates === "object" ? source.task_estimates : {},
    updates: Array.isArray(source.updates) ? source.updates : [],
    milestones: Array.isArray(source.milestones) ? source.milestones : [],
    risks: Array.isArray(source.risks) ? source.risks : [],
    decisions: Array.isArray(source.decisions) ? source.decisions : [],
    dependencies: Array.isArray(source.dependencies) ? source.dependencies : [],
    cycles: Array.isArray(source.cycles) ? source.cycles : [],
    capacity: Array.isArray(source.capacity) ? source.capacity : [],
  };
}
export function latestProjectUpdate(project: WorkProject) {
  return [...normalizeProjectManagement(project.management).updates]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

export function projectUpdateIsStale(project: WorkProject, now = new Date()) {
  if (project.status !== "active") return false;
  const management = normalizeProjectManagement(project.management);
  const latest = latestProjectUpdate(project);
  if (!latest) return true;
  const ageDays = (now.getTime() - new Date(latest.created_at).getTime()) / 86_400_000;
  return ageDays > management.update_frequency_days;
}

export function derivedProjectHealth(project: WorkProject, items: WorkItem[], now = new Date()): ProjectHealth {
  const latest = latestProjectUpdate(project);
  if (latest?.health === "on_hold") return "on_hold";
  const management = normalizeProjectManagement(project.management);
  const openRisk = management.risks.some((risk) => risk.status === "open" && risk.impact === "high");
  const missedMilestone = management.milestones.some((milestone) =>
    milestone.status !== "done" && Boolean(milestone.target_date) && new Date(`${milestone.target_date}T23:59:59`).getTime() < now.getTime(),
  );
  const overdue = items.some((item) => item.status !== "done" && item.status !== "archived" && Boolean(item.effective_due_date ?? item.due_date) && new Date(item.effective_due_date ?? item.due_date!).getTime() < now.getTime());
  if (missedMilestone || overdue || latest?.health === "off_track") return "off_track";
  if (openRisk || items.some((item) => item.status === "blocked") || latest?.health === "at_risk" || projectUpdateIsStale(project, now)) return "at_risk";
  return "on_track";
}

export function projectActivity(project: WorkProject, items: WorkItem[]) {
  const management = normalizeProjectManagement(project.management);
  return [
    ...management.updates.map((entry) => ({ at: entry.created_at, kind: "Actualización", title: entry.summary || "Estado actualizado" })),
    ...management.decisions.filter((entry) => entry.decided_at).map((entry) => ({ at: entry.decided_at!, kind: "Decisión", title: entry.title })),
    ...items.map((entry) => ({ at: entry.updated_at, kind: entry.status === "done" ? "Completada" : "Tarea", title: entry.title })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}
