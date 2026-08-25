import { describe, expect, it } from "vitest";
import type { ProjectCycle, WorkItem } from "$lib/types";
import { currentSprint, pokerPending, sprintMetrics, sprintTasks, taskReadiness } from "./sprints";

const task = (id: number, patch: Partial<WorkItem> = {}): WorkItem => ({ id, company_id: 1, parent_id: null, category_id: null, project_id: 1, assignee_id: 1, created_by: 1, title: `T${id}`, description: "Contexto y criterios", type: "task", status: "planned", priority: "normal", start_date: null, due_date: "2026-09-01", sort_order: 0, source_type: null, source_key: null, source_href: null, completed_at: null, created_at: "", updated_at: "", ...patch });
const cycle = (patch: Partial<ProjectCycle> = {}): ProjectCycle => ({ id: "s1", name: "Sprint 1", goal: "Entregar", start_date: "2026-08-25", end_date: "2026-09-07", capacity_points: 8, status: "planned", stage: "refinement", task_ids: [1], poker_points: { "1": 5 }, ...patch });

describe("sprints de proyecto", () => {
  it("incluye subtareas de las tareas comprometidas", () => expect(sprintTasks(cycle(), [task(1), task(2, { parent_id: 1 })]).map((item) => item.id)).toEqual([1, 2]));
  it("prioriza el sprint activo", () => expect(currentSprint([cycle(), cycle({ id: "s2", status: "active", stage: "active" })])?.id).toBe("s2"));
  it("calcula progreso y puntos completados", () => expect(sprintMetrics(cycle(), [task(1, { status: "done" })])).toMatchObject({ total: 1, completed: 1, points: 5, completedPoints: 5, progress: 100 }));
  it("detecta poker y refinamiento pendientes", () => { expect(pokerPending(cycle({ poker_points: {} }))).toEqual([1]); expect(taskReadiness(task(1, { description: "" })).ready).toBe(false); });
});
