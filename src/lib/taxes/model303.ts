import type { ExpenseDocument, FiscalProfile, Model303Bucket, Model303Draft, Sale, SaleLine } from "$lib/types";
import type { VatRate } from "$lib/vat";
import { countsInBusinessTotals } from "$lib/sales/cancel-sale";
import { remainingLineAmounts } from "$lib/sales/partial-return";

const RATES: VatRate[] = [0, 4, 10, 21];

function buckets(): Map<VatRate, Model303Bucket> {
  return new Map(RATES.map((vat_rate) => [vat_rate, { vat_rate, base_cents: 0, vat_cents: 0 }]));
}

export function buildModel303Draft(input: {
  company_id: number;
  from: string;
  to: string;
  sales: Sale[];
  saleLines: SaleLine[];
  expenses: ExpenseDocument[];
  profile?: FiscalProfile | null;
}): Model303Draft {
  const output = buckets();
  const purchased = buckets();
  for (const sale of input.sales) {
    if (!countsInBusinessTotals(sale.status) || sale.sold_at.slice(0, 10) < input.from || sale.sold_at.slice(0, 10) > input.to) continue;
    for (const line of input.saleLines.filter((candidate) => candidate.sale_id === sale.id)) {
      const net = remainingLineAmounts({ ...line, returned_qty: line.returned_qty ?? 0 });
      const bucket = output.get(line.vat_rate)!;
      bucket.base_cents += net.base_cents;
      bucket.vat_cents += net.vat_cents;
    }
  }
  let withholding_cents = 0;
  for (const expense of input.expenses) {
    const fiscalDate = expense.accounting_date || expense.issued_at;
    if (expense.status === "rejected" || expense.deductible === false || !fiscalDate || fiscalDate.slice(0, 10) < input.from || fiscalDate.slice(0, 10) > input.to) continue;
    const bucket = purchased.get(expense.vat_rate ?? 21)!;
    bucket.base_cents += expense.base_cents;
    bucket.vat_cents += expense.vat_cents;
    withholding_cents += expense.withholding_cents ?? 0;
  }
  const output_buckets = [...output.values()];
  const input_buckets = [...purchased.values()];
  const output_base_cents = output_buckets.reduce((sum, bucket) => sum + bucket.base_cents, 0);
  const output_vat_cents = output_buckets.reduce((sum, bucket) => sum + bucket.vat_cents, 0);
  const input_base_cents = input_buckets.reduce((sum, bucket) => sum + bucket.base_cents, 0);
  const input_vat_cents = input_buckets.reduce((sum, bucket) => sum + bucket.vat_cents, 0);
  const warnings = [
    "Borrador interno: no es el modelo oficial presentado ante la AEAT.",
    "Revisar facturas recibidas, prorrata, operaciones intracomunitarias y regímenes especiales con la asesoría.",
  ];
  if (input.profile?.regime === "simplified") warnings.push("El régimen simplificado requiere módulos y casillas específicas no calculadas aquí.");
  if (input.profile?.sii_enabled) warnings.push("SII activado: este borrador no sustituye el suministro inmediato de información.");
  return {
    company_id: input.company_id,
    from: input.from,
    to: input.to,
    output_buckets,
    input_buckets,
    output_base_cents,
    output_vat_cents,
    input_base_cents,
    input_vat_cents,
    net_vat_cents: output_vat_cents - input_vat_cents,
    withholding_cents,
    status: "draft",
    warnings,
    generated_at: new Date().toISOString(),
  };
}
