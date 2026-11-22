import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DASHBOARD = readFileSync(resolve(__dirname, "../../routes/+page.svelte"), "utf8");

describe("dashboard de proyectos", () => {
  it("separa facturación, cobros, subvenciones y financiación", () => {
    expect(DASHBOARD).toContain("activeCompanyFinancialSummary?.issued_total_cents ?? 0");
    expect(DASHBOARD).toContain('movement.category === "subvencion_cobrada"');
    expect(DASHBOARD).toContain("collectedAndGrantedCents");
    expect(DASHBOARD).toContain("availableCashCents");
    expect(DASHBOARD).toContain('label="Facturado"');
    expect(DASHBOARD).toContain('label="Cobrado y ayudas"');
    expect(DASHBOARD).toContain('label="Financiación recibida"');
    expect(DASHBOARD).not.toContain('label="Margen realizado"');
  });
});
