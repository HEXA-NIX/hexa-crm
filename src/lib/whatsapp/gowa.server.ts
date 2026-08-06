import { env } from "$env/dynamic/private";

export type GowaStatus = { connected: boolean; logged_in: boolean; device_id: string; phone?: string };

function config() {
  const baseUrl = (env.GOWA_BASE_URL || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("WhatsApp no está configurado por el administrador de Hexa");
  const username = env.GOWA_USERNAME || "";
  const password = env.GOWA_PASSWORD || "";
  const authorization = username || password
    ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
    : "";
  return { baseUrl, authorization };
}

async function request(path: string, init: RequestInit = {}) {
  const { baseUrl, authorization } = config();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (authorization) headers.set("Authorization", authorization);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) });
  const data = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    const message = String(data.message || data.error || `HTTP ${response.status}`);
    const error = new Error(`GOWA: ${message}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data;
}

export function normalizeWhatsAppPhone(value: string): string {
  const clean = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(clean)) {
    throw new Error("Escribe el teléfono con prefijo internacional, por ejemplo +34600111222");
  }
  return clean;
}

export function gowaDeviceId(companyId: number, userId: number): string {
  return `hexa-${companyId}-${userId}`;
}

function isDeviceNotFound(error: unknown): boolean {
  return (error as Error & { status?: number })?.status === 404 || /not found|no encontrado/i.test(error instanceof Error ? error.message : String(error));
}

export async function ensureGowaDevice(deviceId: string): Promise<void> {
  try {
    await request(`/devices/${encodeURIComponent(deviceId)}`);
  } catch (error) {
    if (!isDeviceNotFound(error)) throw error;
    await request("/devices", { method: "POST", body: JSON.stringify({ device_id: deviceId }) });
  }
}

export async function gowaStatus(deviceId: string): Promise<GowaStatus> {
  try {
    const data = await request(`/devices/${encodeURIComponent(deviceId)}/status`);
    const result = data.results || data;
    return {
      device_id: deviceId,
      connected: Boolean(result.connected ?? result.is_connected),
      logged_in: Boolean(result.logged_in ?? result.is_logged_in),
      phone: result.phone ? String(result.phone) : undefined,
    };
  } catch (error) {
    if (isDeviceNotFound(error)) return { device_id: deviceId, connected: false, logged_in: false };
    throw error;
  }
}

export async function gowaLoginQr(deviceId: string): Promise<{ qr_url: string; qr_data?: string }> {
  await ensureGowaDevice(deviceId);
  const data = await request(`/devices/${encodeURIComponent(deviceId)}/login`);
  const result = data.results || data;
  const qr_url = String(result.qr_link || result.qr_url || result.link || "");
  let qr_data = result.qr_code || result.qr ? String(result.qr_code || result.qr) : undefined;
  if (!qr_data && qr_url) {
    const { baseUrl, authorization } = config();
    const headers = new Headers();
    if (authorization) headers.set("Authorization", authorization);
    const source = new URL(qr_url);
    const imageUrl = new URL(`${source.pathname}${source.search}`, `${baseUrl}/`).toString();
    const image = await fetch(imageUrl, { headers, signal: AbortSignal.timeout(10_000) });
    if (image.ok) qr_data = `data:${image.headers.get("content-type") || "image/png"};base64,${Buffer.from(await image.arrayBuffer()).toString("base64")}`;
  }
  if (!qr_url && !qr_data) throw new Error("GOWA no devolvió el código QR");
  return { qr_url: qr_data || qr_url, qr_data };
}

export async function gowaLogout(deviceId: string): Promise<void> {
  await request(`/devices/${encodeURIComponent(deviceId)}/logout`, { method: "POST" });
}

export async function gowaSendText(deviceId: string, phone: string, message: string): Promise<{ message_id?: string }> {
  const text = message.trim();
  if (!text) throw new Error("El mensaje no puede estar vacío");
  if (text.length > 4000) throw new Error("El mensaje supera los 4.000 caracteres");
  const destination = `${normalizeWhatsAppPhone(phone).slice(1)}@s.whatsapp.net`;
  const data = await request("/send/message", {
    method: "POST",
    headers: { "X-Device-Id": deviceId },
    body: JSON.stringify({ phone: destination, message: text }),
  });
  const result = data.results || data;
  return { message_id: result.message_id ? String(result.message_id) : undefined };
}
