import { describe, expect, it } from "vitest";
import { defaultInvoiceTemplate, invoiceTemplateLabel } from "./invoice-template";

describe("invoice templates", () => {
  it("provides a safe default", () => {
    expect(defaultInvoiceTemplate.accent_color).toMatch(/^#/);
    expect(invoiceTemplateLabel(defaultInvoiceTemplate)).toContain("pago");
  });
});
