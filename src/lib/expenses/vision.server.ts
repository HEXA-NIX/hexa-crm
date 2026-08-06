import { env } from "$env/dynamic/private";
import { extractExpenseHints } from "./ocr";
import type { ExpenseDocumentInput } from "$lib/types";

export async function extractExpenseFromImage(dataUrl: string, caption = "", options: { baseUrl?: string; model?: string } = {}): Promise<Partial<ExpenseDocumentInput>> {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("La imagen recibida no tiene un formato válido");
  const baseUrl = (options.baseUrl || env.HEXA_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = options.model || env.HEXA_OLLAMA_MODEL || "llama3.2-vision";
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        format: "json",
        messages: [{
          role: "user",
          content: `Lee esta factura o ticket y devuelve SOLO JSON con estas claves: title, supplier_name, supplier_tax_id, invoice_number, issued_at (AAAA-MM-DD), base_cents, vat_cents, total_cents, notes, ocr_confidence. Si un dato no aparece usa cadena vacía, null o 0. No inventes datos. Texto adicional: ${caption}`,
          images: [match[2]],
        }],
        options: { temperature: 0, num_predict: 300 },
      }),
    });
  } catch (error) {
    throw new Error(`No se puede conectar con Ollama Vision en ${baseUrl}. Comprueba HEXA_OLLAMA_URL y que el modelo ${model} esté disponible. ${error instanceof Error ? error.message : "fallo de red"}`);
  }
  if (!response.ok) throw new Error(`No se pudo ejecutar OCR/visión (HTTP ${response.status})`);
  const payload = await response.json() as any;
  const content = String(payload?.message?.content || "").trim();
  try {
    const parsed = JSON.parse(content) as Partial<ExpenseDocumentInput>;
    return { ...parsed, ocr_confidence: Math.max(0, Math.min(1, Number(parsed.ocr_confidence ?? 0.8))) };
  } catch {
    return extractExpenseHints(caption);
  }
}
