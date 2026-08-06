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
});
