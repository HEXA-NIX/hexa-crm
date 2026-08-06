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
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new Error(`No se puede conectar con GOWA en ${baseUrl}: ${error instanceof Error ? error.message : "fallo de red"}`);
  }
  const data = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    const message = String(data.message || data.error || `HTTP ${response.status}`);
    const error = new Error(`GOWA: ${message}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data;
}

async function requestBinary(path: string, headersInit: HeadersInit = {}): Promise<{ bytes: Uint8Array; mimeType: string; fileName?: string }> {
  const { baseUrl, authorization } = config();
  const headers = new Headers(headersInit);
  headers.set("Accept", "application/octet-stream, application/json");
  if (authorization) headers.set("Authorization", authorization);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new Error(`No se puede descargar el multimedia desde GOWA: ${error instanceof Error ? error.message : "fallo de red"}`);
  }
  const mimeType = response.headers.get("content-type") || "application/octet-stream";
  const disposition = response.headers.get("content-disposition") || "";
  const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  if (!response.ok) throw new Error(`GOWA: HTTP ${response.status}`);
  if (mimeType.includes("application/json")) {
    const data = await response.json() as any;
    const result = data.results || data;
    const encoded = String(result.data_base64 || result.base64 || result.content_base64 || "");
    if (!encoded && result.file_url) {
      const fileUrl = new URL(String(result.file_url), `${baseUrl}/`);
      const configuredUrl = new URL(baseUrl);
      if (["localhost", "127.0.0.1", "::1"].includes(fileUrl.hostname)) {
        fileUrl.protocol = configuredUrl.protocol;
        fileUrl.hostname = configuredUrl.hostname;
        fileUrl.port = configuredUrl.port;
      }
      let fileResponse: Response;
      try {
        fileResponse = await fetch(fileUrl, { headers, signal: AbortSignal.timeout(30_000) });
      } catch (error) {
        throw new Error(`GOWA devolvió una URL de archivo inaccesible (${fileUrl}): ${error instanceof Error ? error.message : "fallo de red"}`);
      }
      if (!fileResponse.ok) throw new Error(`GOWA no pudo descargar el archivo (HTTP ${fileResponse.status})`);
      return { bytes: new Uint8Array(await fileResponse.arrayBuffer()), mimeType: fileResponse.headers.get("content-type") || "application/octet-stream", fileName: result.filename || result.file_name };
    }
    if (!encoded) throw new Error("GOWA no devolvió el contenido multimedia");
    return { bytes: new Uint8Array(Buffer.from(encoded, "base64")), mimeType: String(result.mime_type || result.mimetype || "application/octet-stream"), fileName: result.file_name || result.filename };
  }
  return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType, fileName };
}

function unwrapResults<T = any>(data: any): T {
  const result = data?.results ?? data;
  return (result?.data ?? result) as T;
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
  const destination = phone.includes("@g.us") || phone.includes("@s.whatsapp.net")
    ? phone
    : `${normalizeWhatsAppPhone(phone).slice(1)}@s.whatsapp.net`;
  const data = await request("/send/message", {
    method: "POST",
    headers: { "X-Device-Id": deviceId },
    body: JSON.stringify({ phone: destination, message: text }),
  });
  const result = data.results || data;
  return { message_id: result.message_id ? String(result.message_id) : undefined };
}

export async function gowaListChats(deviceId: string): Promise<any[]> {
  const data = await request(`/chats?limit=50&has_media=true`, { headers: { "X-Device-Id": deviceId } });
  const result = unwrapResults<any>(data);
  return Array.isArray(result) ? result : Array.isArray(result?.chats) ? result.chats : [];
}

export async function gowaGetChatMessages(deviceId: string, chatJid: string): Promise<any[]> {
  const path = `/chat/${encodeURIComponent(chatJid)}/messages?limit=50&media_only=true`;
  const data = await request(path, { headers: { "X-Device-Id": deviceId } });
  const result = unwrapResults<any>(data);
  return Array.isArray(result) ? result : Array.isArray(result?.messages) ? result.messages : [];
}

export async function gowaDownloadMessageMedia(deviceId: string, messageId: string, phone: string): Promise<{ data_url: string; mime_type: string; name: string }> {
  const downloaded = await requestBinary(`/message/${encodeURIComponent(messageId)}/download?phone=${encodeURIComponent(phone)}`, { "X-Device-Id": deviceId });
  const mime = downloaded.mimeType.split(";")[0] || "application/octet-stream";
  const extension = mime.split("/")[1]?.replace("jpeg", "jpg") || "bin";
  return { data_url: `data:${mime};base64,${Buffer.from(downloaded.bytes).toString("base64")}`, mime_type: mime, name: downloaded.fileName || `whatsapp-${messageId}.${extension}` };
}

export async function gowaLatestMedia(deviceId: string): Promise<{ media: { data_url: string; mime_type: string; name: string }; caption: string; from: string; message_id: string }> {
  const chats = await gowaListChats(deviceId);
  const candidates: any[] = [];
  for (const chat of chats.slice(0, 50)) {
    const jid = String(chat.jid || chat.chat_jid || chat.id || chat.phone || "");
    if (!jid) continue;
    const messages = await gowaGetChatMessages(deviceId, jid).catch(() => []);
    for (const message of messages) {
      const mediaType = String(message.media_type || message.type || message.message_type || "").toLowerCase();
      if (!message.id && !message.message_id) continue;
      const hasMedia = ["image", "document", "file", "pdf", "media"].some((kind) => mediaType.includes(kind)) || Boolean(message.filename || message.url);
      if (!hasMedia) continue;
      const rawTimestamp = message.timestamp || message.time || message.created_at || 0;
      const timestamp = typeof rawTimestamp === "number" ? rawTimestamp : Date.parse(String(rawTimestamp)) || 0;
      candidates.push({ message, jid: String(message.chat_jid || jid), timestamp });
    }
  }
  candidates.sort((a, b) => b.timestamp - a.timestamp);
  const candidate = candidates[0];
  if (!candidate) throw new Error("No hay imágenes o documentos nuevos en los chats de WhatsApp");
  const message = candidate.message;
  const messageId = String(message.id || message.message_id);
  const media = await gowaDownloadMessageMedia(deviceId, messageId, candidate.jid);
  return { media, caption: String(message.caption || message.content || message.body || message.text || ""), from: String(message.from || message.sender || candidate.jid), message_id: messageId };
}
