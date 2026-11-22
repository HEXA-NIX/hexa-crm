import { describe, expect, it } from "vitest";
import { deriveTaxModels, normalizeTaxSetup } from "./models";

const completed = (overrides: Record<string, unknown> = {}) => ({
  entity_type: "autonomo" as const,
  regime: "general" as const,
  period: "quarterly" as const,
  sii_enabled: false,
  profile_completed: true,
  tax_setup: normalizeTaxSetup({ vat_registered: true, vat_activity: "taxable", annual_vat_summary: true, ...overrides } as never),
});

describe("deriveTaxModels", () => {
  it("does not invent models before the questionnaire is complete", () => {
    expect(deriveTaxModels({ ...completed(), profile_completed: false })).toEqual([]);
  });

  it("distinguishes direct estimation from modules for an autónomo", () => {
    expect(deriveTaxModels(completed({ income_regime: "direct_estimation" })).map((model) => model.code)).toEqual(["303", "390", "130"]);
    expect(deriveTaxModels(completed({ income_regime: "objective_estimation" })).map((model) => model.code)).toEqual(["303", "390", "131"]);
  });

  it("adds withholding, EU and annual declarations only when answered", () => {
    const codes = deriveTaxModels(completed({
      income_regime: "direct_estimation",
      has_employees: true,
      withholds_employees: true,
      withholds_rent: true,
      intra_community_operations: true,
      third_party_operations: true,
    })).map((model) => model.code);
    expect(codes).toEqual(["303", "390", "130", "111", "190", "115", "180", "349", "347"]);
  });

  it("does not infer payroll withholding from headcount alone", () => {
    const codes = deriveTaxModels(completed({ has_employees: true })).map((model) => model.code);
    expect(codes).not.toContain("111");
    expect(codes).not.toContain("190");
  });

  it("does not include annual VAT summary with SII", () => {
    const codes = deriveTaxModels({ ...completed({ income_regime: "none" }), sii_enabled: true, period: "monthly" }).map((model) => model.code);
    expect(codes).toEqual(["303"]);
  });

  it("adds corporate and foreign declarations for a society", () => {
    const codes = deriveTaxModels({
      ...completed({ corporate_tax: true, corporate_tax_installments: true, foreign_assets: true, crypto_assets: true }),
      entity_type: "sociedad",
    }).map((model) => model.code);
    expect(codes).toEqual(["303", "390", "200", "202", "720", "721"]);
  });
});
