import { json, type RequestHandler } from "@sveltejs/kit";
import { currentGoogleAccessToken, decodeGoogleCredential, encodeGoogleCredential, GOOGLE_DRIVE_COOKIE, googleCookieOptions } from "$lib/storage/google-oauth.server";
import { decodeBase64File, uploadToGoogleDrive } from "$lib/storage/google-drive";

export const POST: RequestHandler = async ({ request, cookies }) => {
  const raw = cookies.get(GOOGLE_DRIVE_COOKIE);
  if (!raw) return json({ error: "Conecta Google Drive antes de subir archivos" }, { status: 401 });
  try {
    const input = await request.json();
    const credential = await currentGoogleAccessToken(decodeGoogleCredential(raw));
    cookies.set(GOOGLE_DRIVE_COOKIE, encodeGoogleCredential(credential), googleCookieOptions);
    const result = await uploadToGoogleDrive({ folder_id: String(input.folder_id ?? "") }, credential.access_token, {
      name: String(input.name ?? ""),
      mime_type: String(input.mime_type ?? "application/octet-stream"),
      bytes: decodeBase64File(String(input.content_base64 ?? "")),
    });
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo subir el fichero" }, { status: 400 });
  }
};
