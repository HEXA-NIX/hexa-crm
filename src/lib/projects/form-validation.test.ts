import { describe, expect, it } from "vitest";
import { hasInvalidDateRange, hasInvalidMoneyInput } from "./form-validation";

describe("validación de formularios de proyectos", () => {
  it("rechaza una fecha final anterior a la inicial", () => {
    expect(hasInvalidDateRange("2026-08-10", "2026-08-09")).toBe(true);
    expect(hasInvalidDateRange("2026-08-10", "2026-08-10")).toBe(false);
    expect(hasInvalidDateRange("", "2026-08-10")).toBe(false);
  });

  it("distingue importes vacíos, válidos e inválidos", () => {
    expect(hasInvalidMoneyInput("")).toBe(false);
    expect(hasInvalidMoneyInput("1250,50")).toBe(false);
    expect(hasInvalidMoneyInput("importe")).toBe(true);
    expect(hasInvalidMoneyInput("-1")).toBe(true);
  });
});
