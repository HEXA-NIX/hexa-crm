import { json, type RequestHandler } from "@sveltejs/kit";
import { initDb, postgresApi } from "$lib/api/postgres-db";

const privateHeaders = {
  "Cache-Control": "no-store, private",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function statusFor(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (/no válido|caducado|ya no está disponible/i.test(message)) return 410;
  return /selecciona|tipo de documento/i.test(message) ? 422 : 400;
}

export const GET: RequestHandler = async ({ params }) => {
  try {
    await initDb();
    const token = String(params.token ?? "");
    return json(await postgresApi.whatsapp_upload_preview(token), { headers: privateHeaders });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo abrir el documento" }, { status: statusFor(error), headers: privateHeaders });
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    await initDb();
    const body = await request.json().catch(() => ({})) as { kind?: string; company_id?: number | null };
    const kind = String(body.kind ?? "");
    const companyId = body.company_id == null ? null : Number(body.company_id);
    if (companyId !== null && !Number.isInteger(companyId)) throw new Error("Empresa no válida.");
    const result = await postgresApi.whatsapp_upload_confirm(String(params.token ?? ""), kind, companyId);
    return json(result, { headers: privateHeaders });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo guardar el documento" }, { status: statusFor(error), headers: privateHeaders });
  }
};
