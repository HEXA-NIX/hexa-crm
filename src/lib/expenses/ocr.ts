import type { ExpenseDocumentInput } from "$lib/types";

/** Lightweight first-pass extraction used before a vision provider is configured. */
export function extractExpenseHints(text: string): Partial<ExpenseDocumentInput> {
  const value = text.trim();
  const total = value.match(/(?:total|importe|€)\s*[:=]?\s*(\d+[\d.,]*)/i)?.[1];
  const date = value.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/)?.[1];
  const invoice = value.match(/(?:factura|n[º°o.]*)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i)?.[1];
  const normalizedTotal = total ? Number(total.replace(/\./g, "").replace(",", ".")) : NaN;
  return {
    title: invoice ? `Factura ${invoice}` : value.split("\n")[0]?.slice(0, 120) || "Factura recibida",
    invoice_number: invoice || "",
    total_cents: Number.isFinite(normalizedTotal) ? Math.round(normalizedTotal * 100) : 0,
    issued_at: date ? normalizeDate(date) : null,
    notes: value,
    ocr_confidence: total || date || invoice ? 0.55 : 0.1,
  };
}

function normalizeDate(value: string): string | null {
  const parts = value.split(/[/-]/).map(Number);
  if (parts.length !== 3) return null;
  const [day, month, yearRaw] = parts;
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
