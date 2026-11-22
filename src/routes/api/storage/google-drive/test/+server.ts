import { json, type RequestHandler } from "@sveltejs/kit";
import { currentGoogleAccessToken, decodeGoogleCredential, encodeGoogleCredential, GOOGLE_DRIVE_COOKIE, googleCookieOptions } from "$lib/storage/google-oauth.server";
import { testGoogleDrive } from "$lib/storage/google-drive";

export const POST: RequestHandler = async ({ cookies }) => {
  const raw = cookies.get(GOOGLE_DRIVE_COOKIE);
  if (!raw) return json({ error: "Conecta Google Drive antes de probarlo" }, { status: 401 });
  try {
    const credential = await currentGoogleAccessToken(decodeGoogleCredential(raw));
    cookies.set(GOOGLE_DRIVE_COOKIE, encodeGoogleCredential(credential), googleCookieOptions);
    return json(await testGoogleDrive(credential.access_token));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Google Drive no responde" }, { status: 400 });
  }
};
