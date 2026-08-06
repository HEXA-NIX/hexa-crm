import { beforeEach, describe, expect, it } from "vitest";
import { browserApi, __resetBrowserStoreForTests } from "./browser-store";

describe("ciclo de facturas emitidas", () => {
  beforeEach(() => __resetBrowserStoreForTests());

  it("emite, cobra parcialmente y crea un abono rectificativo", async () => {
    const { token } = await browserApi.login("admin", "1234");
    const customer = browserApi.upsert_customer({ name: "Cliente fiscal", nif: "12345678Z" }, token);
    const product = browserApi.list_products(true, token)[0];
    const sale = browserApi.create_sale([{ product_id: product.id, qty: 1 }], customer.id, "venta test", token);
    const invoice = browserApi.issue_invoice({ sale_id: sale.id, operation_date: "2026-08-06", due_at: "2026-09-06" }, token);
    expect(invoice.payment_status).toBe("pending");
    await browserApi.add_invoice_payment({ invoice_id: invoice.id, amount_cents: Math.floor(invoice.total_cents / 2), method: "card" }, token);
    expect(browserApi.list_invoices(token)[0].payment_status).toBe("partial");
    const credit = browserApi.issue_invoice({ rectifies_invoice_id: invoice.id, kind: "rectifying" }, token);
    expect(credit.kind).toBe("rectifying");
    expect(credit.total_cents).toBe(-invoice.total_cents);
  });
});
