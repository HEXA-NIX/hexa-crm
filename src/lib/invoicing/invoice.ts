import type { Company, Customer, FiscalProfile, Invoice, InvoiceInput, Sale, SaleLine } from "$lib/types";

export function buildInvoiceFromSale(input: {
  id: number;
  company: Company;
  customer?: Customer | null;
  sale: Sale;
  lines: SaleLine[];
  invoice: InvoiceInput;
  created_by: number;
  number: string;
  issued_at?: string;
  profile?: FiscalProfile | null;
}): Invoice {
  const kind = input.invoice.kind ?? "complete";
  if (kind === "complete" && !input.customer?.nif?.trim()) {
    throw new Error("Una factura completa necesita el NIF del cliente");
  }
  const series = (input.invoice.series ?? "F").trim().toUpperCase() || "F";
  const lines = input.lines.map((line) => ({
    description: line.product_name || `Producto ${line.product_id}`,
    quantity: line.qty,
    unit_price_cents: line.unit_price_cents,
    vat_rate: line.vat_rate,
    base_cents: line.line_base_cents,
    vat_cents: line.line_vat_cents,
    total_cents: line.line_total_cents,
  }));
  const base_cents = lines.reduce((sum, line) => sum + line.base_cents, 0);
  const vat_cents = lines.reduce((sum, line) => sum + line.vat_cents, 0);
  const irpf_rate = Math.max(0, Math.min(100, Number(input.invoice.irpf_rate ?? (input.profile?.irpf_enabled ? input.profile.default_irpf_rate : 0))));
  const irpf_cents = Math.round(base_cents * irpf_rate / 100);
  const issued_at = input.issued_at ?? new Date().toISOString();
  return {
    id: input.id,
    company_id: input.company.id,
    sale_id: input.sale.id,
    series,
    number: input.number,
    kind,
    status: "issued",
    issued_at,
    due_at: input.invoice.due_at ?? null,
    seller_legal_name: input.company.legal_name,
    seller_nif: input.company.nif,
    seller_trade_name: input.company.trade_name,
    customer_id: input.customer?.id ?? null,
    customer_name: input.customer?.name ?? "Cliente contado",
    customer_nif: input.customer?.nif ?? "",
    customer_email: input.customer?.email ?? "",
    lines,
    base_cents,
    vat_cents,
    irpf_rate,
    irpf_cents,
    total_cents: base_cents + vat_cents - irpf_cents,
    notes: input.invoice.notes?.trim() ?? "",
    created_by: input.created_by,
    created_at: issued_at,
    updated_at: issued_at,
  };
}
