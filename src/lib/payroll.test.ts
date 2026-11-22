import { describe, expect, it } from "vitest";
import { payrollTotals } from "./payroll";

describe("payrollTotals", () => {
  it("calcula el neto y coste empresarial con céntimos enteros", () => {
    expect(payrollTotals({
      gross_cents: 250_000,
      employee_ss_cents: 16_250,
      irpf_cents: 37_500,
      other_deductions_cents: 1_000,
      employer_ss_cents: 78_000,
    })).toEqual({ net_cents: 195_250, total_cost_cents: 328_000 });
  });

  it("no permite importes negativos ni un neto negativo", () => {
    expect(payrollTotals({
      gross_cents: 10_000,
      employee_ss_cents: 20_000,
      irpf_cents: -100,
      other_deductions_cents: 0,
      employer_ss_cents: -1,
    })).toEqual({ net_cents: 0, total_cost_cents: 10_000 });
  });
});
