import type { RequestHandler } from "@sveltejs/kit";
import { encodeGoogleCredential, exchangeGoogleCode, GOOGLE_DRIVE_COOKIE, GOOGLE_DRIVE_STATE_COOKIE, googleCookieOptions } from "$lib/storage/google-oauth.server";

function popupResponse(ok: boolean, message: string, status = 200) {
  const payload = JSON.stringify({ type: "hexa-google-drive-oauth", ok, message }).replace(/</g, "\\u003c");
  return new Response(`<!doctype html><meta charset="utf-8"><title>Google Drive</title><p>${ok ? "Google Drive conectado. Ya puedes cerrar esta ventana." : "No se pudo conectar Google Drive."}</p><script>window.opener?.postMessage(${payload}, window.location.origin); window.close();</script>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const GET: RequestHandler = async ({ url, cookies }) => {
  const state = url.searchParams.get("state") ?? "";
  const expected = cookies.get(GOOGLE_DRIVE_STATE_COOKIE) ?? "";
  cookies.delete(GOOGLE_DRIVE_STATE_COOKIE, { path: "/" });
  if (!state || state !== expected) return popupResponse(false, "Estado OAuth inválido", 400);
  const code = url.searchParams.get("code");
  if (!code) return popupResponse(false, url.searchParams.get("error") ?? "Autorización cancelada", 400);
  try {
    const credential = await exchangeGoogleCode(code, url);
    cookies.set(GOOGLE_DRIVE_COOKIE, encodeGoogleCredential(credential), googleCookieOptions);
    return popupResponse(true, "Google Drive conectado");
  } catch (error) {
    return popupResponse(false, error instanceof Error ? error.message : "No se pudo completar OAuth", 500);
  }
};
