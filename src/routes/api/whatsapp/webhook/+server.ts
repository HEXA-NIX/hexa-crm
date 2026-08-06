import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "$env/dynamic/private";
import { json, type RequestHandler } from "@sveltejs/kit";
import { initDb, postgresApi } from "$lib/api/postgres-db";

function validSignature(raw: string, received: string | null): boolean {
  const secret = env.GOWA_WEBHOOK_SECRET?.trim();
  if (!secret || !received) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(expected); const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const POST: RequestHandler = async ({ request }) => {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) return json({ error: "Firma de webhook no válida" }, { status: 401 });
  try {
    const event = JSON.parse(raw) as { event?: string; device_id?: string; payload?: Record<string, unknown> };
    if (event.event?.toLowerCase() !== "message" || !event.device_id || !event.payload) return json({ ok: true, ignored: true });
    await initDb();
    const result = await postgresApi.process_whatsapp_expense_message(event.device_id, event.payload);
    return json({ ok: true, state: result.state, expense_id: result.expense?.id, status: result.expense?.status });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo registrar la factura recibida" }, { status: 400 });
  }
};
