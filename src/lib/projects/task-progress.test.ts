import { describe, expect, it } from "vitest";
import { calculateTaskProgress } from "./task-progress";

describe("calculateTaskProgress", () => {
  it("excluye las tareas archivadas del total y del porcentaje", () => {
    expect(calculateTaskProgress([
      { status: "done" },
      { status: "in_progress" },
      { status: "archived" },
    ])).toEqual({ total: 2, completed: 1, progress: 50 });
  });

  it("devuelve progreso cero cuando solo hay tareas archivadas", () => {
    expect(calculateTaskProgress([
      { status: "archived" },
      { status: "archived" },
    ])).toEqual({ total: 0, completed: 0, progress: 0 });
  });
});
