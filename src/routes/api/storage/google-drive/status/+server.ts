import { json, type RequestHandler } from "@sveltejs/kit";
import { decodeGoogleCredential, GOOGLE_DRIVE_COOKIE } from "$lib/storage/google-oauth.server";

export const GET: RequestHandler = async ({ cookies }) => {
  const raw = cookies.get(GOOGLE_DRIVE_COOKIE);
  if (!raw) return json({ connected: false });
  try {
    const credential = decodeGoogleCredential(raw);
    return json({ connected: !!credential.refresh_token });
  } catch {
    return json({ connected: false });
  }
};
