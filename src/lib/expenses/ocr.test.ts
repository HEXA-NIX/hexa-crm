import { describe, expect, it } from "vitest";
import { extractExpenseHints } from "./ocr";

describe("expense OCR hints", () => {
  it("extracts total, invoice number and date from a caption", () => {
    expect(extractExpenseHints("Factura F-2026-18\nFecha 06/08/2026\nTotal: 48,35 €")).toMatchObject({
      invoice_number: "F-2026-18", total_cents: 4835, issued_at: "2026-08-06",
    });
  });
});
