import type { FiscalProfile, FiscalTaxSetup, TaxModelDefinition } from "$lib/types";

export const DEFAULT_TAX_SETUP: FiscalTaxSetup = {
  tax_residency: "spain",
  census_changes: false,
  income_regime: "none",
  vat_registered: false,
  vat_activity: "not_applicable",
  annual_vat_summary: false,
  intra_community_operations: false,
  imports_exports: false,
  third_party_operations: false,
  has_employees: false,
  withholds_employees: false,
  withholds_professionals: false,
  withholds_rent: false,
  withholds_capital: false,
  corporate_tax: false,
  corporate_tax_installments: false,
  foreign_assets: false,
  crypto_assets: false,
};

export const TAX_MODEL_CATALOG: Record<string, TaxModelDefinition> = {
  "036": { code: "036", label: "036 · Censo y cambios censales", frequency: "eventual", reason: "Alta, baja o modificación de datos censales." },
  "303": { code: "303", label: "303 · IVA", frequency: "quarterly", reason: "Actividad sujeta a IVA en régimen que exige autoliquidación." },
  "130": { code: "130", label: "130 · IRPF estimación directa", frequency: "quarterly", reason: "Autónomo en estimación directa." },
  "131": { code: "131", label: "131 · IRPF módulos", frequency: "quarterly", reason: "Autónomo en estimación objetiva (módulos)." },
  "111": { code: "111", label: "111 · Retenciones", frequency: "quarterly", reason: "Retenciones de trabajadores o profesionales." },
  "115": { code: "115", label: "115 · Alquileres", frequency: "quarterly", reason: "Retenciones sobre alquileres urbanos." },
  "123": { code: "123", label: "123 · Capital mobiliario", frequency: "quarterly", reason: "Retenciones sobre rendimientos del capital mobiliario." },
  "349": { code: "349", label: "349 · Operaciones intracomunitarias", frequency: "quarterly", reason: "Operaciones con empresas de la Unión Europea." },
  "347": { code: "347", label: "347 · Operaciones con terceros", frequency: "annual", reason: "Operaciones con terceros que superan el umbral anual." },
  "180": { code: "180", label: "180 · Resumen alquileres", frequency: "annual", reason: "Resumen anual de retenciones de alquileres." },
  "190": { code: "190", label: "190 · Resumen retenciones", frequency: "annual", reason: "Resumen anual de retenciones de trabajo y profesionales." },
  "193": { code: "193", label: "193 · Resumen capital mobiliario", frequency: "annual", reason: "Resumen anual de retenciones de capital mobiliario." },
  "390": { code: "390", label: "390 · Resumen anual IVA", frequency: "annual", reason: "Resumen anual del IVA." },
  "200": { code: "200", label: "200 · Impuesto sobre Sociedades", frequency: "annual", reason: "Sociedad sujeta al Impuesto sobre Sociedades." },
  "202": { code: "202", label: "202 · Pagos fraccionados Sociedades", frequency: "quarterly", reason: "Pagos fraccionados del Impuesto sobre Sociedades." },
  "720": { code: "720", label: "720 · Bienes y derechos en el extranjero", frequency: "annual", reason: "Bienes o derechos en el extranjero sujetos a declaración." },
  "721": { code: "721", label: "721 · Criptoactivos en el extranjero", frequency: "annual", reason: "Criptoactivos en el extranjero sujetos a declaración." },
};

export function normalizeTaxSetup(input?: Partial<FiscalTaxSetup> | null): FiscalTaxSetup {
  return { ...DEFAULT_TAX_SETUP, ...(input ?? {}) };
}

/**
 * Builds a review list, not a legal determination. The questionnaire makes
 * the assumptions explicit and every result is shown with its reason so an
 * adviser can correct it before a filing deadline.
 */
export function deriveTaxModels(profile: Pick<FiscalProfile, "entity_type" | "regime" | "period" | "sii_enabled" | "profile_completed" | "tax_setup">): TaxModelDefinition[] {
  if (!profile.profile_completed) return [];
  const setup = normalizeTaxSetup(profile.tax_setup);
  const codes: string[] = [];
  if (setup.census_changes) codes.push("036");

  if (setup.vat_registered && setup.vat_activity !== "not_applicable" && setup.vat_activity !== "exempt") {
    codes.push("303");
    if (setup.annual_vat_summary && !profile.sii_enabled) codes.push("390");
  }
  if (profile.entity_type === "autonomo") {
    if (setup.income_regime === "direct_estimation") codes.push("130");
    if (setup.income_regime === "objective_estimation") codes.push("131");
  }
  if (setup.withholds_employees || setup.withholds_professionals) codes.push("111", "190");
  if (setup.withholds_rent) codes.push("115", "180");
  if (setup.withholds_capital) codes.push("123", "193");
  if (setup.intra_community_operations) codes.push("349");
  if (setup.third_party_operations) codes.push("347");
  if (setup.corporate_tax) {
    codes.push("200");
    if (setup.corporate_tax_installments) codes.push("202");
  }
  if (setup.foreign_assets) codes.push("720");
  if (setup.crypto_assets) codes.push("721");

  const monthlyCodes = new Set(["303", "111", "115", "123", "202"]);
  return [...new Set(codes)].map((code) => ({ ...TAX_MODEL_CATALOG[code], frequency: profile.period === "monthly" && monthlyCodes.has(code) ? "monthly" : TAX_MODEL_CATALOG[code].frequency }));
}

export function taxModelCodes(profile: Parameters<typeof deriveTaxModels>[0]): string[] {
  return deriveTaxModels(profile).map((model) => model.code);
}
