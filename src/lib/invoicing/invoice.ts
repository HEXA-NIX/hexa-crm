import type { Company, Customer, FiscalProfile, Invoice, InvoiceInput, InvoiceLineInput, Sale, SaleLine } from "$lib/types";
import { isVatRate } from "$lib/vat";

export function buildManualInvoice(input: {
  id: number;
  company: Company;
  customer?: Customer | null;
  lines: InvoiceLineInput[];
  invoice: InvoiceInput;
  created_by: number;
  number: string;
  issued_at?: string;
  profile?: FiscalProfile | null;
}): Invoice {
  const kind = input.invoice.kind ?? "complete";
  if (kind === "rectifying") throw new Error("Una factura manual no puede ser rectificativa");
  if (kind === "complete" && !input.customer?.nif?.trim()) throw new Error("Una factura completa necesita el NIF del cliente");
  if (!input.lines.length) throw new Error("La factura debe tener al menos una línea");
  const lines = input.lines.map((line) => {
    const quantity = Number(line.quantity);
    const unit_price_cents = Math.round(Number(line.unit_price_cents));
    const vat_rate = Number(line.vat_rate);
    if (!line.description?.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unit_price_cents) || unit_price_cents < 0 || !isVatRate(vat_rate)) {
      throw new Error("Revisa las líneas, cantidades, importes e IVA de la factura");
    }
    const base_cents = Math.round(quantity * unit_price_cents);
    const vat_cents = Math.round(base_cents * vat_rate / 100);
    return { description: line.description.trim(), quantity, unit_price_cents, vat_rate, base_cents, vat_cents, total_cents: base_cents + vat_cents };
  });
  const base_cents = lines.reduce((sum, line) => sum + line.base_cents, 0);
  const vat_cents = lines.reduce((sum, line) => sum + line.vat_cents, 0);
  const irpf_rate = Math.max(0, Math.min(100, Number(input.invoice.irpf_rate ?? (input.profile?.irpf_enabled ? input.profile.default_irpf_rate : 0))));
  const irpf_cents = Math.round(base_cents * irpf_rate / 100);
  const issued_at = input.issued_at ?? new Date().toISOString();
  return {
    id: input.id, company_id: input.company.id, sale_id: null, series: (input.invoice.series ?? "F").trim().toUpperCase() || "F", number: input.number,
    kind, status: "issued", issued_at, operation_date: input.invoice.operation_date || issued_at.slice(0, 10), due_at: input.invoice.due_at ?? null,
    seller_legal_name: input.company.legal_name, seller_nif: input.company.nif, seller_trade_name: input.company.trade_name,
    customer_id: input.customer?.id && input.customer.id > 0 ? input.customer.id : null, customer_name: input.customer?.name || input.invoice.customer_name?.trim() || "Cliente contado",
    customer_nif: input.customer?.nif || input.invoice.customer_nif?.trim() || "", customer_email: input.customer?.email || input.invoice.customer_email?.trim() || "", lines,
    base_cents, vat_cents, irpf_rate, irpf_cents, total_cents: base_cents + vat_cents - irpf_cents, paid_cents: 0, payment_status: "pending",
    notes: input.invoice.notes?.trim() ?? "", created_by: input.created_by, created_at: issued_at, updated_at: issued_at,
  };
}

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
    operation_date: input.invoice.operation_date || input.sale.sold_at.slice(0, 10),
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
    paid_cents: 0,
    payment_status: "pending",
    notes: input.invoice.notes?.trim() ?? "",
    created_by: input.created_by,
    created_at: issued_at,
    updated_at: issued_at,
  };
}

export function buildRectifyingInvoice(input: {
  id: number;
  base: Invoice;
  number: string;
  created_by: number;
  issued_at?: string;
  notes?: string;
}): Invoice {
  const issued_at = input.issued_at ?? new Date().toISOString();
  const lines = input.base.lines.map((line) => ({ ...line, base_cents: -Math.abs(line.base_cents), vat_cents: -Math.abs(line.vat_cents), total_cents: -Math.abs(line.total_cents) }));
  const base_cents = -Math.abs(input.base.base_cents);
  const vat_cents = -Math.abs(input.base.vat_cents);
  const irpf_cents = -Math.abs(input.base.irpf_cents);
  return {
    ...input.base,
    id: input.id,
    sale_id: input.base.sale_id,
    number: input.number,
    kind: "rectifying",
    status: "issued",
    issued_at,
    operation_date: input.base.operation_date,
    due_at: null,
    lines,
    base_cents,
    vat_cents,
    irpf_cents,
    total_cents: base_cents + vat_cents - irpf_cents,
    paid_cents: 0,
    payment_status: "pending",
    notes: input.notes?.trim() || `Rectifica ${input.base.series}-${input.base.number}`,
    created_by: input.created_by,
    created_at: issued_at,
    updated_at: issued_at,
  };
}
