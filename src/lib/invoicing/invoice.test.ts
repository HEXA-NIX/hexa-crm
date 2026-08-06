import { describe, expect, it } from "vitest";
import { buildInvoiceFromSale } from "./invoice";

describe("facturas emitidas", () => {
  it("calcula IVA, IRPF y total desde una venta", () => {
    const invoice = buildInvoiceFromSale({
      id: 1,
      company: { id: 1, code: "SHOP", legal_name: "Empresa S.L.", trade_name: "Empresa", nif: "B12345678", kind: "generic", active: true, created_at: "2026-08-01" },
      customer: { id: 2, company_id: 1, name: "Cliente", email: "cliente@example.com", phone: "", nif: "12345678Z", notes: "", created_at: "2026-08-01" },
      sale: { id: 4, company_id: 1, customer_id: 2, number: "T-00004", sold_at: "2026-08-01", subtotal_cents: 10000, vat_cents: 2100, total_cents: 12100, notes: "", status: "completed" },
      lines: [{ id: 1, sale_id: 4, product_id: 1, product_name: "Servicio", qty: 1, unit_price_cents: 10000, vat_rate: 21, line_base_cents: 10000, line_vat_cents: 2100, line_total_cents: 12100 }],
      invoice: { sale_id: 4, irpf_rate: 15 },
      created_by: 1,
      number: "2026-00001",
    });
    expect(invoice.base_cents).toBe(10000);
    expect(invoice.vat_cents).toBe(2100);
    expect(invoice.irpf_cents).toBe(1500);
    expect(invoice.total_cents).toBe(10600);
  });
});
