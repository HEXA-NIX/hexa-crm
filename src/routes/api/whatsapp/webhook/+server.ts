import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "$env/dynamic/private";
import { json, type RequestHandler } from "@sveltejs/kit";
import { initDb, postgresApi, sql } from "$lib/api/postgres-db";

async function trace(state: string, detail: Record<string, unknown> = {}) {
  const value = JSON.stringify({ at: new Date().toISOString(), state, ...detail });
  await sql`INSERT INTO settings (key,value) VALUES ('whatsapp_webhook_trace',${value}) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
}

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
    await initDb();
    const event = JSON.parse(raw) as { event?: string; device_id?: string; session_id?: string; payload?: Record<string, unknown> };
    const sessionDeviceId = /^hexa-\d+-\d+$/.test(event.session_id || "")
      ? event.session_id
      : event.device_id || env.GOWA_DEVICE_ID;
    console.info("WhatsApp webhook event", { event: event.event, device_id: event.device_id, session_id: event.session_id, routed_device_id: sessionDeviceId, payload_keys: event.payload ? Object.keys(event.payload) : [] });
    await trace("received", { event: event.event, device_id: event.device_id, session_id: event.session_id, routed_device_id: sessionDeviceId, payload_keys: event.payload ? Object.keys(event.payload) : [] });
    const hasExpenseMedia = Boolean(event.payload && (event.payload.image || event.payload.document || event.payload.media || event.payload.filename || event.payload.url));
    const ownTextMessage = event.payload?.is_from_me === true && !hasExpenseMedia;
    if (event.event?.toLowerCase() !== "message" || !sessionDeviceId || !event.payload || ownTextMessage) {
      await trace("ignored", { event: event.event, reason: ownTextMessage ? "own_text_message" : "unsupported_event_or_device" });
      return json({ ok: true, ignored: true });
    }
    const result = await postgresApi.process_whatsapp_expense_message(sessionDeviceId, event.payload);
    await trace(result.state, { event: event.event, routed_device_id: sessionDeviceId, expense_id: result.expense?.id });
    return json({ ok: true, state: result.state, expense_id: result.expense?.id, status: result.expense?.status });
  } catch (error) {
    console.error("WhatsApp webhook processing failed", error);
    await trace("error", { error: error instanceof Error ? error.message : "No se pudo registrar la factura recibida" }).catch(() => undefined);
    return json({ error: error instanceof Error ? error.message : "No se pudo registrar la factura recibida" }, { status: 400 });
  }
};
