import type { PluginConfig, StorageUploadResult } from "../types";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
export const MAX_PROJECT_UPLOAD_BYTES = 20 * 1024 * 1024;

function requireToken(token: string): string {
  const clean = token.trim();
  if (!clean) throw new Error("Falta el token OAuth de Google Drive");
  return clean;
}

export async function testGoogleDrive(token: string): Promise<{ ok: true; message: string }> {
  const response = await fetch(`${DRIVE_FILES_URL}?pageSize=1&fields=files(id)`, {
    headers: { Authorization: `Bearer ${requireToken(token)}` },
  });
  if (!response.ok) throw new Error(`Google Drive rechazó la credencial (${response.status})`);
  return { ok: true, message: "Conexión con Google Drive correcta" };
}

export async function uploadToGoogleDrive(
  config: PluginConfig,
  token: string,
  input: { name: string; mime_type: string; bytes: Uint8Array },
): Promise<StorageUploadResult> {
  if (!input.name.trim()) throw new Error("El fichero debe tener nombre");
  if (!input.bytes.length) throw new Error("El fichero está vacío");
  if (input.bytes.length > MAX_PROJECT_UPLOAD_BYTES) throw new Error("El fichero supera el límite de 20 MB");

  const boundary = `hexa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const metadata: Record<string, unknown> = { name: input.name.trim().slice(0, 240) };
  if (config.folder_id) metadata.parents = [config.folder_id];
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${input.mime_type || "application/octet-stream"}\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(prefix.length + input.bytes.length + suffix.length);
  body.set(prefix, 0);
  body.set(input.bytes, prefix.length);
  body.set(suffix, prefix.length + input.bytes.length);

  const response = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,mimeType,size,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireToken(token)}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof (data.error as any)?.message === "string" ? (data.error as any).message : `HTTP ${response.status}`;
    throw new Error(`No se pudo subir a Google Drive: ${detail}`);
  }
  const id = String(data.id ?? "");
  if (!id) throw new Error("Google Drive no devolvió el identificador del fichero");
  return {
    provider: "google_drive",
    remote_id: id,
    name: String(data.name ?? input.name),
    mime_type: String(data.mimeType ?? input.mime_type ?? "application/octet-stream"),
    size: Number(data.size ?? input.bytes.length),
    web_url: String(data.webViewLink ?? `https://drive.google.com/file/d/${id}/view`),
  };
}

export function decodeBase64File(content: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(content, "base64"));
  const binary = atob(content);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
