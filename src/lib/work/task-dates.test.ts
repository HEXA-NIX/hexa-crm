import { describe, expect, it } from "vitest";
import { isTaskDueSoon, isTaskOverdue, sortTasksByDueDate } from "./task-dates";

const task = (title: string, due_date: string | null, status = "planned") => ({ title, due_date, status, sort_order: 0 });

describe("fechas de tareas", () => {
  it("ordena por vencimiento y deja las tareas sin fecha al final", () => {
    expect(sortTasksByDueDate([task("Sin fecha", null), task("Lejana", "2026-08-20"), task("Próxima", "2026-08-08")]).map((item) => item.title))
      .toEqual(["Próxima", "Lejana", "Sin fecha"]);
  });

  it("detecta entregas dentro de los próximos siete días", () => {
    expect(isTaskDueSoon(task("Próxima", "2026-08-12") as never, new Date("2026-08-06"))).toBe(true);
    expect(isTaskDueSoon(task("Lejana", "2026-08-20") as never, new Date("2026-08-06"))).toBe(false);
    expect(isTaskDueSoon(task("Validando", "2026-08-08", "validation") as never, new Date("2026-08-06"))).toBe(false);
  });

  it("solo marca vencidas las tareas todavía abiertas", () => {
    expect(isTaskOverdue(task("Abierta", "2026-08-01") as never, new Date("2026-08-06"))).toBe(true);
    expect(isTaskOverdue(task("Hecha", "2026-08-01", "done") as never, new Date("2026-08-06"))).toBe(false);
    expect(isTaskOverdue(task("Entregada", "2026-08-01", "validation") as never, new Date("2026-08-06"))).toBe(false);
  });
});
