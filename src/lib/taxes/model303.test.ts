import { describe, expect, it } from "vitest";
import { buildModel303Draft } from "./model303";

describe("model 303 draft", () => {
  it("calcula IVA repercutido, soportado y retenciones del periodo", () => {
    const draft = buildModel303Draft({
      company_id: 1,
      from: "2026-08-01",
      to: "2026-08-31",
      sales: [{ id: 1, company_id: 1, customer_id: null, number: "S-1", sold_at: "2026-08-05T10:00:00Z", subtotal_cents: 10000, vat_cents: 2100, total_cents: 12100, notes: "", status: "completed", lines: [] }],
      saleLines: [{ id: 1, sale_id: 1, product_id: 1, qty: 1, returned_qty: 0, unit_price_cents: 10000, vat_rate: 21, line_base_cents: 10000, line_vat_cents: 2100, line_total_cents: 12100 }],
      expenses: [{ id: 1, company_id: 1, status: "approved", kind: "invoice", title: "Proveedor", supplier_name: "", supplier_tax_id: "", invoice_number: "", issued_at: "2026-08-06", due_at: null, project_id: null, category: "otros", base_cents: 5000, vat_rate: 21, vat_cents: 1050, withholding_cents: 750, total_cents: 6050, currency: "EUR", notes: "", attachments: [], source: "manual", source_phone: null, ocr_confidence: null, created_by: 1, created_at: "2026-08-06", updated_at: "2026-08-06", approved_at: "2026-08-06" }],
    });
    expect(draft.output_vat_cents).toBe(2100);
    expect(draft.input_vat_cents).toBe(1050);
    expect(draft.net_vat_cents).toBe(1050);
    expect(draft.withholding_cents).toBe(750);
  });
});
