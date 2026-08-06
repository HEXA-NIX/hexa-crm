import { json, type RequestHandler } from "@sveltejs/kit";
import { localGowaDeviceId } from "$lib/whatsapp/local-device.server";
import { gowaLoginQr, gowaLogout, gowaSendText, gowaStatus } from "$lib/whatsapp/gowa.server";

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
    return json({ error: "Acción de WhatsApp no reconocida" }, { status: 400 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "WhatsApp no está disponible" }, { status: 400 });
  }
};
