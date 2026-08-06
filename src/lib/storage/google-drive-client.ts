import type { StorageUploadInput, StorageUploadResult } from "../types";

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data as T;
}

export async function googleDriveStatus(): Promise<{ connected: boolean }> {
  return responseJson(await fetch("/api/storage/google-drive/status"));
}

export async function connectGoogleDrive(): Promise<void> {
  const { authorization_url } = await responseJson<{ authorization_url: string }>(await fetch("/api/storage/google-drive/connect", { method: "POST" }));
  const popup = window.open(authorization_url, "hexa-google-drive", "popup,width=560,height=720");
  if (!popup) throw new Error("El navegador bloqueó la ventana de Google");
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("La autorización de Google ha caducado"));
    }, 5 * 60_000);
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.data?.type !== "hexa-google-drive-oauth") return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (event.data.ok) resolve();
      else reject(new Error(event.data.message || "Google no autorizó la conexión"));
    }
    window.addEventListener("message", onMessage);
  });
}

export async function disconnectGoogleDrive(): Promise<void> {
  await responseJson(await fetch("/api/storage/google-drive/disconnect", { method: "POST" }));
}

export async function testGoogleDriveConnection(): Promise<{ ok: true; message: string }> {
  return responseJson(await fetch("/api/storage/google-drive/test", { method: "POST" }));
}

export async function uploadGoogleDriveFile(input: StorageUploadInput, folderId = ""): Promise<StorageUploadResult> {
  return responseJson(await fetch("/api/storage/google-drive/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, folder_id: folderId }),
  }));
}
