import { describe, expect, it } from "vitest";
import type { WorkItem } from "$lib/types";
import { formatTaskForAi } from "./task-ai-copy";

function item(partial: Partial<WorkItem>): WorkItem {
  return {
    id: 1, company_id: 1, parent_id: null, category_id: null, project_id: 1,
    assignee_id: null, created_by: 1, title: "Tarea", description: "",
    type: "task", status: "inbox", priority: "normal", start_date: null,
    due_date: null, sort_order: 0, source_type: null, source_key: null,
    source_href: null, completed_at: null, created_at: "", updated_at: "",
    ...partial,
  };
}

describe("formatTaskForAi", () => {
  it("includes task context, descriptions and subtask completion state", () => {
    const text = formatTaskForAi(
      item({ title: "Publicar tienda", description: "Preparar la salida.", priority: "high" }),
      [
        item({ id: 2, parent_id: 1, title: "Revisar catálogo", status: "done" }),
        item({ id: 3, parent_id: 1, title: "Configurar TPV", description: "Probar una venta." }),
      ],
      { name: "Apertura", description: "" },
    );

    expect(text).toContain("# Tarea: Publicar tienda");
    expect(text).toContain("Proyecto: Apertura");
    expect(text).toContain("Preparar la salida.");
    expect(text).toContain("- [x] Revisar catálogo");
    expect(text).toContain("- [ ] Configurar TPV");
    expect(text).toContain("  Probar una venta.");
    expect(text).toContain("Completa esta tarea y todas las subtareas pendientes");
  });
});
