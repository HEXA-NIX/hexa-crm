interface Env { DB: D1Database; ASSETS: Fetcher }

type User = { id: number; username: string; display_name: string; role: "admin" | "cajero"; active: number; created_at: string; must_change_password: number; temp_password_issued_at: string | null };
type CentralOperator = Pick<User, "id" | "username" | "display_name" | "role" | "must_change_password" | "temp_password_issued_at"> & { company_id: number; tenant_code: string };

const encoder = new TextEncoder();

function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function error(message: string, status = 400) { return json({ error: message }, status); }
function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function digest(value: string) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
async function tokenHash(token: string) { return digest(`session:${token}`); }
async function hashCredential(secret: string) {
  const value = secret.trim();
  if (!value) throw new Error("Credencial vacía");
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const salt = hex(bytes.buffer);
  return `v1$${salt}$${await digest(`${salt}:${value}`)}`;
}
function generateTemporaryPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}
function permanentPasswordError(password: string) {
  const value = password.trim();
  if (value.length < 8) return "La contraseña debe tener al menos 8 caracteres";
  if (value.length > 128) return "La contraseña es demasiado larga";
  return null;
}
function publicUser(user: User) {
  const { pin_hash: _credentialHash, active, must_change_password, ...safe } = user as User & { pin_hash?: string };
  return { ...safe, active: !!active, must_change_password: !!must_change_password, company_ids: [1] };
}
function publicUserWithCompanies(user: User, companyIds: number[]) {
  return { ...publicUser(user), company_ids: companyIds };
}

async function verifyCredential(secret: string, stored: string) {
  const [version, salt, expected] = stored.split("$");
  return version === "v1" && !!salt && expected === await digest(`${salt}:${secret.trim()}`);
}

async function session(env: Env, token: string | null) {
  if (!token) return null;
  return env.DB.prepare(`SELECT u.*, s.active_company_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP`).bind(await tokenHash(token)).first<User & { active_company_id: number }>();
}

function operatorPayload(operator: CentralOperator) {
  return {
    id: String(operator.id),
    username: operator.username,
    display_name: operator.display_name,
    role: operator.role,
    must_change_password: !!operator.must_change_password,
    temp_password_issued_at: operator.temp_password_issued_at
  };
}

