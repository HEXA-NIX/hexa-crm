import { describe, expect, it } from "vitest";
import { buildTaskDigestMessages, upcomingTasksForDigest } from "./task-digest";
import type { WorkItem, WorkProject } from "$lib/types";

const task = (id: number, title: string, due: string): WorkItem => ({
  id, company_id: 1, parent_id: null, category_id: null, project_id: null, assignee_id: null,
  created_by: 1, title, description: "", type: "task", status: "planned", priority: "normal",
  start_date: null, due_date: due, sort_order: 0, source_type: null, source_key: null,
  source_href: null, completed_at: null, created_at: "2026-08-01", updated_at: "2026-08-01",
});

describe("resumen de tareas por WhatsApp", () => {
  it("incluye vencidas y próximos siete días, pero no fechas posteriores", () => {
    const withoutDate = { ...task(4, "Sin fecha", "2026-08-06"), due_date: null };
    const invalidDate = { ...task(5, "Fecha inválida", "2026-08-06"), due_date: " " };
    const result = upcomingTasksForDigest([
      task(1, "Vencida", "2026-08-04"), task(2, "Próxima", "2026-08-10"), task(3, "Lejana", "2026-08-20"),
      withoutDate, invalidDate,
    ], new Date("2026-08-05T12:00:00"));
    expect(result.map((item) => item.title)).toEqual(["Vencida", "Próxima"]);
  });

  it("resume por proyecto sin enumerar todos los títulos y enlaza a pendientes", () => {
    const project = { id: 7, uid: "proyecto-uid", name: "Web corporativa" } as WorkProject;
    const tasks = Array.from({ length: 64 }, (_, i) => ({ ...task(i, `Tarea ${i}`, "2026-08-08"), project_id: 7 }));
    tasks[0].status = "done";
    tasks[0].completed_at = "2026-08-04";
    const messages = buildTaskDigestMessages(tasks, [project], new Date("2026-08-05"), "https://crm.example.com");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Web corporativa");
    expect(messages[0]).toContain("1/64 tareas");
    expect(messages[0]).not.toContain("Tarea 63");
    expect(messages[0]).toContain("https://crm.example.com/proyectos/proyecto-uid?estado=pendientes");
  });
});
