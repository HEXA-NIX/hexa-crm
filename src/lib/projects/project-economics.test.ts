import { describe, expect, it } from "vitest";
import type { CashMovement, WorkProject } from "../types";
import { buildProjectEconomicSeries } from "./project-economics";

const baseProject: WorkProject = {
  id: 1, uid: "p", company_id: 1, customer_id: 2, value_cents: 120_000,
  monthly_estimate_cents: 0, revenue_target_date: null, revenue_milestones: [],
  documents: [],
  name: "Proyecto", description: "", status: "active", start_date: "2026-01-01",
  target_date: "2026-03-31", created_by: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};

const income = (amount_cents: number, occurred_at: string): CashMovement => ({
  id: amount_cents, project_id: 1, kind: "income", amount_cents, category: "facturacion_proyecto",
  description: "", sale_id: null, occurred_at,
});

describe("project economic series", () => {
  it("compares a linear contracted target with cumulative billing", () => {
    const series = buildProjectEconomicSeries(baseProject, [income(30_000, "2026-02-10T10:00:00Z")], new Date(2026, 2, 1));
    expect(series.map((point) => point.planned_cents)).toEqual([40_000, 80_000, 120_000]);
    expect(series.map((point) => point.billed_cents)).toEqual([0, 30_000, 30_000]);
  });

  it("keeps the full planned value after the target month", () => {
    const series = buildProjectEconomicSeries(baseProject, [], new Date(2026, 4, 1));
    expect(series.map((point) => point.planned_cents)).toEqual([40_000, 80_000, 120_000, 120_000, 120_000]);
  });

  it("uses accumulated milestones as the plan for own projects", () => {
    const series = buildProjectEconomicSeries({
      ...baseProject,
      customer_id: null,
      value_cents: 0,
      revenue_milestones: [
        { id: 1, target_month: "2026-01", amount_cents: 50_000 },
        { id: 2, target_month: "2026-03", amount_cents: 70_000 },
      ],
    }, [], new Date(2026, 2, 1));
    expect(series.map((point) => point.planned_cents)).toEqual([50_000, 50_000, 120_000]);
  });
});
