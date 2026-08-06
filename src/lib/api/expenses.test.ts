import { beforeEach, describe, expect, it } from "vitest";
import { __resetBrowserStoreForTests, browserApi } from "./browser-store";

describe("expense documents", () => {
  beforeEach(() => __resetBrowserStoreForTests());
  it("keeps the original attachment and creates a cash movement only on approval", async () => {
    const { token } = await browserApi.login("admin", "1234");
    const draft = await browserApi.upsert_expense_document({ title: "Factura proveedor", total_cents: 4835, attachments: [{ id: "a", name: "factura.pdf", mime_type: "application/pdf", size: 42 }], source: "upload" }, token);
    expect(draft.status).toBe("review");
    expect((await browserApi.list_cash_movements(token))).toHaveLength(0);
    const approved = await browserApi.approve_expense_document(draft.id, token);
    expect(approved.status).toBe("approved");
    expect((await browserApi.list_cash_movements(token))[0].amount_cents).toBe(4835);
  });

  it("registra pagos parciales, actualiza el estado y concilia cada pago en Caja", async () => {
    const { token } = await browserApi.login("admin", "1234");
    const expense = await browserApi.upsert_expense_document({ title: "Factura de proveedor", total_cents: 10000 }, token);
    await browserApi.approve_expense_document(expense.id, token);

    const first = await browserApi.add_expense_payment({ expense_id: expense.id, amount_cents: 4000, method: "bank_transfer" }, token);
    expect(first.amount_cents).toBe(4000);
    expect((await browserApi.list_expense_documents(token)).find((item) => item.id === expense.id)).toMatchObject({ paid_cents: 4000, payment_status: "partial" });

    await browserApi.add_expense_payment({ expense_id: expense.id, amount_cents: 6000, method: "cash" }, token);
    expect((await browserApi.list_expense_documents(token)).find((item) => item.id === expense.id)).toMatchObject({ paid_cents: 10000, payment_status: "paid", status: "paid" });
    expect((await browserApi.list_expense_payments(expense.id, token))).toHaveLength(2);
    expect((await browserApi.list_cash_movements(token)).filter((movement) => movement.category === "pago_factura_recibida")).toHaveLength(2);
  });
});
