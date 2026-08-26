import { env } from "$env/dynamic/private";

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("El audio descargado no tiene un formato válido");
  return { bytes: new Uint8Array(Buffer.from(match[2], "base64")), mimeType: match[1] };
}

export async function transcribeAudio(dataUrl: string, fileName: string): Promise<string> {
  const endpoint = (env.HEXA_TRANSCRIPTION_URL || "").trim();
  if (!endpoint) throw new Error("La transcripción de audio no está configurada");
  const { bytes, mimeType } = decodeDataUrl(dataUrl);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), fileName || "audio.ogg");
  form.append("model", (env.HEXA_TRANSCRIPTION_MODEL || "whisper-1").trim());
  form.append("language", "es");
  const headers = new Headers();
  const apiKey = (env.HEXA_TRANSCRIPTION_API_KEY || "").trim();
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  let response: Response;
  try {
    response = await fetch(endpoint, { method: "POST", headers, body: form, signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    throw new Error(`No se puede conectar con el transcriptor: ${error instanceof Error ? error.message : "fallo de red"}`);
  }
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(result.error || result.message || `El transcriptor respondió HTTP ${response.status}`));
  const text = String(result.text || result.transcription || "").trim();
  if (!text) throw new Error("El transcriptor no devolvió texto");
  return text.slice(0, 5000);
}
