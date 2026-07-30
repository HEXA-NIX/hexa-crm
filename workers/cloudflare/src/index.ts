interface Env { DB: D1Database; ASSETS: Fetcher }

type User = { id: number; username: string; display_name: string; role: "admin" | "cajero"; active: number; created_at: string; must_change_password: number; temp_password_issued_at: string | null };

const encoder = new TextEncoder();

function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function error(message: string, status = 400) { return json({ error: message }, status); }
function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function digest(value: string) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
async function tokenHash(token: string) { return digest(`session:${token}`); }
function publicUser(user: User) {
  const { pin_hash: _credentialHash, active, must_change_password, ...safe } = user as User & { pin_hash?: string };
  return { ...safe, active: !!active, must_change_password: !!must_change_password, company_ids: [1] };
}

async function verifyCredential(secret: string, stored: string) {
  const [version, salt, expected] = stored.split("$");
  return version === "v1" && !!salt && expected === await digest(`${salt}:${secret.trim()}`);
}

async function session(env: Env, token: string | null) {
  if (!token) return null;
  return env.DB.prepare(`SELECT u.*, s.active_company_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP`).bind(await tokenHash(token)).first<User & { active_company_id: number }>();
}

function bearer(request: Request, args: Record<string, unknown>) {
  const value = request.headers.get("Authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : typeof args.token === "string" ? args.token : null;
}

async function authenticate(env: Env, request: Request, args: Record<string, unknown>) {
  const current = await session(env, bearer(request, args));
  if (!current || !current.active) throw new Error("Sesión no válida o expirada");
  return current;
}

async function rpc(request: Request, env: Env) {
  let payload: { cmd?: string; args?: Record<string, unknown> };
  try { payload = await request.json(); } catch { return error("JSON no válido"); }
  const cmd = payload.cmd;
  const args = payload.args ?? {};
  if (!cmd) return error("Comando ausente");
  try {
    if (cmd === "public_meta") {
      const row = await env.DB.prepare("SELECT value FROM settings WHERE key='shop_name'").first<{ value: string }>();
      return json({ shop_name: row?.value ?? "Hexa" });
    }
    if (cmd === "login") {
      const username = String(args.username ?? "").trim();
      const password = String(args.password ?? args.pin ?? "");
      const user = await env.DB.prepare("SELECT * FROM users WHERE username=? AND active=1").bind(username).first<User & { pin_hash: string }>();
      if (!user || !(await verifyCredential(password, user.pin_hash))) return error("Usuario o credencial incorrectos", 401);
      const raw = crypto.randomUUID() + crypto.randomUUID();
      const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,active_company_id,expires_at) VALUES(?,?,1,?)").bind(await tokenHash(raw), user.id, expires).run();
      const companies = await env.DB.prepare("SELECT c.* FROM companies c JOIN company_members m ON m.company_id=c.id WHERE m.user_id=? AND c.active=1").bind(user.id).all();
      return json({ user: publicUser(user), token: raw, companies: companies.results, active_company_id: 1 });
    }
    if (cmd === "logout") { const token = bearer(request, args); if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await tokenHash(token)).run(); return json(null); }
    const user = await authenticate(env, request, args);
    const companyId = user.active_company_id;
    if (cmd === "session_me") return json(publicUser(user));
    if (cmd === "list_companies") return json((await env.DB.prepare("SELECT c.* FROM companies c JOIN company_members m ON m.company_id=c.id WHERE m.user_id=? AND c.active=1").bind(user.id).all()).results);
    if (cmd === "get_active_company") return json(await env.DB.prepare("SELECT * FROM companies WHERE id=?").bind(companyId).first());
    if (cmd === "set_active_company") { const id = Number(args.company_id); const member = await env.DB.prepare("SELECT 1 FROM company_members WHERE user_id=? AND company_id=?").bind(user.id, id).first(); if (!member) return error("No tienes acceso a esta empresa", 403); const token = bearer(request,args)!; await env.DB.prepare("UPDATE sessions SET active_company_id=? WHERE token_hash=?").bind(id, await tokenHash(token)).run(); return json(await env.DB.prepare("SELECT * FROM companies WHERE id=?").bind(id).first()); }
    if (cmd === "list_products") return json((await env.DB.prepare("SELECT * FROM products WHERE company_id=? AND (?=0 OR active=1) ORDER BY name").bind(companyId, args.active_only ? 1 : 0).all()).results.map((p: any) => ({ ...p, active: !!p.active })));
    if (cmd === "upsert_product") {
      const input = (args.input ?? {}) as Record<string, unknown>;
      const sku = String(input.sku ?? "").trim();
      const name = String(input.name ?? "").trim();
      if (!sku || !name) return error("SKU y nombre son obligatorios");
      const values = [sku, name, String(input.description ?? ""), String(input.category ?? ""), Number(input.stock ?? 0), Number(input.min_stock ?? 0), Number(input.cost_cents ?? 0), Number(input.price_cents ?? 0), Number(input.vat_rate ?? 21), input.active === false ? 0 : 1];
      const id = Number(input.id ?? 0);
      if (id) {
        const updated = await env.DB.prepare("UPDATE products SET sku=?,name=?,description=?,category=?,stock=?,min_stock=?,cost_cents=?,price_cents=?,vat_rate=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?").bind(...values, id, companyId).run();
        if (!updated.meta.changes) return error("Producto no encontrado", 404);
        return json(await env.DB.prepare("SELECT * FROM products WHERE id=? AND company_id=?").bind(id, companyId).first());
      }
      const created = await env.DB.prepare("INSERT INTO products(company_id,sku,name,description,category,stock,min_stock,cost_cents,price_cents,vat_rate,active) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(companyId, ...values).run();
      return json(await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(created.meta.last_row_id).first());
    }
    if (cmd === "list_customers") return json((await env.DB.prepare("SELECT * FROM customers WHERE company_id=? ORDER BY name").bind(companyId).all()).results);
    if (cmd === "upsert_customer") {
      const input = (args.input ?? {}) as Record<string, unknown>;
      const name = String(input.name ?? "").trim();
      if (!name) return error("El nombre es obligatorio");
      const values = [name, String(input.email ?? ""), String(input.phone ?? ""), String(input.nif ?? ""), String(input.notes ?? "")];
      const id = Number(input.id ?? 0);
      if (id) { const changed = await env.DB.prepare("UPDATE customers SET name=?,email=?,phone=?,nif=?,notes=? WHERE id=? AND company_id=?").bind(...values, id, companyId).run(); if (!changed.meta.changes) return error("Cliente no encontrado", 404); return json(await env.DB.prepare("SELECT * FROM customers WHERE id=? AND company_id=?").bind(id, companyId).first()); }
      const created = await env.DB.prepare("INSERT INTO customers(company_id,name,email,phone,nif,notes) VALUES(?,?,?,?,?,?)").bind(companyId, ...values).run();
      return json(await env.DB.prepare("SELECT * FROM customers WHERE id=?").bind(created.meta.last_row_id).first());
    }
    if (cmd === "get_settings") { const rows = await env.DB.prepare("SELECT key,value FROM settings").all<{key:string;value:string}>(); return json(Object.fromEntries(rows.results.map((x) => [x.key, x.key === "default_vat" || x.key === "idle_timeout_minutes" ? Number(x.value) : x.value]))); }
    if (cmd === "update_settings") {
      if (user.role !== "admin") return error("No autorizado", 403);
      const partial = (args.partial ?? {}) as Record<string, unknown>;
      const permitted = ["shop_name", "ollama_model", "ollama_url", "default_vat", "idle_timeout_minutes"];
      await env.DB.batch(permitted.filter((key) => key in partial).map((key) => env.DB.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, String(partial[key]))));
      const rows = await env.DB.prepare("SELECT key,value FROM settings").all<{key:string;value:string}>();
      return json(Object.fromEntries(rows.results.map((x) => [x.key, x.key === "default_vat" || x.key === "idle_timeout_minutes" ? Number(x.value) : x.value])));
    }
    if (cmd === "dashboard_stats") { const low = await env.DB.prepare("SELECT * FROM products WHERE company_id=? AND active=1 AND stock<=min_stock ORDER BY stock LIMIT 10").bind(companyId).all(); return json({ sales_today_cents: 0, sales_month_cents: 0, sales_today_count: 0, sales_month_count: 0, cash_balance_cents: 0, low_stock: low.results, vat_month_cents: 0, base_month_cents: 0 }); }
    if (cmd === "list_sales") return json((await env.DB.prepare("SELECT s.*, c.name customer_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.company_id=? ORDER BY s.sold_at DESC").bind(companyId).all()).results);
    if (cmd === "list_cash_movements") return json((await env.DB.prepare("SELECT * FROM cash_movements WHERE company_id=? ORDER BY occurred_at DESC").bind(companyId).all()).results);
    if (cmd === "get_cash_balance") { const r = await env.DB.prepare("SELECT COALESCE(SUM(amount_cents),0) value FROM cash_movements WHERE company_id=?").bind(companyId).first<{value:number}>(); return json(r?.value ?? 0); }
    if (cmd === "vat_summary") { const from=String(args.from??"1970-01-01"),to=String(args.to??"9999-12-31"); const rows=await env.DB.prepare("SELECT l.vat_rate,COALESCE(SUM(l.line_base_cents),0) base_cents,COALESCE(SUM(l.line_vat_cents),0) vat_cents,COALESCE(SUM(l.line_total_cents),0) total_cents FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.company_id=? AND s.status='completed' AND s.sold_at>=? AND s.sold_at<=? GROUP BY l.vat_rate ORDER BY l.vat_rate").bind(companyId,from,to).all<any>(); const buckets=rows.results; return json({from,to,buckets,base_cents:buckets.reduce((n:any,x:any)=>n+x.base_cents,0),vat_cents:buckets.reduce((n:any,x:any)=>n+x.vat_cents,0),total_cents:buckets.reduce((n:any,x:any)=>n+x.total_cents,0)}); }
    return error(`Comando no disponible todavía en Cloudflare: ${cmd}`, 501);
  } catch (cause) { return error(cause instanceof Error ? cause.message : "Error interno", 401); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      try { await env.DB.prepare("SELECT 1 AS ok").first(); return json({ ok: true, backend: "cloudflare-d1" }); } catch { return error("D1 no disponible", 503); }
    }
    if (url.pathname === "/api/rpc" && request.method === "POST") return rpc(request, env);
    return env.ASSETS.fetch(request);
  }
};
