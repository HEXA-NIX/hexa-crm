import type { CashMovement, WorkProject } from "../types";

export type ProjectRevenueMonth = {
  month: string;
  label: string;
  income_cents: number;
  expense_cents: number;
  projection_cents: number;
  is_current: boolean;
};

function monthKey(year: number, monthIndex: number) {
  const date = new Date(year, monthIndex, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function buildProjectRevenueProjection(
  projects: WorkProject[],
  movements: CashMovement[],
  referenceDate = new Date(),
  monthsBefore = 5,
  monthsAfter = 6,
): ProjectRevenueMonth[] {
  const currentMonth = monthKey(referenceDate.getFullYear(), referenceDate.getMonth());
  const ownProjects = projects.filter(
    (project) =>
      project.customer_id == null &&
      project.status !== "archived" &&
      project.status !== "done",
  );

  return Array.from({ length: monthsBefore + monthsAfter + 1 }, (_, index) => {
    const offset = index - monthsBefore;
    const month = monthKey(referenceDate.getFullYear(), referenceDate.getMonth() + offset);
    const date = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth() + offset,
      1,
    );

    const projectionCents = ownProjects.reduce((total, project) => {
      const applicableMilestone = [...project.revenue_milestones]
        .filter((milestone) => milestone.target_month <= month)
        .sort((a, b) => b.target_month.localeCompare(a.target_month))[0];
      return total + (applicableMilestone?.amount_cents ?? 0);
    }, 0);

    const incomeCents = movements
      .filter(
        (movement) =>
          movement.project_id != null &&
          movement.kind === "income" &&
          movement.occurred_at.slice(0, 7) === month,
      )
      .reduce((total, movement) => total + movement.amount_cents, 0);

    const expenseCents = movements
      .filter(
        (movement) =>
          movement.kind === "expense" &&
          movement.occurred_at.slice(0, 7) === month,
      )
      .reduce((total, movement) => total + movement.amount_cents, 0);

    return {
      month,
      label: date.toLocaleDateString("es-ES", { month: "short" }).replace(".", ""),
      income_cents: incomeCents,
      expense_cents: expenseCents,
      projection_cents: projectionCents,
      is_current: month === currentMonth,
    };
  });
}
