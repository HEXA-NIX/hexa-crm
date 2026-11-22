import { json, type RequestHandler } from "@sveltejs/kit";
import { GOOGLE_DRIVE_COOKIE } from "$lib/storage/google-oauth.server";

export const POST: RequestHandler = async ({ cookies }) => {
  cookies.delete(GOOGLE_DRIVE_COOKIE, { path: "/" });
  return json({ connected: false });
};
