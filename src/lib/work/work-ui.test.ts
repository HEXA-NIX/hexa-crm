import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORK_PAGE = readFileSync(resolve(__dirname, "../../routes/trabajo/+page.svelte"), "utf8");

describe("Trabajo UI", () => {
  it("selecciona al usuario conectado como filtro inicial de responsable", () => {
    expect(WORK_PAGE).toContain("assigneeFilterInitializedCompanyId");
    expect(WORK_PAGE).toContain("filterAssignee = $currentUser?.id");
    expect(WORK_PAGE).toContain("String($currentUser.id)");
  });

  it("asigna al usuario conectado al crear una tarea", () => {
    expect(WORK_PAGE).toContain("assignee_id: $currentUser?.id ?? null");
    expect(WORK_PAGE).toContain('assignee_id: $currentUser?.id ? String($currentUser.id) : ""');
  });
});
