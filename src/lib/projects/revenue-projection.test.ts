import { describe, expect, it } from "vitest";
import type { CashMovement, WorkProject } from "../types";
import { buildProjectRevenueProjection } from "./revenue-projection";

const project = (overrides: Partial<WorkProject>): WorkProject => ({
  id: 1,
  uid: "project-uid",
  company_id: 1,
  customer_id: null,
  value_cents: 0,
  monthly_estimate_cents: 0,
  revenue_target_date: null,
  revenue_milestones: [],
  documents: [],
  name: "Proyecto propio",
  description: "",
  status: "active",
  start_date: null,
  target_date: null,
  created_by: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("project revenue projection", () => {
  it("carries a milestone forward until the next milestone replaces it", () => {
    const series = buildProjectRevenueProjection(
      [
        project({
          revenue_milestones: [
            { id: 1, target_month: "2026-06", amount_cents: 100_000 },
            { id: 2, target_month: "2026-09", amount_cents: 250_000 },
          ],
        }),
      ],
      [],
      new Date(2026, 7, 15),
      2,
      2,
    );

    expect(series.map((month) => month.projection_cents)).toEqual([
      100_000,
      100_000,
      100_000,
      250_000,
      250_000,
    ]);
  });

  it("sums own projects and keeps client projects out of the projection", () => {
    const series = buildProjectRevenueProjection(
      [
        project({
          id: 1,
          revenue_milestones: [{ id: 1, target_month: "2026-07", amount_cents: 80_000 }],
        }),
        project({
          id: 2,
          revenue_milestones: [{ id: 2, target_month: "2026-08", amount_cents: 20_000 }],
        }),
        project({
          id: 3,
          customer_id: 12,
          revenue_milestones: [{ id: 3, target_month: "2026-07", amount_cents: 999_000 }],
        }),
      ],
      [],
      new Date(2026, 7, 15),
      0,
      0,
    );

    expect(series[0].projection_cents).toBe(100_000);
  });

  it("groups actual project income by month", () => {
    const movements: CashMovement[] = [
      {
        id: 1,
        project_id: 8,
        kind: "income",
        amount_cents: 125_000,
        category: "facturacion_proyecto",
        description: "",
        sale_id: null,
        occurred_at: "2026-08-03T10:00:00.000Z",
      },
      {
        id: 2,
        project_id: 8,
        kind: "expense",
        amount_cents: 50_000,
        category: "gasto_proyecto",
        description: "",
        sale_id: null,
        occurred_at: "2026-08-04T10:00:00.000Z",
      },
    ];

    const series = buildProjectRevenueProjection(
      [],
      movements,
      new Date(2026, 7, 15),
      0,
      0,
    );

    expect(series[0].income_cents).toBe(125_000);
    expect(series[0].expense_cents).toBe(50_000);
  });
});
