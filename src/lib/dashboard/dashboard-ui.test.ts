import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DASHBOARD = readFileSync(resolve(__dirname, "../../routes/+page.svelte"), "utf8");

describe("dashboard de proyectos", () => {
  it("calcula Facturado con las facturas emitidas de la empresa activa", () => {
    expect(DASHBOARD).toContain("activeCompanyFinancialSummary?.issued_total_cents ?? 0");
    expect(DASHBOARD).toContain("activeCompanyFinancialSummary?.issued_paid_cents ?? 0");
    expect(DASHBOARD).not.toMatch(/const billedProjectCents = \$derived\([\s\S]*?devCashMovements[\s\S]*?movement\.kind === "income"/);
  });
});
