import { json, type RequestHandler } from "@sveltejs/kit";
import { localGowaDeviceId } from "$lib/whatsapp/local-device.server";
import { gowaLatestMedia, gowaLoginQr, gowaLogout, gowaSendText, gowaStatus } from "$lib/whatsapp/gowa.server";
import { extractExpenseHints } from "$lib/expenses/ocr";
import { extractExpenseFromImage } from "$lib/expenses/vision.server";

function bearer(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Sesión local no válida");
  return authorization.slice(7);
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const deviceId = localGowaDeviceId(bearer(request));
    const input = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(input.action || "status");
    if (action === "status") return json({ ...(await gowaStatus(deviceId)), user_phone: "" });
    if (action === "login") return json(await gowaLoginQr(deviceId));
    if (action === "logout") {
      await gowaLogout(deviceId);
      return json({ ok: true });
    }
    if (action === "send") {
      if (input.confirmed !== true) throw new Error("Confirma el envío de WhatsApp antes de continuar");
      const status = await gowaStatus(deviceId);
      if (!status.connected && !status.logged_in) throw new Error("Conecta tu WhatsApp antes de enviar mensajes");
      return json({ ok: true, ...(await gowaSendText(deviceId, String(input.phone || ""), String(input.message || ""))) });
    }
    if (action === "sync_expense") {
      const latest = await gowaLatestMedia(deviceId);
      const vision = await extractExpenseFromImage(latest.media.data_url, latest.caption);
      const hints = { ...extractExpenseHints(latest.caption), ...vision };
      return json({
        id: undefined,
        status: "review",
        kind: "invoice",
        title: hints.title || latest.media.name,
        supplier_name: hints.supplier_name || "",
        supplier_tax_id: hints.supplier_tax_id || "",
        invoice_number: hints.invoice_number || "",
        issued_at: hints.issued_at || null,
        base_cents: hints.base_cents || 0,
        vat_cents: hints.vat_cents || 0,
        total_cents: hints.total_cents || 0,
        notes: hints.notes || latest.caption,
        ocr_confidence: hints.ocr_confidence ?? 0.8,
        attachments: [{ id: `wa-${latest.message_id}`, name: latest.media.name, mime_type: latest.media.mime_type, size: Math.floor((latest.media.data_url.length * 3) / 4), data_url: latest.media.data_url }],
        source: "whatsapp",
        source_phone: latest.from,
      });
    }
    return json({ error: "Acción de WhatsApp no reconocida" }, { status: 400 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "WhatsApp no está disponible" }, { status: 400 });
  }
};
