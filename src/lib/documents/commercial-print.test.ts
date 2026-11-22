import { describe, expect, it } from "vitest";
import { invoicePrintHtml } from "./commercial-print";
import type { Company, Invoice } from "$lib/types";

describe("commercial invoice print", () => {
  it("uses the active company branding and escapes customer content", () => {
    const company = { trade_name: "VOURA", legal_name: "Voura SL", nif: "B123", logo_data_url: "data:image/png;base64,LOGO" } as Company;
    const invoice = {
      series: "F", number: "12", kind: "complete", issued_at: "2026-08-17T10:00:00Z", operation_date: "2026-08-17", due_at: null,
      seller_trade_name: "Antigua", seller_legal_name: "Antigua SL", seller_nif: "B000", customer_name: "Cliente <script>", customer_nif: "A1", customer_email: "",
      lines: [{ description: "Servicio", quantity: 1, unit_price_cents: 10000, vat_rate: 21, total_cents: 12100 }], base_cents: 10000, vat_cents: 2100,
      irpf_cents: 0, total_cents: 12100, paid_cents: 0, notes: "", status: "issued",
    } as Invoice;
    const html = invoicePrintHtml(invoice, company);
    expect(html).toContain("VOURA");
    expect(html).toContain("data:image/png;base64,LOGO");
    expect(html).not.toContain("Antigua SL");
    expect(html).toContain("Cliente &lt;script&gt;");
  });
});
