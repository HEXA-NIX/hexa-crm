import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DASHBOARD = readFileSync(resolve(__dirname, "../../routes/+page.svelte"), "utf8");

describe("dashboard de proyectos", () => {
  it("calcula los ingresos realizados con facturas emitidas y subvenciones", () => {
    expect(DASHBOARD).toContain("activeCompanyFinancialSummary?.issued_total_cents ?? 0");
    expect(DASHBOARD).toContain('movement.category === "subvencion_cobrada"');
    expect(DASHBOARD).toContain("+ collectedGrantCents");
    expect(DASHBOARD).toContain("company.issued_total_cents + company.grant_income_cents");
  });
});