async function centralOperatorSession(env: Env, token: string | null) {
  if (!token) return null;
  return env.DB.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.must_change_password,
           u.temp_password_issued_at, s.active_company_id AS company_id, c.code AS tenant_code
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN companies c ON c.id = s.active_company_id
    WHERE s.token_hash = ?
      AND datetime(s.expires_at) > CURRENT_TIMESTAMP
      AND u.active = 1
      AND c.active = 1
  `).bind(await tokenHash(token)).first<CentralOperator>();
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
      const issuedAt = user.temp_password_issued_at ? Date.parse(user.temp_password_issued_at) : Number.NaN;
      if (user.must_change_password && (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 24 * 60 * 60 * 1000)) {
        return error("La contraseña temporal ha caducado. Contacta al administrador.", 401);
      }
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
    if (cmd === "list_users") {
      if (user.role !== "admin") return error("No autorizado", 403);
      const rows = await env.DB.prepare(`
        SELECT u.*, GROUP_CONCAT(m.company_id) AS company_ids
        FROM users u JOIN company_members m ON m.user_id=u.id
        WHERE m.company_id=? GROUP BY u.id ORDER BY u.username COLLATE NOCASE
      `).bind(companyId).all<User & { company_ids: string }>();
      return json(rows.results.map((row) => publicUserWithCompanies(row, row.company_ids.split(",").map(Number))));
    }
    if (cmd === "upsert_user") {
      if (user.role !== "admin") return error("No autorizado", 403);
      const input = (args.input ?? {}) as Record<string, unknown>;
      const username = String(input.username ?? "").trim().toLowerCase();
      if (!username) return error("Usuario obligatorio");
      const displayName = String(input.display_name ?? "").trim() || username;
      const role = input.role === "cajero" ? "cajero" : "admin";
      const requested = Array.from(new Set((Array.isArray(input.company_ids) ? input.company_ids : [companyId]).map(Number).filter(Number.isInteger)));
      if (!requested.length) return error("Selecciona al menos una empresa");
      const available = await env.DB.prepare("SELECT company_id FROM company_members WHERE user_id=?").bind(user.id).all<{ company_id: number }>();
      const availableIds = available.results.map((row) => row.company_id);
      if (requested.some((id) => !availableIds.includes(id))) return error("No puedes asignar una empresa a la que no tienes acceso", 403);
      const id = Number(input.id ?? 0);
      const duplicate = await env.DB.prepare("SELECT id FROM users WHERE username=? AND id<>?").bind(username, id).first<{ id: number }>();
      if (duplicate) return error("Ese nombre de usuario ya existe", 409);
      if (id) {
        const target = await env.DB.prepare("SELECT u.* FROM users u JOIN company_members m ON m.user_id=u.id WHERE u.id=? AND m.company_id=?").bind(id, companyId).first<User & { pin_hash: string }>();
        if (!target) return error("Usuario no encontrado", 404);
        const targetMemberships = await env.DB.prepare("SELECT company_id FROM company_members WHERE user_id=?").bind(id).all<{ company_id: number }>();
        const affectedCompanyIds = Array.from(new Set([...targetMemberships.results.map((row) => row.company_id).filter((company) => availableIds.includes(company)), ...requested]));
        const proposedActive = input.active === false ? 0 : 1;
        for (const affectedCompanyId of affectedCompanyIds) {
          const otherAdmins = await env.DB.prepare(`
            SELECT COUNT(*) AS count FROM company_members m JOIN users u ON u.id=m.user_id
            WHERE m.company_id=? AND u.id<>? AND u.active=1 AND u.role='admin'
          `).bind(affectedCompanyId, id).first<{ count: number }>();
          const targetRemainsAdmin = requested.includes(affectedCompanyId) && role === "admin" && proposedActive === 1;
          if (!targetRemainsAdmin && !Number(otherAdmins?.count)) return error("Debe quedar al menos un administrador activo por empresa");
        }
        let credential = target.pin_hash;
        let mustChange = target.must_change_password;
        let issuedAt = target.temp_password_issued_at;
        let temporary_password: string | undefined;
        if (input.pin === "__regen_temp__") { temporary_password = generateTemporaryPassword(); credential = await hashCredential(temporary_password); mustChange = 1; issuedAt = new Date().toISOString(); }
        else if (typeof input.pin === "string" && input.pin.trim()) { const invalid = permanentPasswordError(input.pin); if (invalid) return error(invalid); credential = await hashCredential(input.pin); mustChange = 0; issuedAt = null; }
        const statements: D1PreparedStatement[] = [
          env.DB.prepare("UPDATE users SET username=?,display_name=?,role=?,active=?,pin_hash=?,must_change_password=?,temp_password_issued_at=? WHERE id=?").bind(username, displayName, role, proposedActive, credential, mustChange, issuedAt, id),
          env.DB.prepare(`DELETE FROM company_members WHERE user_id=? AND company_id IN (${availableIds.map(() => "?").join(",")})`).bind(id, ...availableIds),
          ...requested.map((company_id) => env.DB.prepare("INSERT INTO company_members(company_id,user_id,role) VALUES(?,?,?)").bind(company_id, id, role))
        ];
        await env.DB.batch(statements);
        const updated = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first<User>();
        return json({ user: publicUserWithCompanies(updated!, requested), ...(temporary_password ? { temporary_password } : {}) });
      }
      const temporary_password = generateTemporaryPassword();
      const issuedAt = new Date().toISOString();
      const created = await env.DB.prepare("INSERT INTO users(username,display_name,role,pin_hash,active,must_change_password,temp_password_issued_at) VALUES(?,?,?,?,?,?,?)").bind(username, displayName, role, await hashCredential(temporary_password), input.active === false ? 0 : 1, 1, issuedAt).run();
      const userId = Number(created.meta.last_row_id);
      await env.DB.batch(requested.map((company_id) => env.DB.prepare("INSERT INTO company_members(company_id,user_id,role) VALUES(?,?,?)").bind(company_id, userId, role)));
      const createdUser = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(userId).first<User>();
      return json({ user: publicUserWithCompanies(createdUser!, requested), temporary_password });
    }
    if (cmd === "change_own_pin") {
      const current = String(args.current_pin ?? "");
      const next = String(args.new_pin ?? "");
      const stored = await env.DB.prepare("SELECT pin_hash FROM users WHERE id=?").bind(user.id).first<{ pin_hash: string }>();
      if (!stored || !(await verifyCredential(current, stored.pin_hash))) return error("Contraseña actual incorrecta", 401);
      if (!/^\d{4,8}$/.test(next.trim()) && permanentPasswordError(next)) return error(permanentPasswordError(next)!);
      await env.DB.prepare("UPDATE users SET pin_hash=?,must_change_password=0,temp_password_issued_at=NULL WHERE id=?").bind(await hashCredential(next), user.id).run();
      return json(null);
    }
    if (cmd === "complete_forced_password_change") {
      const current = String(args.current_password ?? "");
      const next = String(args.new_password ?? "");
      const stored = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(user.id).first<User & { pin_hash: string }>();
      if (!stored?.must_change_password) return error("No hay cambio de contraseña pendiente");
      const issuedAt = stored.temp_password_issued_at ? Date.parse(stored.temp_password_issued_at) : Number.NaN;
      if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 24 * 60 * 60 * 1000) return error("La contraseña temporal ha caducado. Contacta al administrador.", 401);
      if (!(await verifyCredential(current, stored.pin_hash))) return error("Contraseña temporal incorrecta", 401);
      const invalid = permanentPasswordError(next);
      if (invalid) return error(invalid);
      if (next.trim() === current.trim()) return error("La nueva contraseña debe ser distinta a la temporal");
      await env.DB.prepare("UPDATE users SET pin_hash=?,must_change_password=0,temp_password_issued_at=NULL WHERE id=?").bind(await hashCredential(next), user.id).run();
      const updated = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(user.id).first<User>();
      return json(publicUser(updated!));
    }
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

async function centralLogin(request: Request, env: Env) {
  let input: { tenant_code?: unknown; username?: unknown; password?: unknown };
  try { input = await request.json(); } catch { return error("Solicitud inválida", 400); }

  const tenantCode = typeof input.tenant_code === "string" ? input.tenant_code.trim().toUpperCase() : "";
  const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!tenantCode || !username || !password) return error("Faltan credenciales", 400);

  const operator = await env.DB.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.pin_hash, u.must_change_password,
           u.temp_password_issued_at, c.id AS company_id, c.code AS tenant_code
    FROM users u
    JOIN company_members m ON m.user_id = u.id
    JOIN companies c ON c.id = m.company_id
    WHERE c.code = ? AND c.active = 1 AND u.username = ? AND u.active = 1
  `).bind(tenantCode, username).first<CentralOperator & { pin_hash: string }>();
  if (!operator || !(await verifyCredential(password, operator.pin_hash))) return error("Usuario o contraseña incorrectos", 401);

  // A password that was issued temporarily expires after 24 hours, matching the
  // central API policy. Old/malformed dates fail closed.
  const issuedAt = operator.temp_password_issued_at ? Date.parse(operator.temp_password_issued_at) : Number.NaN;
  if (operator.must_change_password && (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 24 * 60 * 60 * 1000)) {
    return error("La contraseña temporal ha caducado. Contacta al administrador.", 401);
  }

  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= CURRENT_TIMESTAMP"),
    env.DB.prepare("INSERT INTO sessions(token_hash,user_id,active_company_id,expires_at) VALUES(?,?,?,?)").bind(await tokenHash(token), operator.id, operator.company_id, expiresAt)
  ]);
  return json({ token, expires_at: expiresAt, operator: operatorPayload(operator), tenant_code: operator.tenant_code });
}

async function centralMe(request: Request, env: Env) {
  const operator = await centralOperatorSession(env, bearer(request, {}));
  if (!operator) return error("Sesión de operador no válida", 401);
  return json({ operator: operatorPayload(operator), company_id: operator.company_id });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      try { await env.DB.prepare("SELECT 1 AS ok").first(); return json({ ok: true, backend: "cloudflare-d1" }); } catch { return error("D1 no disponible", 503); }
    }
    if (url.pathname === "/api/v1/operator/login" && request.method === "POST") return centralLogin(request, env);
    if (url.pathname === "/api/v1/operator/me" && request.method === "GET") return centralMe(request, env);
    if (url.pathname === "/api/rpc" && request.method === "POST") return rpc(request, env);
    return env.ASSETS.fetch(request);
  }
};
