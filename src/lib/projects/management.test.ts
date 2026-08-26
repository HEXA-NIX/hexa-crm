import { describe, expect, it } from "vitest";
import type { WorkItem, WorkProject } from "$lib/types";
import { derivedProjectHealth, normalizeProjectManagement, projectActivity, projectUpdateIsStale } from "./management";

const project = (management: WorkProject["management"] = {} as WorkProject["management"]): WorkProject => ({
  id: 1, uid: "p1", company_id: 1, customer_id: null, value_cents: 0, monthly_estimate_cents: 0,
  revenue_target_date: null, revenue_milestones: [], documents: [], name: "Centro", description: "",
  status: "active", start_date: null, target_date: null, created_by: 1,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", management,
});
const task = (patch: Partial<WorkItem> = {}): WorkItem => ({
  id: 1, company_id: 1, parent_id: null, category_id: null, project_id: 1, assignee_id: null,
  created_by: 1, title: "Entrega", description: "", type: "task", status: "planned", priority: "normal",
  start_date: null, due_date: null, sort_order: 0, source_type: null, source_key: null, source_href: null,
  completed_at: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", ...patch,
});

describe("centro de gestión de proyectos", () => {
  it("normaliza proyectos antiguos sin perder compatibilidad", () => {
    const management = normalizeProjectManagement(null);
    expect(management.update_frequency_days).toBe(7);
    expect(management.updates).toEqual([]);
    expect(management.capacity).toEqual([]);
    expect(management.grants).toEqual([]);
  });

  it("normaliza importes y condiciones de subvenciones antiguas", () => {
    const management = normalizeProjectManagement({ grants: [{ id:"g1", name:"Kit", authority:"", managing_company:"Gestora", management_fee_percent:10, status:"awarded", funding_type:"repayable", requested_cents:1000, awarded_cents:800, received_cents:0, repayable_cents:800, application_date:null, resolution_date:null, repayment_date:null, reference:"", notes:"" }] });
    expect(management.grants[0]).toMatchObject({ status:"awarded", funding_type:"repayable", awarded_cents:800, repayable_cents:800, managing_company:"Gestora", management_fee_percent:10 });
  });

  it("marca en riesgo un proyecto activo sin actualización periódica", () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    expect(projectUpdateIsStale(project(), now)).toBe(true);
    expect(derivedProjectHealth(project(), [], now)).toBe("at_risk");
  });

  it("prioriza una tarea vencida como proyecto desviado", () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    expect(derivedProjectHealth(project(), [task({ due_date: "2026-08-01T00:00:00.000Z" })], now)).toBe("off_track");
  });

  it("combina actualizaciones, decisiones y tareas en la actividad", () => {
    const managed = project(normalizeProjectManagement({
      updates: [{ id: "u1", health: "on_track", summary: "Avance", achievements: "", blockers: "", next_steps: "", decisions_needed: "", author: "Ana", created_at: "2026-08-10T00:00:00.000Z" }],
      decisions: [{ id: "d1", title: "Lanzar", context: "", decision: "Sí", owner_id: 1, due_date: null, status: "decided", decided_at: "2026-08-11T00:00:00.000Z" }],
    }));
    expect(projectActivity(managed, [task({ updated_at: "2026-08-12T00:00:00.000Z" })]).map((entry) => entry.kind)).toEqual(["Tarea", "Decisión", "Actualización"]);
  });
});
