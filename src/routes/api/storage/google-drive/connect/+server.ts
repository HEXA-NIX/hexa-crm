import { json, type RequestHandler } from "@sveltejs/kit";
import { createGoogleAuthorization, GOOGLE_DRIVE_STATE_COOKIE, googleCookieOptions } from "$lib/storage/google-oauth.server";

export const POST: RequestHandler = async ({ url, cookies }) => {
  try {
    const result = createGoogleAuthorization(url);
    cookies.set(GOOGLE_DRIVE_STATE_COOKIE, result.state, { ...googleCookieOptions, maxAge: 600 });
    return json({ authorization_url: result.authorization_url });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Google Drive no está disponible" }, { status: 503 });
  }
};
