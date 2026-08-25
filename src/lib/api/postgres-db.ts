import postgres from "postgres";
import { createHash, randomBytes } from "node:crypto";
import { hashCredential, hashPin, verifyCredential } from "../auth/pin";
import { browserApi } from "./browser-store";
import {
  clearTempCredentialFields,
  generateTempPassword,
  issueTempCredentialFields,
  shouldRejectExpiredTemp,
  validatePermanentPassword,
} from "../auth/password-policy";
import { sha256HexSync, validatePin } from "../auth/pin";
import { createVerifactuRecord, verifyVerifactuChain } from "../verifactu/records";
import { extractOllamaReply, ollamaChatBody } from "../ai/ollama-reply";
import { isVatRate, lineBreakdown, type VatRate } from "../vat";
import {
  createBackupEnvelope,
  createPreMigrationBackup,
  validateBackup,
  type BackupEnvelope,
} from "../backup/backup";
import {
  encryptSecret,
  decryptSecret,
} from "../plugins/secret-vault";
import type {
  AiChatResult,
  AiMessage,
  Budget,
  BudgetInput,
  BudgetStatus,
  AuthUser,
  ClientPortalProject,
  CashInput,
  CashMovement,
  Company,
  CompanyInput,
  CreateInventoryMovementInput,
  CreateUserResult,
  Customer,
  CustomerInput,
  ExpenseDocument,
  ExpenseDocumentInput,
  FiscalProfile,
  Invoice,
  InvoiceInput,
  InvoicePayment,
  InvoicePaymentInput,
  ExpensePayment,
  ExpensePaymentInput,
  Employee,
  EmployeeInput,
  Payroll,
  PayrollInput,
  Model303Draft,
  DashboardStats,
  InventoryMovement,
  LoginResult,
  Product,
  ProductInput,
  PluginAuditLogEntry,
  PluginConfig,
  PluginKey,
  PluginLogResult,
  PluginTestResult,
  PluginToolResult,
  ReturnLineInput,
  Sale,
  SaleLineInput,
  Settings,
  StorageUploadInput,
  StorageUploadResult,
  StockBalance,
  StockLocation,
  TenantPlugin,
  UserInput,
  VatSummary,
  VerifactuRecord,
  Warehouse,
  WorkCategory,
  WorkItem,
  WorkItemFilters,
  WorkItemInput,
  WorkMember,
  WorkProject,
  WorkProjectInput,
  WorkProjectRequest,
} from "../types";
import { buildModel303Draft } from "../taxes/model303";
import { deriveTaxModels, normalizeTaxSetup } from "../taxes/models";
import { buildInvoiceFromSale, buildManualInvoice, buildRectifyingInvoice } from "../invoicing/invoice";
import {
  billingByCompany,
  canAccessCompany,
  companiesForUser,
  companiesVisibleToUser,
  pickDefaultCompanyId,
  seedCompanies,
  seedCompanyMembers,
} from "../company/context";
import { planPartialReturn, remainingLineAmounts } from "../sales/partial-return";
import {
  PLUGIN_CATALOG,
  pluginDefinition,
  redactSensitive,
  sanitizePluginConfig,
  stripeToolAccess,
} from "../plugins/catalog";
import { normalizeProjectDocuments, validateProjectDocuments } from "../projects/project-documents";
import { normalizeProjectBrief, normalizeProjectPrd, normalizeTechStack } from "../projects/project-brief";
import { normalizeProjectManagement } from "../projects/management";
import { validateProjectLogo } from "../projects/project-logo";
import { validateUserAvatar } from "../users/user-avatar";
import { decodeBase64File, testGoogleDrive, uploadToGoogleDrive } from "../storage/google-drive";
import { gowaDeviceId, gowaDownloadMessageMedia, gowaLatestMedia, gowaLoginQr, gowaLogout, gowaSendExpenseTypePoll, gowaSendText, gowaStatus, normalizeWhatsAppPhone } from "../whatsapp/gowa.server";
import { extractExpenseHints } from "../expenses/ocr";
import { extractExpenseFromImage } from "../expenses/vision.server";
import {
  callStripeTool,
  listStripeTools,
  pluginSecretConfigured,
  testDatabasePlugin,
  testStripePlugin,
} from "../plugins/runtime.server";
import {
  validateProductPublicationInvariants,
  validateProductFields,
  resolveDefaultsForNewProduct,
} from "../inventory/publication-rules";

// Prefer Vite/SvelteKit private env; fall back to process.env and local Docker defaults.
function resolveDatabaseUrl(): string {
  const fromProcess =
    (typeof process !== "undefined" && process.env?.DATABASE_URL) || "";
  if (fromProcess) return fromProcess;
  // Default: Docker container `nix-c-postgres` (pgvector on host 5432)
  return "postgresql://hakos:nix_password@127.0.0.1:5432/nix_crm";
}

const DATABASE_URL = resolveDatabaseUrl();
// systemd's EnvironmentFile does not strip inline comments the same way
// dotenv does. Normalize the value so `HEXA_CENTRAL_MODE=1 # comment` cannot
// accidentally disable the central safety rails in production.
export const CENTRAL_MODE = typeof process !== "undefined" &&
  String(process.env?.HEXA_CENTRAL_MODE ?? "").trim().split(/\s+#/, 1)[0] === "1";
export const CENTRAL_SCHEMA_VERSION = "0014_master_profile";

// Settings predates the multi-company model and used a single key namespace.
// Keep those legacy keys as read-only fallbacks, but write all tenant-owned
// values under a company prefix so changing one company cannot alter another.
function companySettingKey(companyId: number, key: string): string {
  return `company:${companyId}:${key}`;
}

function settingValue(rows: readonly any[], companyId: number, key: string, fallback = ""): string {
  return rows.find((row) => row.key === companySettingKey(companyId, key))?.value
    ?? rows.find((row) => row.key === key)?.value
    ?? fallback;
}

const EXPENSE_TYPE_TEXT_FALLBACK = "He recibido el documento 📎. Responde con una opción:\n1. TICKET\n2. FACTURA\n3. FACTURA SIMPLIFICADA\n4. ABONO\n5. JUSTIFICANTE";

async function sendExpenseTypePrompt(deviceId: string, phone: string): Promise<void> {
  try {
    await gowaSendExpenseTypePoll(deviceId, phone);
  } catch (error) {
    // Keep ingestion usable with an older/unpatched GOWA installation.
    console.warn("WhatsApp poll unavailable; using text fallback", error);
    await gowaSendText(deviceId, phone, EXPENSE_TYPE_TEXT_FALLBACK);
  }
}

const WHATSAPP_UPLOAD_LINK_TTL_MINUTES = 30;

function publicAppUrl(): string {
  // Deliberately do not fall back to VITE_PUBLIC_APP_URL: older installations
  // often contain localhost/private addresses that would create dead links.
  const configured = String(process.env.HEXA_PUBLIC_APP_URL || "").trim();
  if (!configured) throw new Error("Falta configurar HEXA_PUBLIC_APP_URL para los enlaces públicos de WhatsApp.");
  let parsed: URL;
  try { parsed = new URL(configured); } catch { throw new Error("HEXA_PUBLIC_APP_URL no es una URL válida."); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("HEXA_PUBLIC_APP_URL debe usar HTTP o HTTPS.");
  return parsed.toString().replace(/\/+$/, "");
}

async function createWhatsAppUploadLink(pendingId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await sql`
    INSERT INTO whatsapp_expense_links (token_hash,pending_id,expires_at)
    VALUES (${tokenHash},${pendingId},NOW() + (${WHATSAPP_UPLOAD_LINK_TTL_MINUTES} || ' minutes')::interval)
    ON CONFLICT (pending_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,used_at=NULL
  `;
  return `${publicAppUrl()}/recibir/${token}`;
}

async function resolveWhatsAppUploadLink(token: string) {
  const normalized = String(token || "").trim();
  if (!/^[A-Za-z0-9_-]{40,}$/.test(normalized)) throw new Error("Enlace de documento no válido.");
  const tokenHash = createHash("sha256").update(normalized).digest("hex");
  const rows = await sql`
    SELECT l.token_hash,l.pending_id,l.expires_at,l.used_at,p.*
    FROM whatsapp_expense_links l
    INNER JOIN whatsapp_expense_pending p ON p.id=l.pending_id
    WHERE l.token_hash=${tokenHash}
    LIMIT 1
  `;
  if (!rows.length) throw new Error("Enlace de documento no válido o caducado.");
  const row = rows[0];
  if (row.used_at || new Date(row.expires_at).getTime() <= Date.now()) throw new Error("Este enlace ya no está disponible.");
  return row;
}

let sql: postgres.Sql;

if (globalThis as any) {
  if (!(globalThis as any)._postgres_sql) {
    (globalThis as any)._postgres_sql = postgres(DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  sql = (globalThis as any)._postgres_sql;
} else {
  sql = postgres(DATABASE_URL);
}

export { sql };

function toIso(d: Date | string | null | undefined): string {
  if (!d) return "";
  if (typeof d === "string") return d;
  return d.toISOString();
}

// -------------------------------------------------------------
// DDL & Migrations
// -------------------------------------------------------------
export async function initDb() {
  // Asegurar extensión pgvector
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      legal_name TEXT NOT NULL,
      trade_name TEXT NOT NULL,
      nif TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'generic',
      entity_type TEXT NOT NULL DEFAULT 'otra',
      address TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT 'España',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      logo_data_url TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;
  // Backward-compatible migration for databases created before company
  // branding was introduced.
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_data_url TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'otra'`;
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS postal_code TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS province TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'España'`;
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`;
  await sql`
    CREATE TABLE IF NOT EXISTS service_request_replays (
      key_id TEXT NOT NULL,
      signature TEXT NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      PRIMARY KEY (key_id, signature)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS fiscal_profiles (
      company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      invoice_series TEXT NOT NULL DEFAULT 'F',
      regime TEXT NOT NULL DEFAULT 'general',
      period TEXT NOT NULL DEFAULT 'quarterly',
      entity_type TEXT NOT NULL DEFAULT 'autonomo',
      tax_models JSONB NOT NULL DEFAULT '[]'::jsonb,
      tax_setup JSONB NOT NULL DEFAULT '{}'::jsonb,
      profile_completed BOOLEAN NOT NULL DEFAULT FALSE,
      irpf_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      default_irpf_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      sii_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      verifactu_mode TEXT NOT NULL DEFAULT 'disabled',
      verifactu_software_id TEXT NOT NULL DEFAULT 'hexa-crm',
      verifactu_software_name TEXT NOT NULL DEFAULT 'Hexa CRM',
      verifactu_software_version TEXT NOT NULL DEFAULT '0.3.2',
      verifactu_producer_name TEXT NOT NULL DEFAULT '',
      verifactu_producer_nif TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS verifactu_mode TEXT NOT NULL DEFAULT 'disabled'`;
  await sql`ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS invoice_series TEXT NOT NULL DEFAULT 'F'`;
  await sql`ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS verifactu_software_id TEXT NOT NULL DEFAULT 'hexa-crm'`;
  await sql`ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS verifactu_software_name TEXT NOT NULL DEFAULT 'Hexa CRM'`;
  await sql`ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS verifactu_software_version TEXT NOT NULL DEFAULT '0.3.2'`;
  await sql`ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS verifactu_producer_name TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS verifactu_producer_nif TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'autonomo'`;
  await sql`ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS tax_models JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS tax_setup JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`
    CREATE TABLE IF NOT EXISTS operator_accounts (
      id UUID PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('admin', 'cajero')),
      credential_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, username)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS operator_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES operator_accounts(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS operator_sessions_expiry_idx ON operator_sessions (expires_at)`;
  await sql`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      operation TEXT NOT NULL,
      key TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      response JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, operation, key)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS service_audit_log (
      id BIGSERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      key_id TEXT NOT NULL,
      action TEXT NOT NULL,
      request_id TEXT NOT NULL,
      correlation_id TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS semantic_documents (
      id UUID PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('product', 'evidence', 'proposal', 'review')),
      entity_id TEXT NOT NULL,
      document_version TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      embedding vector(768),
      embedding_status TEXT NOT NULL DEFAULT 'pending' CHECK (embedding_status IN ('pending', 'ready', 'failed')),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, entity_type, entity_id, document_version)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS semantic_metrics (
      id BIGSERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      operation TEXT NOT NULL CHECK (operation IN ('index', 'search')),
      outcome TEXT NOT NULL CHECK (outcome IN ('ready', 'failed')),
      latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
      queue_depth INTEGER NOT NULL DEFAULT 0 CHECK (queue_depth >= 0),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS semantic_metrics_tenant_created_idx ON semantic_metrics (company_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS semantic_documents_tenant_entity_idx ON semantic_documents (company_id, entity_type, updated_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS reservations (
      id UUID PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('reserved', 'cancelled', 'expired', 'confirmed')),
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      external_customer_id TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      cancelled_at TIMESTAMP WITH TIME ZONE
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS company_members (
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'cajero',
      PRIMARY KEY (company_id, user_id)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      tax_id TEXT NOT NULL DEFAULT '', social_security_number TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT '', contract_type TEXT NOT NULL DEFAULT '', work_schedule TEXT NOT NULL DEFAULT '',
      collective_agreement TEXT NOT NULL DEFAULT '', professional_group TEXT NOT NULL DEFAULT '', start_date DATE, end_date DATE,
      annual_gross_cents INTEGER NOT NULL DEFAULT 0, payments_per_year INTEGER NOT NULL DEFAULT 12, iban TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','leave','ended')), notes TEXT NOT NULL DEFAULT '',
      documents JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id, status, last_name)`;
  await sql`
    CREATE TABLE IF NOT EXISTS payrolls (
      id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE, period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
      gross_cents INTEGER NOT NULL DEFAULT 0, employee_ss_cents INTEGER NOT NULL DEFAULT 0, irpf_cents INTEGER NOT NULL DEFAULT 0,
      other_deductions_cents INTEGER NOT NULL DEFAULT 0, net_cents INTEGER NOT NULL DEFAULT 0, employer_ss_cents INTEGER NOT NULL DEFAULT 0,
      total_cost_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewed','paid','cancelled')),
      document_name TEXT NOT NULL DEFAULT '', document_url TEXT NOT NULL DEFAULT '', paid_at TIMESTAMPTZ,
      cash_movement_id INTEGER, notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(company_id, employee_id, period)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_payrolls_company_period ON payrolls(company_id, period DESC)`;

  // Crear tablas
  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 0,
      cost_cents INTEGER NOT NULL DEFAULT 0,
      price_cents INTEGER NOT NULL DEFAULT 0,
      vat_rate INTEGER NOT NULL DEFAULT 21,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      embedding vector(384),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS reservation_lines (
      reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      qty INTEGER NOT NULL CHECK (qty > 0),
      PRIMARY KEY (reservation_id, product_id)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      reservation_id UUID UNIQUE REFERENCES reservations(id) ON DELETE RESTRICT,
      external_customer_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'processing', 'shipped', 'completed', 'cancelled')),
      total_cents INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS order_lines (
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      qty INTEGER NOT NULL CHECK (qty > 0),
      unit_price_cents INTEGER NOT NULL,
      vat_rate INTEGER NOT NULL DEFAULT 21,
      PRIMARY KEY (order_id, product_id)
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      ref_type TEXT,
      ref_id INTEGER,
      ref_key TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      nif TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS external_customer_identities (
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, source, external_user_id)
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      number TEXT NOT NULL UNIQUE,
      sold_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      subtotal_cents INTEGER NOT NULL,
      vat_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'completed'
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sale_lines (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      qty INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      vat_rate INTEGER NOT NULL,
      line_base_cents INTEGER NOT NULL,
      line_vat_cents INTEGER NOT NULL,
      line_total_cents INTEGER NOT NULL
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS cash_movements (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'otros',
      description TEXT NOT NULL DEFAULT '',
      sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
      project_id INTEGER,
      occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS expense_documents (
      id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'review', kind TEXT NOT NULL DEFAULT 'invoice', title TEXT NOT NULL,
      supplier_name TEXT NOT NULL DEFAULT '', supplier_tax_id TEXT NOT NULL DEFAULT '', invoice_number TEXT NOT NULL DEFAULT '',
      issued_at DATE, accounting_date DATE, due_at DATE, deductible BOOLEAN NOT NULL DEFAULT TRUE, deduction_period TEXT, project_id INTEGER,
      category TEXT NOT NULL DEFAULT 'otros', base_cents INTEGER NOT NULL DEFAULT 0, vat_rate INTEGER NOT NULL DEFAULT 21,
      vat_cents INTEGER NOT NULL DEFAULT 0, withholding_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR', notes TEXT NOT NULL DEFAULT '', attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      paid_cents INTEGER NOT NULL DEFAULT 0, payment_status TEXT NOT NULL DEFAULT 'pending', source TEXT NOT NULL DEFAULT 'manual', source_phone TEXT, ocr_confidence NUMERIC, created_by INTEGER NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), approved_at TIMESTAMP WITH TIME ZONE
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_expense_documents_company ON expense_documents(company_id, created_at DESC)`;
  await sql`ALTER TABLE expense_documents ADD COLUMN IF NOT EXISTS accounting_date DATE`;
  await sql`ALTER TABLE expense_documents ADD COLUMN IF NOT EXISTS deductible BOOLEAN NOT NULL DEFAULT TRUE`;
  await sql`ALTER TABLE expense_documents ADD COLUMN IF NOT EXISTS deduction_period TEXT`;
  await sql`ALTER TABLE expense_documents ADD COLUMN IF NOT EXISTS paid_cents INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE expense_documents ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'`;
  await sql`
    CREATE TABLE IF NOT EXISTS expense_payments (
      id SERIAL PRIMARY KEY, expense_id INTEGER NOT NULL REFERENCES expense_documents(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      paid_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), method TEXT NOT NULL DEFAULT 'bank_transfer', notes TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_expense_payments_expense ON expense_payments(expense_id, paid_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
      series TEXT NOT NULL DEFAULT 'F', number TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'complete', status TEXT NOT NULL DEFAULT 'issued',
      issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), due_at DATE,
      seller_legal_name TEXT NOT NULL DEFAULT '', seller_nif TEXT NOT NULL DEFAULT '', seller_trade_name TEXT NOT NULL DEFAULT '',
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL, customer_name TEXT NOT NULL DEFAULT '', customer_nif TEXT NOT NULL DEFAULT '', customer_email TEXT NOT NULL DEFAULT '',
      lines JSONB NOT NULL DEFAULT '[]'::jsonb, base_cents INTEGER NOT NULL DEFAULT 0, vat_cents INTEGER NOT NULL DEFAULT 0,
      irpf_rate NUMERIC(5,2) NOT NULL DEFAULT 0, irpf_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0,
      paid_cents INTEGER NOT NULL DEFAULT 0, payment_status TEXT NOT NULL DEFAULT 'pending', operation_date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, series, number)
    );
  `;
  await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS operation_date DATE NOT NULL DEFAULT CURRENT_DATE`;
  await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_cents INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'`;
  await sql`CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id, issued_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      paid_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), method TEXT NOT NULL DEFAULT 'bank_transfer', notes TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id, paid_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS budgets (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      series TEXT NOT NULL DEFAULT 'E', number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired','invoiced','cancelled')),
      operation_date DATE NOT NULL DEFAULT CURRENT_DATE, due_at DATE,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      customer_name TEXT NOT NULL DEFAULT '', customer_nif TEXT NOT NULL DEFAULT '', customer_email TEXT NOT NULL DEFAULT '',
      project_explanation TEXT NOT NULL DEFAULT '', lines JSONB NOT NULL DEFAULT '[]'::jsonb,
      base_cents INTEGER NOT NULL DEFAULT 0, vat_cents INTEGER NOT NULL DEFAULT 0,
      irpf_rate NUMERIC(5,2) NOT NULL DEFAULT 0, irpf_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT '', account TEXT NOT NULL DEFAULT '', tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes TEXT NOT NULL DEFAULT '', invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
      created_by INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accepted_at TIMESTAMPTZ, rejected_at TIMESTAMPTZ, converted_at TIMESTAMPTZ,
      UNIQUE(company_id, series, number)
    );
  `;
  await sql`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS project_explanation TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS global_discount_type TEXT NOT NULL DEFAULT 'percent'`;
  await sql`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS global_discount_value NUMERIC(12,2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0`;
  await sql`CREATE INDEX IF NOT EXISTS idx_budgets_company ON budgets(company_id, operation_date DESC, id DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS verifactu_records (
      id BIGSERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, record_type TEXT NOT NULL,
      issuer_nif TEXT NOT NULL, issuer_name TEXT NOT NULL DEFAULT '', invoice_series TEXT NOT NULL,
      invoice_number TEXT NOT NULL, invoice_date DATE NOT NULL, invoice_type TEXT NOT NULL,
      vat_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0,
      previous_hash TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL, generated_at TIMESTAMPTZ NOT NULL,
      mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'generated', qr_url TEXT NOT NULL DEFAULT '',
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb, error TEXT
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_verifactu_records_company ON verifactu_records(company_id, id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_expense_pending (
      id BIGSERIAL PRIMARY KEY, company_id BIGINT, user_id BIGINT NOT NULL,
      device_id TEXT NOT NULL, message_id TEXT NOT NULL, chat_jid TEXT NOT NULL,
      from_phone TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', media_type TEXT NOT NULL DEFAULT 'image',
      status TEXT NOT NULL DEFAULT 'awaiting_type', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (device_id, message_id)
    )
  `;
  await sql`ALTER TABLE whatsapp_expense_pending ALTER COLUMN company_id DROP NOT NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_expense_links (
      token_hash TEXT PRIMARY KEY,
      pending_id BIGINT NOT NULL REFERENCES whatsapp_expense_pending(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (pending_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_expense_links_expiry ON whatsapp_expense_links(expires_at)`;
  await sql`
    CREATE TABLE IF NOT EXISTS company_whatsapp_links (
      company_id BIGINT PRIMARY KEY, phone TEXT NOT NULL, device_id TEXT NOT NULL,
      linked_by BIGINT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_company_whatsapp_links_phone ON company_whatsapp_links(phone)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_company_whatsapp_links_device ON company_whatsapp_links(device_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_data_url TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'cajero',
      pin_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      temp_password_issued_at TIMESTAMP WITH TIME ZONE,
      is_master BOOLEAN NOT NULL DEFAULT FALSE
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tenant_plugins (
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      plugin_key TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_error TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, plugin_key)
    )
  `;
  await sql`ALTER TABLE tenant_plugins ADD COLUMN IF NOT EXISTS encrypted_secret TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS plugin_audit_log (
      id BIGSERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      plugin_key TEXT NOT NULL,
      action TEXT NOT NULL,
      tool_name TEXT,
      result TEXT NOT NULL DEFAULT 'ok',
      summary TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE plugin_audit_log ADD COLUMN IF NOT EXISTS result TEXT NOT NULL DEFAULT 'ok'`;
  await sql`ALTER TABLE plugin_audit_log ADD COLUMN IF NOT EXISTS summary TEXT`;

  // Multi-empresa columns (idempotent)
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_company_id INTEGER`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_master BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data_url TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS company_id INTEGER NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_id INTEGER NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS company_id INTEGER NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS company_id INTEGER NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS project_id INTEGER`;
  // Central catalog metadata. Existing local products remain published by default.
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS publication_status TEXT NOT NULL DEFAULT 'published'`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS condition_code TEXT NOT NULL DEFAULT 'preowned'`;
  // Perfil de abastecimiento del catálogo. Es deliberadamente por producto en
  // P0; la relación N:M proveedor-producto y recepciones llegan en la siguiente
  // fase sin impedir que la tienda sepa hoy de dónde y cómo se sirve cada SKU.
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_name TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_contact TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_email TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_phone TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS fulfillment_mode TEXT NOT NULL DEFAULT 'own_stock'`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_location TEXT NOT NULL DEFAULT 'Almacén principal'`;
  await sql`CREATE TABLE IF NOT EXISTS suppliers (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', ordering_method TEXT NOT NULL DEFAULT 'email', notes TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), UNIQUE(company_id, name))`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key`;
  await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_company_sku_key`;
  await sql`ALTER TABLE products ADD CONSTRAINT products_company_sku_key UNIQUE (company_id, sku)`;
  await sql`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS ref_key TEXT`;
  await sql`ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS vat_rate INTEGER NOT NULL DEFAULT 21`;
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS order_id UUID UNIQUE REFERENCES orders(id) ON DELETE SET NULL`;
  // Sale numbers are generated per tenant.  A global UNIQUE(number) made a
  // perfectly valid number in one company collide with another company's
  // sequence after the multi-company migration.
  await sql`ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_number_key`;
  await sql`ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_company_number_key`;
  await sql`ALTER TABLE sales ADD CONSTRAINT sales_company_number_key UNIQUE (company_id, number)`;
  await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_publication_status_check`;
  await sql`ALTER TABLE products ADD CONSTRAINT products_publication_status_check CHECK (publication_status IN ('draft', 'ready_for_review', 'published', 'paused', 'archived'))`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS sales_policy TEXT NOT NULL DEFAULT 'own_stock'`;
  await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sales_policy_check`;
  await sql`ALTER TABLE products ADD CONSTRAINT products_sales_policy_check CHECK (sales_policy IN ('not_sellable', 'own_stock', 'dropship', 'preorder', 'make_to_order'))`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_source_status TEXT NOT NULL DEFAULT 'not_applicable'`;
  await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_supplier_source_status_check`;
  await sql`ALTER TABLE products ADD CONSTRAINT products_supplier_source_status_check CHECK (supplier_source_status IN ('not_applicable', 'negotiating', 'approved', 'suspended'))`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS supply_status TEXT NOT NULL DEFAULT 'not_applicable'`;
  await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_supply_status_check`;
  await sql`ALTER TABLE products ADD CONSTRAINT products_supply_status_check CHECK (supply_status IN ('not_applicable', 'negotiating', 'ordered', 'in_transit', 'received', 'quality_hold'))`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_last_verified_at TIMESTAMP WITH TIME ZONE`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS availability_eta TIMESTAMP WITH TIME ZONE`;
  await sql`
    CREATE TABLE IF NOT EXISTS integration_events (
      id BIGSERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      correlation_id TEXT,
      request_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      tool_name TEXT,
      summary TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS integration_events_tenant_created_idx ON integration_events (company_id, id ASC)`;
  await sql`CREATE INDEX IF NOT EXISTS integration_events_tenant_corr_idx ON integration_events (company_id, correlation_id)`;

  // Defense in depth for central API roles. Requests set app.company_id locally.
  for (const table of ["products", "customers", "sales", "cash_movements", "reservations", "orders", "external_customer_identities", "semantic_documents", "semantic_metrics", "idempotency_keys", "service_audit_log", "plugin_audit_log", "tenant_plugins", "integration_events"] as const) {
    const policy = `${table}_tenant_isolation`;
    await sql.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await sql.unsafe(`DROP POLICY IF EXISTS ${policy} ON ${table}`);
    await sql.unsafe(`CREATE POLICY ${policy} ON ${table} USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer)`);
  }
  // Child rows inherit tenant scope from their parent. These policies prevent a
  // direct query against a line table from bypassing the parent's RLS policy.
  await sql`ALTER TABLE reservation_lines ENABLE ROW LEVEL SECURITY`;
  await sql`DROP POLICY IF EXISTS reservation_lines_tenant_isolation ON reservation_lines`;
  await sql`CREATE POLICY reservation_lines_tenant_isolation ON reservation_lines USING (EXISTS (SELECT 1 FROM reservations WHERE reservations.id = reservation_lines.reservation_id AND reservations.company_id = NULLIF(current_setting('app.company_id', true), '')::integer)) WITH CHECK (EXISTS (SELECT 1 FROM reservations WHERE reservations.id = reservation_lines.reservation_id AND reservations.company_id = NULLIF(current_setting('app.company_id', true), '')::integer))`;
  await sql`ALTER TABLE order_lines ENABLE ROW LEVEL SECURITY`;
  await sql`DROP POLICY IF EXISTS order_lines_tenant_isolation ON order_lines`;
  await sql`CREATE POLICY order_lines_tenant_isolation ON order_lines USING (EXISTS (SELECT 1 FROM orders WHERE orders.id = order_lines.order_id AND orders.company_id = NULLIF(current_setting('app.company_id', true), '')::integer)) WITH CHECK (EXISTS (SELECT 1 FROM orders WHERE orders.id = order_lines.order_id AND orders.company_id = NULLIF(current_setting('app.company_id', true), '')::integer))`;
  // Partial returns (ciclo 8)
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS refunded_cents INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS returned_qty INTEGER NOT NULL DEFAULT 0`;

  // Módulo Trabajo (Multiempresa) DDL
  await sql`
    CREATE TABLE IF NOT EXISTS work_categories (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6b7280',
      archived_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT work_categories_company_normalized_unique UNIQUE (company_id, normalized_name)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS work_projects (
      id SERIAL PRIMARY KEY,
      uid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      project_type TEXT NOT NULL DEFAULT 'own' CHECK (project_type IN ('own', 'client', 'internal')),
      client_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      task_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      value_cents INTEGER NOT NULL DEFAULT 0 CHECK (value_cents >= 0),
      monthly_estimate_cents INTEGER NOT NULL DEFAULT 0 CHECK (monthly_estimate_cents >= 0),
      revenue_target_date DATE,
      documents JSONB NOT NULL DEFAULT '[]'::jsonb,
      prd TEXT NOT NULL DEFAULT '',
      tech_stack JSONB NOT NULL DEFAULT '[]'::jsonb,
      brief JSONB NOT NULL DEFAULT '{}'::jsonb,
      logo_data_url TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'paused', 'done', 'archived')),
      start_date TIMESTAMP WITH TIME ZONE,
      target_date TIMESTAMP WITH TIME ZONE,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS uid UUID`;
  await sql`UPDATE work_projects SET uid = gen_random_uuid() WHERE uid IS NULL`;
  await sql`ALTER TABLE work_projects ALTER COLUMN uid SET DEFAULT gen_random_uuid()`;
  await sql`ALTER TABLE work_projects ALTER COLUMN uid SET NOT NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_work_projects_uid ON work_projects(uid)`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS project_type TEXT NOT NULL DEFAULT 'own'`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS client_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS task_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`;
  // Projects created before the explicit classification used customer_id to
  // distinguish client work from Hexa-owned products. Preserve that meaning
  // when adding the new column instead of silently turning every legacy row
  // into an own project.
  await sql`
    UPDATE work_projects
    SET project_type = CASE WHEN customer_id IS NULL THEN 'own' ELSE 'client' END
    WHERE project_type = 'own' AND customer_id IS NOT NULL
  `;
  await sql`
    UPDATE work_projects
    SET task_company_id = CASE WHEN project_type = 'internal' AND client_company_id IS NOT NULL THEN client_company_id ELSE company_id END
    WHERE task_company_id IS NULL
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_work_projects_client_company ON work_projects(client_company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_work_projects_customer ON work_projects(company_id, customer_id)`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS value_cents INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS monthly_estimate_cents INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS revenue_target_date DATE`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS requests JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS prd TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS tech_stack JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS brief JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS management JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE work_projects ADD COLUMN IF NOT EXISTS logo_data_url TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES work_projects(id) ON DELETE SET NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id, issued_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS project_client_access (
      project_id INTEGER NOT NULL REFERENCES work_projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project_id, user_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_project_client_access_user ON project_client_access(user_id, project_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cash_movements_project ON cash_movements(company_id, project_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS work_project_revenue_milestones (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES work_projects(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      target_month TEXT NOT NULL CHECK (target_month ~ '^[0-9]{4}-[0-9]{2}$'),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_project_revenue_milestones ON work_project_revenue_milestones(company_id, project_id, target_month)`;
  await sql`
    CREATE TABLE IF NOT EXISTS work_items (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES work_items(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES work_categories(id) ON DELETE SET NULL,
      project_id INTEGER REFERENCES work_projects(id) ON DELETE SET NULL,
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'task' CHECK (type IN ('idea', 'task', 'issue', 'milestone')),
      status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'planned', 'in_progress', 'validation', 'blocked', 'done', 'archived')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
      start_date TIMESTAMP WITH TIME ZONE,
      due_date TIMESTAMP WITH TIME ZONE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      source_type TEXT,
      source_key TEXT,
      source_href TEXT,
      completed_at TIMESTAMP WITH TIME ZONE,
      review_messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES work_items(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS review_messages JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE work_items DROP CONSTRAINT IF EXISTS work_items_status_check`;
  await sql`ALTER TABLE work_items ADD CONSTRAINT work_items_status_check CHECK (status IN ('inbox', 'planned', 'in_progress', 'validation', 'blocked', 'done', 'archived'))`;
  await sql`CREATE INDEX IF NOT EXISTS idx_work_categories_company ON work_categories(company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_work_projects_company ON work_projects(company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_work_items_company ON work_items(company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_work_items_category ON work_items(category_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_work_items_project ON work_items(project_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_work_items_parent ON work_items(parent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_work_items_assignee ON work_items(assignee_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_work_items_source ON work_items(company_id, source_type, source_key)`;
  // Legacy internal projects could be reassigned to the company that owns
  // their work while their pre-existing, unclassified tasks stayed in the
  // studio tenant. Move only rows without tenant-bound category/assignee
  // relations; linked rows require an explicit migration instead of silently
  // breaking those references.
  await sql`
    UPDATE work_items wi
    SET company_id = p.task_company_id,
        updated_at = NOW()
    FROM work_projects p
    WHERE wi.project_id = p.id
      AND p.project_type = 'internal'
      AND p.task_company_id IS NOT NULL
      AND wi.company_id <> p.task_company_id
      AND wi.category_id IS NULL
      AND wi.assignee_id IS NULL
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_work_items_active_source
    ON work_items (company_id, source_type, source_key)
    WHERE status NOT IN ('done', 'archived') AND source_type IS NOT NULL AND source_key IS NOT NULL
  `;

  for (const table of ["work_categories", "work_projects", "work_items"] as const) {
    const policy = `${table}_tenant_isolation`;
    const tenantCondition = table === "work_projects"
      ? "(company_id = NULLIF(current_setting('app.company_id', true), '')::integer OR task_company_id = NULLIF(current_setting('app.company_id', true), '')::integer)"
      : "company_id = NULLIF(current_setting('app.company_id', true), '')::integer";
    await sql.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await sql.unsafe(`DROP POLICY IF EXISTS ${policy} ON ${table}`);
    await sql.unsafe(`CREATE POLICY ${policy} ON ${table} USING (${tenantCondition}) WITH CHECK (${tenantCondition})`);
  }

  // --- Inventory Foundation (Phase 1) ---
  await sql`
    CREATE TABLE IF NOT EXISTS warehouses (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, code)
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS stock_locations (
      id SERIAL PRIMARY KEY,
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, warehouse_id, code)
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS stock_balances (
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
      on_hand INTEGER NOT NULL DEFAULT 0,
      reserved INTEGER NOT NULL DEFAULT 0,
      blocked INTEGER NOT NULL DEFAULT 0,
      incoming INTEGER NOT NULL DEFAULT 0,
      available INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, product_id, location_id)
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      from_location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
      to_location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
      movement_type TEXT NOT NULL,
      qty INTEGER NOT NULL,
      cost_cents INTEGER NOT NULL DEFAULT 0,
      effective_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reason_code TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      ref_type TEXT NOT NULL DEFAULT '',
      ref_id INTEGER,
      idempotency_key TEXT,
      reversed_movement_id INTEGER REFERENCES inventory_movements(id) ON DELETE SET NULL,
      is_reversal BOOLEAN NOT NULL DEFAULT FALSE
    );
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_warehouses_company ON warehouses(company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stock_locations_company ON stock_locations(company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stock_locations_warehouse ON stock_locations(warehouse_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stock_balances_product ON stock_balances(company_id, product_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_inventory_movements_company ON inventory_movements(company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(company_id, product_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_idempotency ON inventory_movements(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL`;

  for (const table of ["warehouses", "stock_locations", "stock_balances", "inventory_movements"] as const) {
    const policy = `${table}_tenant_isolation`;
    await sql.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await sql.unsafe(`DROP POLICY IF EXISTS ${policy} ON ${table}`);
    await sql.unsafe(`CREATE POLICY ${policy} ON ${table} USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer)`);
  }

  // The local demo keeps its seed data. A central tenant service must start empty
  // and be provisioned explicitly; it must never leak demo rows into a tenant.
  if (!CENTRAL_MODE) {
    await seedSettings();
    await seedUsers();
    await seedCompaniesPg();
    await seedProductsAndCustomers();
  }

  // Every active tenant needs a fiscal profile, even before the owner opens
  // Ajustes → Impuestos.  Without this idempotent default, newly-created
  // companies silently fall back to an in-memory invoice series and the tax
  // page appears empty in a fresh browser.
  await sql`
    INSERT INTO fiscal_profiles (company_id)
    SELECT id FROM companies WHERE active = TRUE
    ON CONFLICT (company_id) DO NOTHING
  `;
  await ensureTenantSettings();
  await ensureLegacyForeignKeys();

  await seedInventoryFoundation();

  await sql`INSERT INTO schema_migrations (version) VALUES (${CENTRAL_SCHEMA_VERSION}) ON CONFLICT (version) DO NOTHING`;
  await sql`INSERT INTO schema_migrations (version) VALUES ('0015_work_management') ON CONFLICT (version) DO NOTHING`;
  await sql`INSERT INTO schema_migrations (version) VALUES ('0016_inventory_foundation') ON CONFLICT (version) DO NOTHING`;
  await sql`INSERT INTO schema_migrations (version) VALUES ('0017_stripe_secret_vault') ON CONFLICT (version) DO NOTHING`;
  await sql`INSERT INTO schema_migrations (version) VALUES ('0018_integration_events') ON CONFLICT (version) DO NOTHING`;
  await sql`INSERT INTO schema_migrations (version) VALUES ('0019_publication_and_sales_policy') ON CONFLICT (version) DO NOTHING`;
  await sql`INSERT INTO schema_migrations (version) VALUES ('0020_supply_status') ON CONFLICT (version) DO NOTHING`;
  await sql`INSERT INTO schema_migrations (version) VALUES ('0021_fiscal_profile_defaults') ON CONFLICT (version) DO NOTHING`;
  await sql`INSERT INTO schema_migrations (version) VALUES ('0022_tenant_settings') ON CONFLICT (version) DO NOTHING`;
  await sql`INSERT INTO schema_migrations (version) VALUES ('0023_budgets') ON CONFLICT (version) DO NOTHING`;
  await sql`INSERT INTO schema_migrations (version) VALUES ('0024_fiscal_questionnaire') ON CONFLICT (version) DO NOTHING`;
}

async function seedInventoryFoundation() {
  const companies = await sql<{ id: number }[]>`SELECT id FROM companies`;
  for (const c of companies) {
    const companyId = c.id;

    // Ensure default warehouse ("Almacén Principal", code "WH-MAIN")
    const whRows = await sql<{ id: number }[]>`
      INSERT INTO warehouses (company_id, code, name, is_default, active)
      VALUES (${companyId}, 'WH-MAIN', 'Almacén Principal', TRUE, TRUE)
      ON CONFLICT (company_id, code) DO UPDATE SET is_default = TRUE, updated_at = NOW()
      RETURNING id
    `;
    let warehouseId = whRows[0]?.id;
    if (!warehouseId) {
      const existingWh = await sql<{ id: number }[]>`SELECT id FROM warehouses WHERE company_id = ${companyId} AND code = 'WH-MAIN'`;
      warehouseId = existingWh[0]?.id;
    }
    if (!warehouseId) continue;

    // Ensure default location ("Ubicación Principal", code "LOC-MAIN")
    const locRows = await sql<{ id: number }[]>`
      INSERT INTO stock_locations (warehouse_id, company_id, code, name, is_default, allow_negative_stock, active)
      VALUES (${warehouseId}, ${companyId}, 'LOC-MAIN', 'Ubicación Principal', TRUE, FALSE, TRUE)
      ON CONFLICT (company_id, warehouse_id, code) DO UPDATE SET is_default = TRUE, updated_at = NOW()
      RETURNING id
    `;
    let locationId = locRows[0]?.id;
    if (!locationId) {
      const existingLoc = await sql<{ id: number }[]>`
        SELECT id FROM stock_locations WHERE company_id = ${companyId} AND warehouse_id = ${warehouseId} AND code = 'LOC-MAIN'
      `;
      locationId = existingLoc[0]?.id;
    }
    if (!locationId) continue;

    // For any product with stock > 0, insert/seed initial balance into stock_balances and create an initial_stock movement idempotently.
    const products = await sql<{ id: number; stock: number; cost_cents: number }[]>`
      SELECT id, stock, cost_cents FROM products WHERE company_id = ${companyId} AND stock > 0
    `;

    for (const p of products) {
      const key = `initial_stock_${companyId}_${p.id}_${locationId}`;

      await sql`
        INSERT INTO stock_balances (company_id, product_id, location_id, on_hand, reserved, blocked, incoming, available, updated_at)
        VALUES (${companyId}, ${p.id}, ${locationId}, ${p.stock}, 0, 0, 0, ${p.stock}, NOW())
        ON CONFLICT (company_id, product_id, location_id) DO NOTHING
      `;

      await sql`
        INSERT INTO inventory_movements (
          company_id, product_id, from_location_id, to_location_id, movement_type, qty, cost_cents, reason_code, notes, idempotency_key
        )
        SELECT ${companyId}, ${p.id}, NULL, ${locationId}, 'initial_stock', ${p.stock}, ${p.cost_cents}, 'INITIAL_MIGRATION', 'Migración inicial de stock escalar', ${key}
        WHERE NOT EXISTS (
          SELECT 1 FROM inventory_movements WHERE company_id = ${companyId} AND idempotency_key = ${key}
        )
      `;
    }
  }
}

async function seedCompaniesPg() {
  const count = await sql`SELECT COUNT(*)::int as count FROM companies`;
  if (count[0].count > 0) {
    await ensureDefaultMembers();
    return;
  }
  const t = new Date().toISOString();
  for (const c of seedCompanies(t)) {
    await sql`
      INSERT INTO companies (id, code, legal_name, trade_name, nif, kind, active, created_at)
      VALUES (${c.id}, ${c.code}, ${c.legal_name}, ${c.trade_name}, ${c.nif}, ${c.kind}, ${c.active}, ${c.created_at})
      ON CONFLICT (id) DO NOTHING
    `;
  }
  // Keep serial in sync
  await sql`SELECT setval(pg_get_serial_sequence('companies','id'), (SELECT COALESCE(MAX(id),1) FROM companies))`;
  await ensureDefaultMembers();
}

async function ensureDefaultMembers() {
  const users = await sql`SELECT id, username FROM users ORDER BY id ASC`;
  if (users.length === 0) return;
  const admin = users.find((u) => u.username === "admin") ?? users[0];
  const cajero = users.find((u) => u.username === "cajero") ?? admin;
  const members = seedCompanyMembers({ adminId: admin.id, cajeroId: cajero.id });
  for (const m of members) {
    await sql`
      INSERT INTO company_members (company_id, user_id, role)
      VALUES (${m.company_id}, ${m.user_id}, ${m.role})
      ON CONFLICT (company_id, user_id) DO NOTHING
    `;
  }
}

async function loadCompanies(): Promise<Company[]> {
  const rows = await sql`SELECT * FROM companies WHERE active = TRUE ORDER BY id`;
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    legal_name: r.legal_name,
    trade_name: r.trade_name,
    nif: r.nif,
    kind: r.kind,
    entity_type: r.entity_type ?? "otra",
    address: String(r.address ?? ""),
    postal_code: String(r.postal_code ?? ""),
    city: String(r.city ?? ""),
    province: String(r.province ?? ""),
    country: String(r.country ?? "España"),
    email: String(r.email ?? ""),
    phone: String(r.phone ?? ""),
    logo_data_url: String(r.logo_data_url ?? ""),
    active: !!r.active,
    created_at: toIso(r.created_at),
  }));
}

async function loadMembers(): Promise<{ company_id: number; user_id: number; role: string }[]> {
  return await sql`SELECT company_id, user_id, role FROM company_members`;
}

async function resolveActiveCompanyId(token: string | null, userId: number): Promise<number> {
  const companies = await loadCompanies();
  const members = await loadMembers();
  const accessible = companiesForUser(
    userId,
    members as { company_id: number; user_id: number; role: "admin" | "cajero" }[],
    companies,
  );
  const [sess, masterRows] = await Promise.all([
    sql`SELECT active_company_id FROM sessions WHERE token = ${token}`,
    sql`SELECT is_master FROM users WHERE id = ${userId}`,
  ]);
  const preferred = sess[0]?.active_company_id as number | null | undefined;
  const isMaster = !!masterRows[0]?.is_master;
  const masterPreferred = isMaster && preferred != null && companies.some((company) => company.id === preferred)
    ? preferred
    : null;
  const id = masterPreferred ?? pickDefaultCompanyId(accessible, preferred) ?? (isMaster ? companies[0]?.id ?? null : null);
  if (id == null) throw new Error("Sin empresa asignada al usuario");
  if (preferred !== id) {
    await sql`UPDATE sessions SET active_company_id = ${id} WHERE token = ${token}`;
  }
  return id;
}

type WhatsAppDeviceBinding = {
  deviceId: string;
  phone: string;
  sharedFromCompanyId: number | null;
  sharedFromCompanyName: string | null;
};

/** Resolve the device used by the active company. A company may explicitly
 * reuse a device linked by another company the user can access. */
async function resolveWhatsAppDevice(companyId: number, userId: number): Promise<WhatsAppDeviceBinding> {
  const rows = await sql`
    SELECT wl.device_id, wl.phone, source.id AS source_company_id, source.trade_name AS source_company_name
    FROM company_whatsapp_links wl
    INNER JOIN companies source ON source.id = wl.company_id AND source.active = TRUE
    WHERE wl.company_id = ${companyId}
    LIMIT 1
  `;
  if (rows.length) {
    const sharedRows = await sql`
      SELECT c.id, c.trade_name
      FROM company_whatsapp_links wl
      INNER JOIN companies c ON c.id = wl.company_id AND c.active = TRUE
      WHERE wl.device_id = ${String(rows[0].device_id)} AND wl.company_id <> ${companyId}
      ORDER BY c.trade_name, c.id
      LIMIT 1
    `;
    return {
      deviceId: String(rows[0].device_id),
      phone: String(rows[0].phone ?? ""),
      sharedFromCompanyId: sharedRows.length ? Number(sharedRows[0].id) : null,
      // There is no canonical owner for a deliberately shared device. Do not
      // pick an arbitrary company name (for example MeigaMarket while viewing
      // HEXA Studio); the UI should describe it as a shared number instead.
      sharedFromCompanyName: null,
    };
  }
  return {
    deviceId: gowaDeviceId(companyId, userId),
    phone: "",
    sharedFromCompanyId: null,
    sharedFromCompanyName: null,
  };
}

/** Importa una copia del store local sin borrar datos del tenant central. */
async function importLocalBackup(payload: any, companyId: number, userId: number) {
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const customers = Array.isArray(payload?.customers) ? payload.customers : [];
  const sales = Array.isArray(payload?.sales) ? payload.sales : [];
  const saleLines = Array.isArray(payload?.saleLines) ? payload.saleLines : (Array.isArray(payload?.sale_lines) ? payload.sale_lines : []);
  const cash = Array.isArray(payload?.cash) ? payload.cash : (Array.isArray(payload?.cash_movements) ? payload.cash_movements : []);
  const invoices = Array.isArray(payload?.invoices) ? payload.invoices : [];
  const expenses = Array.isArray(payload?.expenses) ? payload.expenses : [];
  const projects = Array.isArray(payload?.workProjects) ? payload.workProjects : [];
  const items = Array.isArray(payload?.workItems) ? payload.workItems : [];
  const customerIds = new Map<number, number>();
  const productIds = new Map<number, number>();
  const saleIds = new Map<number, number>();
  const projectIds = new Map<number, number>();
  let imported = { products: 0, customers: 0, sales: 0, sale_lines: 0, invoices: 0, expenses: 0, cash: 0, projects: 0, items: 0 };

  await sql.begin(async (tx) => {
    for (const c of customers) {
      const name = String(c?.name ?? "").trim();
      if (!name) continue;
      const existing = await tx`SELECT id FROM customers WHERE company_id = ${companyId} AND name = ${name} AND email = ${String(c?.email ?? "")} LIMIT 1`;
      const row = existing[0] ?? (await tx`
        INSERT INTO customers (company_id, name, email, phone, nif, notes)
        VALUES (${companyId}, ${name}, ${String(c?.email ?? "")}, ${String(c?.phone ?? "")}, ${String(c?.nif ?? "")}, ${String(c?.notes ?? "")})
        RETURNING id
      `)[0];
      if (c?.id != null) customerIds.set(Number(c.id), Number(row.id));
      if (!existing[0]) imported.customers++;
    }
    for (const p of products) {
      const sku = String(p?.sku ?? `IMPORT-${p?.id ?? crypto.randomUUID()}`).trim();
      const existing = await tx`SELECT id FROM products WHERE company_id = ${companyId} AND sku = ${sku} LIMIT 1`;
      const row = existing[0] ?? (await tx`
        INSERT INTO products (company_id, sku, name, description, category, stock, min_stock, cost_cents, price_cents, vat_rate, active, condition_code, publication_status, sales_policy)
        VALUES (${companyId}, ${sku}, ${String(p?.name ?? sku)}, ${String(p?.description ?? "")}, ${String(p?.category ?? "")}, ${Number(p?.stock ?? 0)}, ${Number(p?.min_stock ?? 0)}, ${Number(p?.cost_cents ?? 0)}, ${Number(p?.price_cents ?? 0)}, ${Number(p?.vat_rate ?? 21)}, ${p?.active !== false}, ${String(p?.condition_code ?? "preowned")}, ${String(p?.publication_status ?? "published")}, ${String(p?.sales_policy ?? "own_stock")})
        RETURNING id
      `)[0];
      if (p?.id != null) productIds.set(Number(p.id), Number(row.id));
      if (!existing[0]) imported.products++;
    }
    for (const s of sales) {
      const baseNumber = String(s?.number ?? `IMPORT-${s?.id ?? crypto.randomUUID()}`);
      const number = (await tx`SELECT id FROM sales WHERE number = ${baseNumber}`).length ? `${baseNumber}-IMP-${Date.now()}-${imported.sales}` : baseNumber;
      const customerId = s?.customer_id == null ? null : (customerIds.get(Number(s.customer_id)) ?? null);
      const row = (await tx`
        INSERT INTO sales (company_id, customer_id, number, sold_at, subtotal_cents, vat_cents, total_cents, notes, status)
        VALUES (${companyId}, ${customerId}, ${number}, ${s?.sold_at ? new Date(s.sold_at) : new Date()}, ${Number(s?.subtotal_cents ?? 0)}, ${Number(s?.vat_cents ?? 0)}, ${Number(s?.total_cents ?? 0)}, ${String(s?.notes ?? "")}, ${String(s?.status ?? "completed")})
        RETURNING id
      `)[0];
      if (s?.id != null) saleIds.set(Number(s.id), Number(row.id));
      imported.sales++;
    }
    for (const line of saleLines) {
      const saleId = saleIds.get(Number(line?.sale_id ?? line?.saleId));
      const productId = productIds.get(Number(line?.product_id ?? line?.productId));
      if (!saleId || !productId) continue;
      await tx`
        INSERT INTO sale_lines (sale_id, product_id, qty, unit_price_cents, vat_rate, line_base_cents, line_vat_cents, line_total_cents)
        VALUES (${saleId}, ${productId}, ${Number(line?.qty ?? 0)}, ${Number(line?.unit_price_cents ?? 0)}, ${Number(line?.vat_rate ?? 21)}, ${Number(line?.line_base_cents ?? 0)}, ${Number(line?.line_vat_cents ?? 0)}, ${Number(line?.line_total_cents ?? 0)})
      `;
      imported.sale_lines++;
    }
    for (const invoice of invoices) {
      const series = String(invoice?.series ?? "F");
      const baseNumber = String(invoice?.number ?? `IMP-${crypto.randomUUID()}`);
      const number = (await tx`SELECT id FROM invoices WHERE company_id = ${companyId} AND series = ${series} AND number = ${baseNumber}`).length
        ? `${baseNumber}-IMP-${Date.now()}-${imported.invoices}` : baseNumber;
      await tx`
        INSERT INTO invoices (company_id, sale_id, series, number, kind, status, issued_at, operation_date, due_at, seller_legal_name, seller_nif, seller_trade_name, customer_id, customer_name, customer_nif, customer_email, lines, base_cents, vat_cents, irpf_rate, irpf_cents, total_cents, paid_cents, payment_status, notes, created_by)
        VALUES (${companyId}, NULL, ${series}, ${number}, ${String(invoice?.kind ?? "complete")}, ${String(invoice?.status ?? "issued")}, ${invoice?.issued_at ? new Date(invoice.issued_at) : new Date()}, ${invoice?.operation_date || new Date().toISOString().slice(0, 10)}, ${invoice?.due_at || null}, ${String(invoice?.seller_legal_name ?? "")}, ${String(invoice?.seller_nif ?? "")}, ${String(invoice?.seller_trade_name ?? "")}, ${invoice?.customer_id != null ? (customerIds.get(Number(invoice.customer_id)) ?? null) : null}, ${String(invoice?.customer_name ?? "")}, ${String(invoice?.customer_nif ?? "")}, ${String(invoice?.customer_email ?? "")}, ${tx.json(Array.isArray(invoice?.lines) ? invoice.lines : [])}, ${Number(invoice?.base_cents ?? 0)}, ${Number(invoice?.vat_cents ?? 0)}, ${Number(invoice?.irpf_rate ?? 0)}, ${Number(invoice?.irpf_cents ?? 0)}, ${Number(invoice?.total_cents ?? 0)}, ${Number(invoice?.paid_cents ?? 0)}, ${String(invoice?.payment_status ?? "pending")}, ${String(invoice?.notes ?? "")}, ${userId})
      `;
      imported.invoices++;
    }
    for (const expense of expenses) {
      const title = String(expense?.title ?? expense?.supplier_name ?? "Gasto importado");
      await tx`
        INSERT INTO expense_documents (company_id, status, kind, title, supplier_name, supplier_tax_id, invoice_number, issued_at, accounting_date, due_at, deductible, category, base_cents, vat_rate, vat_cents, withholding_cents, total_cents, currency, notes, paid_cents, payment_status, source, created_by)
        VALUES (${companyId}, ${String(expense?.status ?? "review")}, ${String(expense?.kind ?? "invoice")}, ${title}, ${String(expense?.supplier_name ?? "")}, ${String(expense?.supplier_tax_id ?? "")}, ${String(expense?.invoice_number ?? "")}, ${expense?.issued_at || null}, ${expense?.accounting_date || null}, ${expense?.due_at || null}, ${expense?.deductible !== false}, ${String(expense?.category ?? "otros")}, ${Number(expense?.base_cents ?? 0)}, ${Number(expense?.vat_rate ?? 21)}, ${Number(expense?.vat_cents ?? 0)}, ${Number(expense?.withholding_cents ?? 0)}, ${Number(expense?.total_cents ?? 0)}, ${String(expense?.currency ?? "EUR")}, ${String(expense?.notes ?? "")}, ${Number(expense?.paid_cents ?? 0)}, ${String(expense?.payment_status ?? "pending")}, 'local_backup', ${userId})
      `;
      imported.expenses++;
    }
    for (const m of cash) {
      await tx`
        INSERT INTO cash_movements (company_id, kind, amount_cents, category, description, occurred_at)
        VALUES (${companyId}, ${String(m?.kind ?? "income")}, ${Number(m?.amount_cents ?? 0)}, ${String(m?.category ?? "otros")}, ${String(m?.description ?? "Importado desde copia local")}, ${m?.occurred_at ? new Date(m.occurred_at) : new Date()})
      `;
      imported.cash++;
    }
    for (const p of projects) {
      const legacyProjectType = p?.project_type === "client" || p?.project_type === "internal"
        ? p.project_type
        : (p?.customer_id != null ? "client" : "own");
      const requestedClientCompanyId = p?.client_company_id == null ? null : Number(p.client_company_id);
      const clientCompanyRows = requestedClientCompanyId == null
        ? []
        : await tx`SELECT id FROM companies WHERE id = ${requestedClientCompanyId} AND active = TRUE`;
      const clientCompanyId = clientCompanyRows.length ? requestedClientCompanyId : null;
      const taskCompanyId = legacyProjectType === "internal" && clientCompanyId != null ? clientCompanyId : companyId;
      const row = (await tx`
        INSERT INTO work_projects (company_id, project_type, client_company_id, task_company_id, name, description, status, customer_id, value_cents, monthly_estimate_cents, start_date, target_date, created_by)
        VALUES (${companyId}, ${legacyProjectType}, ${clientCompanyId}, ${taskCompanyId}, ${String(p?.name ?? "Proyecto importado")}, ${String(p?.description ?? "")}, ${String(p?.status ?? "planned")}, ${p?.customer_id != null ? (customerIds.get(Number(p.customer_id)) ?? null) : null}, ${Number(p?.value_cents ?? 0)}, ${Number(p?.monthly_estimate_cents ?? 0)}, ${p?.start_date || null}, ${p?.target_date || null}, ${userId})
        RETURNING id
      `)[0];
      if (p?.id != null) projectIds.set(Number(p.id), Number(row.id));
      imported.projects++;
    }
    for (const item of items) {
      await tx`
        INSERT INTO work_items (company_id, project_id, title, description, type, status, priority, assignee_id, created_by)
        VALUES (${companyId}, ${item?.project_id != null ? (projectIds.get(Number(item.project_id)) ?? null) : null}, ${String(item?.title ?? "Tarea importada")}, ${String(item?.description ?? "")}, ${String(item?.type ?? "task")}, ${String(item?.status ?? "inbox")}, ${String(item?.priority ?? "normal")}, NULL, ${userId})
      `;
      imported.items++;
    }
  });
  return imported;
}

async function seedSettings() {
  const defaults = [
    { key: "shop_name", value: "Mi Tienda" },
    { key: "ollama_model", value: "qwen3.5:4b" },
    { key: "ollama_url", value: "http://127.0.0.1:11434" },
    { key: "default_vat", value: "21" },
    { key: "idle_timeout_minutes", value: "15" },
    { key: "last_backup_at", value: "" },
  ];
  for (const { key, value } of defaults) {
    await sql`
      INSERT INTO settings (key, value)
      VALUES (${key}, ${value})
      ON CONFLICT (key) DO NOTHING
    `;
  }
}

async function ensureTenantSettings() {
  const companies = await sql<{ id: number; trade_name: string }[]>`SELECT id, trade_name FROM companies WHERE active = TRUE ORDER BY id`;
  const legacyRows = await sql<{ key: string; value: string }[]>`SELECT key, value FROM settings WHERE key IN ('ollama_model','ollama_url','default_vat','idle_timeout_minutes','last_backup_at','monthly_economic_goals')`;
  const legacy = new Map(legacyRows.map((row) => [row.key, row.value]));
  for (const company of companies) {
    const defaults: Record<string, string> = {
      shop_name: String(company.trade_name || "Mi Tienda"),
      ollama_model: legacy.get("ollama_model") || "qwen3.5:4b",
      ollama_url: legacy.get("ollama_url") || "http://127.0.0.1:11434",
      default_vat: legacy.get("default_vat") || "21",
      idle_timeout_minutes: legacy.get("idle_timeout_minutes") || "15",
      last_backup_at: legacy.get("last_backup_at") || "",
      monthly_economic_goals: legacy.get("monthly_economic_goals") || "{}",
    };
    for (const [key, value] of Object.entries(defaults)) {
      await sql`
        INSERT INTO settings (key, value)
        VALUES (${companySettingKey(company.id, key)}, ${value})
        ON CONFLICT (key) DO NOTHING
      `;
    }
  }
}

async function ensureLegacyForeignKeys() {
  // Several tables were created before multi-company support and originally
  // relied only on application checks.  Add the missing database-level links
  // once the full schema exists; the explicit existence guard keeps startup
  // idempotent across every request/restart.
  const constraints = [
    ["company_members", "company_members_user_id_fkey", "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"],
    ["products", "products_company_id_fkey", "FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE"],
    ["customers", "customers_company_id_fkey", "FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE"],
    ["sales", "sales_company_id_fkey", "FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE"],
    ["cash_movements", "cash_movements_company_id_fkey", "FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE"],
    ["cash_movements", "cash_movements_project_id_fkey", "FOREIGN KEY (project_id) REFERENCES work_projects(id) ON DELETE SET NULL"],
    ["expense_documents", "expense_documents_created_by_fkey", "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT"],
    ["expense_documents", "expense_documents_project_id_fkey", "FOREIGN KEY (project_id) REFERENCES work_projects(id) ON DELETE SET NULL"],
    ["expense_payments", "expense_payments_created_by_fkey", "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT"],
    ["invoices", "invoices_created_by_fkey", "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT"],
    ["invoice_payments", "invoice_payments_created_by_fkey", "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT"],
    ["budgets", "budgets_company_id_fkey", "FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE"],
    ["budgets", "budgets_customer_id_fkey", "FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL"],
    ["budgets", "budgets_created_by_fkey", "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT"],
    ["sessions", "sessions_active_company_id_fkey", "FOREIGN KEY (active_company_id) REFERENCES companies(id) ON DELETE SET NULL"],
  ] as const;
  for (const [table, name, definition] of constraints) {
    await sql.unsafe(`DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}; END IF; END $constraint$;`);
  }
}

async function seedUsers() {
  const countRes = await sql`SELECT COUNT(*)::int as count FROM users`;
  if (countRes[0].count > 0) return;

  const adminHash = await hashPin("1234");
  const cajeroHash = await hashPin("0000");

  await sql`
    INSERT INTO users (username, display_name, role, pin_hash, active, must_change_password)
    VALUES 
      ('admin', 'Administrador', 'admin', ${adminHash}, TRUE, FALSE),
      ('cajero', 'Cajero', 'cajero', ${cajeroHash}, TRUE, FALSE)
  `;
}

async function seedProductsAndCustomers() {
  const countProducts = await sql`SELECT COUNT(*)::int as count FROM products`;
  if (countProducts[0].count > 0) return;

  const products = [
    { sku: "CAF-001", name: "Café de especialidad 250g", desc: "Tueste medio, origen Colombia", cat: "Alimentación", stock: 40, min: 10, cost: 450, price: 990, vat: 10 },
    { sku: "LIB-021", name: "Libro de cocina mediterránea", desc: "Edición tapa blanda", cat: "Libros", stock: 12, min: 5, cost: 900, price: 1890, vat: 4 },
    { sku: "TEC-110", name: "Auriculares Bluetooth", desc: "Cancelación de ruido", cat: "Tecnología", stock: 8, min: 4, cost: 2500, price: 4990, vat: 21 },
    { sku: "ALI-050", name: "Miel artesanal 500g", desc: "Producción local", cat: "Alimentación", stock: 3, min: 6, cost: 350, price: 750, vat: 10 },
  ];

  for (const p of products) {
    await sql`
      INSERT INTO products (sku, name, description, category, stock, min_stock, cost_cents, price_cents, vat_rate, active)
      VALUES (${p.sku}, ${p.name}, ${p.desc}, ${p.cat}, ${p.stock}, ${p.min}, ${p.cost}, ${p.price}, ${p.vat}, TRUE)
    `;
  }

  await sql`
    INSERT INTO customers (name, email, phone, nif, notes)
    VALUES ('Cliente contado', '', '', '', 'Cliente genérico')
  `;
}

// -------------------------------------------------------------
// Security / Session Guards
// -------------------------------------------------------------
async function requireSession(token: string | null): Promise<AuthUser> {
  if (!token) throw new Error("Sesión no iniciada");
  const sessRes = await sql`
    SELECT s.token, u.id, u.username, u.display_name, u.phone, u.avatar_data_url, u.role, u.active, u.created_at, u.must_change_password, u.temp_password_issued_at, u.is_master
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ${token} AND u.active = TRUE
  `;
  if (sessRes.length === 0) throw new Error("Sesión inválida o expirada");
  const u = sessRes[0];
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    phone: u.phone ?? "",
    avatar_data_url: u.avatar_data_url ?? "",
    role: u.role,
    active: u.active,
    created_at: toIso(u.created_at),
    must_change_password: !!u.must_change_password,
    temp_password_issued_at: toIso(u.temp_password_issued_at) || null,
    is_master: !!u.is_master,
  };
}

const CLIENT_RPC_COMMANDS = new Set([
  "logout",
  "session_me",
  "complete_forced_password_change",
  "change_own_pin",
  "portal_list_projects",
  "portal_get_project",
  "portal_create_request",
  "portal_add_request_message",
]);

/** Deny client accounts access to every staff RPC unless explicitly exposed. */
async function assertRpcAccess(command: string, token: string | null): Promise<void> {
  if (!token || ["public_meta", "login"].includes(command)) return;
  const user = await requireSession(token);
  if (user.role === "cliente" && !CLIENT_RPC_COMMANDS.has(command)) {
    throw new Error("Este perfil solo puede acceder al portal de cliente.");
  }
}

async function syncProjectClientAccess(userId: number, role: string, projectIds: unknown, companyId: number): Promise<void> {
  await sql`DELETE FROM project_client_access WHERE user_id = ${userId}`;
  if (role !== "cliente") return;
  const ids = Array.isArray(projectIds)
    ? [...new Set(projectIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : [];
  for (const projectId of ids) {
    const rows = await sql`
      SELECT id FROM work_projects
      WHERE id = ${projectId}
        AND (company_id = ${companyId} OR task_company_id = ${companyId})
        AND status <> 'archived'
    `;
    if (!rows.length) throw new Error("El proyecto asignado no está disponible en la empresa activa.");
    await sql`INSERT INTO project_client_access (project_id,user_id) VALUES (${projectId},${userId})`;
  }
}

async function requireAdmin(token: string | null): Promise<AuthUser> {
  const u = await requireSession(token);
  if (u.role !== "admin") throw new Error("Se requieren permisos de administrador");
  return u;
}

async function requireAdminCategoryManagementPg(token: string | null): Promise<AuthUser> {
  const u = await requireSession(token);
  if (u.role !== "admin" && !u.is_master) {
    throw new Error("Solo los administradores pueden gestionar categorías.");
  }
  return u;
}

async function requireAdminProjectManagementPg(token: string | null): Promise<AuthUser> {
  const u = await requireSession(token);
  if (u.role !== "admin" && !u.is_master) {
    throw new Error("Solo los administradores pueden gestionar proyectos.");
  }
  return u;
}

function formatWorkProject(r: any): WorkProject {
  return {
    id: r.id,
    uid: String(r.uid),
    company_id: r.company_id,
    project_type: ["own", "client", "internal"].includes(r.project_type) ? r.project_type : (r.customer_id == null ? "own" : "client"),
    client_company_id: r.client_company_id ?? null,
    task_company_id: r.task_company_id ?? r.company_id,
    customer_id: r.customer_id ?? null,
    value_cents: r.value_cents ?? 0,
    monthly_estimate_cents: r.monthly_estimate_cents ?? 0,
    revenue_target_date: toIso(r.revenue_target_date) || null,
    revenue_milestones: [],
    documents: Array.isArray(r.documents) ? r.documents : [],
    requests: Array.isArray(r.requests) ? r.requests : [],
    prd: normalizeProjectPrd(r.prd),
    tech_stack: normalizeTechStack(r.tech_stack),
    brief: normalizeProjectBrief(r.brief, r.tech_stack),
    management: normalizeProjectManagement(r.management),
    logo_data_url: r.logo_data_url ?? "",
    name: r.name,
    description: r.description ?? "",
    status: r.status,
    start_date: toIso(r.start_date) || null,
    target_date: toIso(r.target_date) || null,
    created_by: r.created_by,
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
  };
}

async function attachProjectRevenueMilestones(
  projects: WorkProject[],
  companyId: number,
): Promise<WorkProject[]> {
  if (projects.length === 0) return projects;
  const ownerCompanyIds = Array.from(new Set(projects.map((project) => project.company_id)));
  const rows = await sql`
    SELECT id, project_id, amount_cents, target_month
    FROM work_project_revenue_milestones
    WHERE company_id = ANY(${ownerCompanyIds}::int[])
    ORDER BY target_month, id
  `;
  const byProject = new Map<number, WorkProject["revenue_milestones"]>();
  for (const row of rows) {
    const entries = byProject.get(row.project_id) ?? [];
    entries.push({
      id: row.id,
      amount_cents: row.amount_cents,
      target_month: row.target_month,
    });
    byProject.set(row.project_id, entries);
  }
  return projects.map((project) => ({
    ...project,
    revenue_milestones: byProject.get(project.id) ?? [],
  }));
}

function formatWorkItem(r: any): WorkItem {
  return {
    id: r.id,
    company_id: r.company_id,
    parent_id: r.parent_id ?? null,
    category_id: r.category_id ?? null,
    project_id: r.project_id ?? null,
    assignee_id: r.assignee_id ?? null,
    created_by: r.created_by,
    title: r.title,
    description: r.description ?? "",
    type: r.type,
    status: r.status,
    priority: r.priority,
    start_date: toIso(r.start_date) || null,
    due_date: toIso(r.due_date) || null,
    effective_assignee_id: r.effective_assignee_id ?? r.assignee_id ?? null,
    effective_due_date: toIso(r.effective_due_date ?? r.due_date) || null,
    sort_order: r.sort_order ?? 0,
    source_type: r.source_type ?? null,
    source_key: r.source_key ?? null,
    source_href: r.source_href ?? null,
    completed_at: toIso(r.completed_at) || null,
    review_messages: Array.isArray(r.review_messages) ? r.review_messages : [],
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
    parent_title: r.parent_title ?? null,
    category: r.category_name
      ? {
          id: r.category_id,
          company_id: r.company_id,
          name: r.category_name,
          normalized_name: r.category_normalized_name ?? r.category_name.toUpperCase(),
          color: r.category_color ?? "#6b7280",
          archived_at: toIso(r.category_archived_at) || null,
          created_at: toIso(r.category_created_at) || "",
          updated_at: toIso(r.category_updated_at) || "",
        }
      : null,
    assignee_name: r.assignee_name ?? null,
    assignee_avatar_data_url: r.assignee_avatar_data_url ?? null,
  };
}

function formatExpenseDocument(r: any): ExpenseDocument {
  return {
    id: r.id, company_id: r.company_id, status: r.status, kind: r.kind, title: r.title,
    supplier_name: r.supplier_name ?? "", supplier_tax_id: r.supplier_tax_id ?? "", invoice_number: r.invoice_number ?? "",
    issued_at: toIso(r.issued_at) || null, accounting_date: toIso(r.accounting_date) || null, deductible: r.deductible !== false, deduction_period: r.deduction_period ?? null, due_at: toIso(r.due_at) || null, project_id: r.project_id ?? null,
    category: r.category ?? "otros", base_cents: r.base_cents ?? 0, vat_rate: r.vat_rate ?? 21, vat_cents: r.vat_cents ?? 0,
    withholding_cents: r.withholding_cents ?? 0, total_cents: r.total_cents ?? 0, paid_cents: Number(r.paid_cents ?? 0), payment_status: r.payment_status ?? "pending", currency: r.currency ?? "EUR", notes: r.notes ?? "",
    attachments: Array.isArray(r.attachments) ? r.attachments : [], source: r.source ?? "manual", source_phone: r.source_phone ?? null,
    ocr_confidence: r.ocr_confidence == null ? null : Number(r.ocr_confidence), created_by: r.created_by,
    created_at: toIso(r.created_at), updated_at: toIso(r.updated_at), approved_at: toIso(r.approved_at) || null,
  };
}

function formatFiscalProfile(r: any): FiscalProfile {
  const taxSetup = r.tax_setup && typeof r.tax_setup === "object" && !Array.isArray(r.tax_setup) ? r.tax_setup : {};
  return {
    company_id: Number(r.company_id),
    invoice_series: String(r.invoice_series ?? "F").trim().toUpperCase() || "F",
    regime: r.regime,
    period: r.period,
    entity_type: r.entity_type ?? "autonomo",
    tax_models: Array.isArray(r.tax_models) ? r.tax_models.map(String) : [],
    tax_setup: normalizeTaxSetup(taxSetup),
    profile_completed: !!r.profile_completed,
    irpf_enabled: !!r.irpf_enabled,
    default_irpf_rate: Number(r.default_irpf_rate ?? 0),
    sii_enabled: !!r.sii_enabled,
    verifactu_mode: r.verifactu_mode ?? "disabled",
    verifactu_software_id: r.verifactu_software_id ?? "hexa-crm",
    verifactu_software_name: r.verifactu_software_name ?? "Hexa CRM",
    verifactu_software_version: r.verifactu_software_version ?? "0.3.2",
    verifactu_producer_name: r.verifactu_producer_name ?? "",
    verifactu_producer_nif: r.verifactu_producer_nif ?? "",
    updated_at: toIso(r.updated_at),
  };
}

function formatInvoice(r: any): Invoice {
  return {
    id: Number(r.id), company_id: Number(r.company_id), sale_id: r.sale_id == null ? null : Number(r.sale_id),
    project_id: r.project_id == null ? null : Number(r.project_id),
    series: r.series, number: r.number, kind: r.kind, status: r.status,
    issued_at: toIso(r.issued_at), operation_date: toIso(r.operation_date).slice(0, 10), due_at: toIso(r.due_at) || null,
    seller_legal_name: r.seller_legal_name ?? "", seller_nif: r.seller_nif ?? "", seller_trade_name: r.seller_trade_name ?? "",
    customer_id: r.customer_id == null ? null : Number(r.customer_id), customer_name: r.customer_name ?? "", customer_nif: r.customer_nif ?? "", customer_email: r.customer_email ?? "",
    lines: Array.isArray(r.lines) ? r.lines : [], base_cents: Number(r.base_cents ?? 0), vat_cents: Number(r.vat_cents ?? 0),
    irpf_rate: Number(r.irpf_rate ?? 0), irpf_cents: Number(r.irpf_cents ?? 0), total_cents: Number(r.total_cents ?? 0), paid_cents: Number(r.paid_cents ?? 0), payment_status: r.payment_status ?? "pending", notes: r.notes ?? "",
    created_by: Number(r.created_by), created_at: toIso(r.created_at), updated_at: toIso(r.updated_at),
  };
}

function formatBudget(r: any): Budget {
  return {
    id: Number(r.id), company_id: Number(r.company_id), series: String(r.series ?? "E"), number: String(r.number ?? ""),
    status: r.status as BudgetStatus, operation_date: toIso(r.operation_date).slice(0, 10), due_at: r.due_at ? toIso(r.due_at).slice(0, 10) : null,
    customer_id: r.customer_id == null ? null : Number(r.customer_id), customer_name: r.customer_name ?? "", customer_nif: r.customer_nif ?? "", customer_email: r.customer_email ?? "",
    project_explanation: r.project_explanation ?? "", lines: Array.isArray(r.lines) ? r.lines : [],
    global_discount_type: r.global_discount_type === "amount" ? "amount" : "percent", global_discount_value: Number(r.global_discount_value ?? 0), discount_cents: Number(r.discount_cents ?? 0),
    base_cents: Number(r.base_cents ?? 0), vat_cents: Number(r.vat_cents ?? 0), irpf_rate: Number(r.irpf_rate ?? 0), irpf_cents: Number(r.irpf_cents ?? 0), total_cents: Number(r.total_cents ?? 0),
    payment_method: r.payment_method ?? "", account: r.account ?? "", tags: Array.isArray(r.tags) ? r.tags : [], notes: r.notes ?? "",
    invoice_id: r.invoice_id == null ? null : Number(r.invoice_id), created_by: Number(r.created_by), created_at: toIso(r.created_at), updated_at: toIso(r.updated_at),
    accepted_at: toIso(r.accepted_at) || null, rejected_at: toIso(r.rejected_at) || null, converted_at: toIso(r.converted_at) || null,
  };
}

function normalizeBudgetLines(lines: BudgetInput["lines"]): Budget["lines"] {
  if (!Array.isArray(lines) || !lines.length) throw new Error("El presupuesto debe tener al menos una línea");
  return lines.map((raw) => {
    const description = String(raw?.description ?? "").trim();
    const quantity = Number(raw?.quantity);
    const unit_price_cents = Math.round(Number(raw?.unit_price_cents));
    const vat_rate = Number(raw?.vat_rate);
    if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unit_price_cents) || unit_price_cents < 0 || !isVatRate(vat_rate)) {
      throw new Error("Revisa las líneas, cantidades, importes e IVA del presupuesto");
    }
    const original_base_cents = Math.round(quantity * unit_price_cents);
    const discount_type = raw?.discount_type === "amount" ? "amount" : "percent";
    const discount_value = Math.max(0, Number(raw?.discount_value ?? 0));
    if (!Number.isFinite(discount_value)) throw new Error("El descuento de una línea no es válido");
    const requestedDiscount = discount_type === "percent" ? Math.round(original_base_cents * Math.min(100, discount_value) / 100) : Math.round(discount_value * 100);
    const discount_cents = Math.min(original_base_cents, requestedDiscount);
    const base_cents = original_base_cents - discount_cents;
    const vat_cents = Math.round(base_cents * vat_rate / 100);
    return { description, quantity, unit_price_cents, discount_type, discount_value, discount_cents, global_discount_cents: 0, original_base_cents, vat_rate, base_cents, vat_cents, total_cents: base_cents + vat_cents };
  });
}

async function tenantPluginRow(companyId: number, key: PluginKey) {
  const rows = await sql`
    SELECT enabled, config, encrypted_secret, last_error, updated_at
    FROM tenant_plugins
    WHERE company_id = ${companyId} AND plugin_key = ${key}
  `;
  return rows[0] ?? null;
}

async function tenantPlugin(companyId: number, key: PluginKey): Promise<TenantPlugin> {
  const definition = pluginDefinition(key);
  const row = await tenantPluginRow(companyId, key);
  const config = sanitizePluginConfig(key, row?.config ?? definition.defaultConfig);
  const enabled = !!row?.enabled;
  const secretConfigured = key === "stripe_mcp" || key === "google_drive"
    ? !!row?.encrypted_secret
    : pluginSecretConfigured(config, "database");
  const lastLogRows = await sql`
    SELECT created_at FROM plugin_audit_log
    WHERE company_id = ${companyId} AND plugin_key = ${key}
    ORDER BY id DESC LIMIT 1
  `;
  const lastCheck = lastLogRows[0]?.created_at
    ? toIso(lastLogRows[0].created_at)
    : row?.updated_at
      ? toIso(row.updated_at)
      : null;

  return {
    plugin_key: key,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    capabilities: [...definition.capabilities],
    enabled,
    config,
    secret_configured: secretConfigured,
    status: !enabled ? "inactive" : row?.last_error ? "error" : secretConfigured ? "ready" : "needs_secret",
    last_error: row?.last_error ?? null,
    last_check: lastCheck,
    updated_at: row?.updated_at ? toIso(row.updated_at) : null,
  };
}

async function pluginAudit(
  companyId: number,
  userId: number | null,
  key: PluginKey | "whatsapp_gowa",
  action: string,
  toolName?: string | null,
  result: PluginLogResult = "ok",
  summary?: string | null,
) {
  const cleanSummary = redactSensitive(summary ?? "").slice(0, 255) || null;
  await sql`
    INSERT INTO plugin_audit_log (company_id, user_id, plugin_key, action, tool_name, result, summary)
    VALUES (${companyId}, ${userId}, ${key}, ${action}, ${toolName ?? null}, ${result}, ${cleanSummary})
  `;
}

// -------------------------------------------------------------
// Core Business Operations
// -------------------------------------------------------------
export const postgresApi = {
  assert_rpc_access: assertRpcAccess,
  async public_meta(): Promise<{ shop_name: string }> {
    const companies = await sql`SELECT trade_name FROM companies WHERE active = TRUE ORDER BY id LIMIT 1`;
    if (companies[0]?.trade_name) return { shop_name: String(companies[0].trade_name) };
    const res = await sql`SELECT value FROM settings WHERE key = 'shop_name'`;
    return { shop_name: res[0]?.value || "hexa-crm" };
  },

  async login(username: string, password: string): Promise<LoginResult> {
    const userRes = await sql`
      SELECT id, username, display_name, phone, avatar_data_url, role, active, pin_hash, must_change_password, temp_password_issued_at, created_at, is_master
      FROM users
      WHERE LOWER(username) = ${username.trim().toLowerCase()} AND active = TRUE
    `;
    if (userRes.length === 0) throw new Error("Usuario o contraseña incorrectos");
    const user = userRes[0];

    const ok = await verifyCredential(password, user.pin_hash);
    if (!ok) throw new Error("Usuario o contraseña incorrectos");

    if (
      shouldRejectExpiredTemp({
        must_change_password: !!user.must_change_password,
        temp_password_issued_at: user.temp_password_issued_at ? user.temp_password_issued_at.toISOString() : null,
      })
    ) {
      throw new Error(
        "La contraseña temporal ha caducado (más de 24 h). Contacta al administrador para que genere una nueva."
      );
    }

    // Generar sesión
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const companies = await loadCompanies();
    const members = await loadMembers();
    const accessible = companiesForUser(
      user.id,
      members as { company_id: number; user_id: number; role: "admin" | "cajero" }[],
      companies,
    );
    const active_company_id = pickDefaultCompanyId(accessible);

    await sql`
      INSERT INTO sessions (token, user_id, active_company_id)
      VALUES (${token}, ${user.id}, ${active_company_id})
    `;

    // Limitar a las últimas 20 sesiones para evitar inflar la tabla
    const totalSess = await sql`SELECT token FROM sessions ORDER BY created_at DESC OFFSET 20`;
    if (totalSess.length > 0) {
      const tokensToDelete = totalSess.map((t) => t.token);
      await sql`DELETE FROM sessions WHERE token IN ${sql(tokensToDelete)}`;
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        phone: user.phone ?? "",
        avatar_data_url: user.avatar_data_url ?? "",
        role: user.role,
        active: user.active,
        created_at: toIso(user.created_at),
        must_change_password: !!user.must_change_password,
        temp_password_issued_at: toIso(user.temp_password_issued_at) || null,
        is_master: !!user.is_master,
      },
      token,
      companies: accessible,
      active_company_id,
    };
  },

  async logout(token: string | null): Promise<void> {
    if (!token) return;
    await sql`DELETE FROM sessions WHERE token = ${token}`;
  },

  async session_me(token: string | null): Promise<AuthUser | null> {
    if (!token) return null;
    try {
      return await requireSession(token);
    } catch {
      return null;
    }
  },

  async whatsapp_status(token: string | null) {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const binding = await resolveWhatsAppDevice(companyId, user.id);
    const deviceId = binding.deviceId;
    const status = await gowaStatus(deviceId);
    // The number belongs to the WhatsApp session, not to the admin profile.
    // Never surface the profile's legacy phone while the device is offline.
    const connected = status.connected || status.logged_in;
    // The device session is the source of truth. Do not fall back to the
    // profile/binding phone: those values can belong to a previous number.
    const linkedPhone = connected ? String(status.phone || "").replace(/\D/g, "") : "";
    if ((status.connected || status.logged_in) && linkedPhone) {
      await sql`INSERT INTO company_whatsapp_links (company_id,phone,device_id,linked_by,updated_at) VALUES (${companyId},${linkedPhone},${deviceId},${user.id},NOW()) ON CONFLICT (company_id) DO UPDATE SET phone=EXCLUDED.phone,device_id=EXCLUDED.device_id,linked_by=EXCLUDED.linked_by,updated_at=NOW()`;
    }
    const traceRows = await sql`SELECT value FROM settings WHERE key='whatsapp_webhook_trace' LIMIT 1`;
    let webhook_trace = null;
    try { webhook_trace = traceRows[0]?.value ? JSON.parse(traceRows[0].value) : null; } catch { webhook_trace = null; }
    const configuredPhone = String(binding.phone || "").replace(/\D/g, "");
    return { ...status, user_phone: linkedPhone, configured_phone: configuredPhone, shared_from_company_id: binding.sharedFromCompanyId, shared_from_company_name: binding.sharedFromCompanyName, webhook_trace };
  },

  async whatsapp_available_links(token: string | null) {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const rows = await sql`
      SELECT wl.company_id, c.trade_name, wl.phone, wl.device_id
      FROM company_whatsapp_links wl
      INNER JOIN companies c ON c.id = wl.company_id AND c.active = TRUE
      INNER JOIN company_members cm ON cm.company_id = wl.company_id AND cm.user_id = ${user.id}
      WHERE wl.company_id <> ${companyId}
      ORDER BY c.trade_name, c.id
    `;
    const available: { company_id: number; trade_name: string; phone: string }[] = [];
    for (const row of rows) {
      const status = await gowaStatus(String(row.device_id)).catch(() => ({ connected: false, logged_in: false, phone: undefined }));
      if (!status.connected && !status.logged_in) continue;
      available.push({
        company_id: Number(row.company_id),
        trade_name: String(row.trade_name),
        // Never expose a stale number stored in the binding when GOWA does not
        // report a phone for the current session.
        phone: String(status.phone || "").replace(/\D/g, ""),
      });
    }
    return available;
  },

  async whatsapp_use_shared_link(sourceCompanyId: number, token: string | null) {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const sourceId = Number(sourceCompanyId);
    if (!Number.isInteger(sourceId) || sourceId === companyId) throw new Error("Selecciona otra empresa con WhatsApp vinculado");
    const rows = await sql`
      SELECT wl.phone, wl.device_id, source.trade_name
      FROM company_whatsapp_links wl
      INNER JOIN companies source ON source.id = wl.company_id AND source.active = TRUE
      INNER JOIN company_members cm ON cm.company_id = wl.company_id AND cm.user_id = ${user.id}
      WHERE wl.company_id = ${sourceId}
      LIMIT 1
    `;
    if (!rows.length) throw new Error("La empresa seleccionada no tiene un WhatsApp vinculado");
    await sql`
      INSERT INTO company_whatsapp_links (company_id, phone, device_id, linked_by, updated_at)
      VALUES (${companyId}, ${String(rows[0].phone)}, ${String(rows[0].device_id)}, ${user.id}, NOW())
      ON CONFLICT (company_id) DO UPDATE SET phone=EXCLUDED.phone, device_id=EXCLUDED.device_id, linked_by=EXCLUDED.linked_by, updated_at=NOW()
    `;
    return { company_id: companyId, source_company_id: sourceId, source_company_name: String(rows[0].trade_name), phone: String(rows[0].phone) };
  },

  async whatsapp_login_qr(token: string | null) {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const binding = await resolveWhatsAppDevice(companyId, user.id);
    const status = await gowaStatus(binding.deviceId);
    // A shared binding is still the same WhatsApp session. It is safe to
    // reconnect that existing device when it is offline; only block attempts
    // to replace a session that is currently online from another company.
    if (binding.sharedFromCompanyId != null && (status.connected || status.logged_in)) {
      throw new Error("Este número de WhatsApp compartido ya está conectado en otra empresa.");
    }
    return gowaLoginQr(binding.deviceId);
  },

  async whatsapp_logout(token: string | null) {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const binding = await resolveWhatsAppDevice(companyId, user.id);
    const ownDeviceId = gowaDeviceId(companyId, user.id);
    const sharedCount = await sql`SELECT COUNT(*)::int AS count FROM company_whatsapp_links WHERE device_id=${binding.deviceId}`;
    const wasLastLink = Number(sharedCount[0]?.count ?? 0) <= 1;
    if (binding.deviceId === ownDeviceId && wasLastLink) await gowaLogout(binding.deviceId);
    await sql`DELETE FROM company_whatsapp_links WHERE company_id=${companyId}`;
    const remaining = await sql`SELECT COUNT(*)::int AS count FROM company_whatsapp_links WHERE device_id=${binding.deviceId}`;
    if (Number(remaining[0]?.count ?? 0) === 0 && !(binding.deviceId === ownDeviceId && wasLastLink)) {
      await gowaLogout(binding.deviceId);
    }
  },

  async whatsapp_send(phone: string, message: string, confirmed: boolean, token: string | null) {
    const user = await requireSession(token);
    if (!confirmed) throw new Error("Confirma el envío de WhatsApp antes de continuar");
    const companyId = await resolveActiveCompanyId(token, user.id);
    const deviceId = (await resolveWhatsAppDevice(companyId, user.id)).deviceId;
    const status = await gowaStatus(deviceId);
    if (!status.connected && !status.logged_in) throw new Error("Conecta tu WhatsApp antes de enviar mensajes");
    try {
      const result = await gowaSendText(deviceId, phone, message);
      await pluginAudit(companyId, user.id, "whatsapp_gowa", "whatsapp_sent", "send_text", "ok", `WhatsApp enviado a ${normalizeWhatsAppPhone(phone)}`);
      return { ok: true, ...result };
    } catch (error) {
      await pluginAudit(companyId, user.id, "whatsapp_gowa", "whatsapp_failed", "send_text", "error", error instanceof Error ? error.message : "Error de WhatsApp");
      throw error;
    }
  },

  /**
   * Public, bearer-token view used by the WhatsApp document link.  The token
   * is never returned to the client database/API and only its SHA-256 digest
   * is persisted.  This endpoint deliberately exposes only the media preview
   * and the choices needed to finish the upload.
   */
  async whatsapp_upload_preview(token: string) {
    const pending = await resolveWhatsAppUploadLink(token);
    const linkedCompanies = await sql`
      SELECT c.id, c.trade_name, c.legal_name, c.logo_data_url
      FROM companies c
      INNER JOIN company_whatsapp_links wl ON wl.company_id = c.id
      WHERE wl.device_id = ${pending.device_id} AND c.active = TRUE
      ORDER BY c.trade_name, c.id
    `;
    const companies = linkedCompanies.length
      ? linkedCompanies
      : pending.company_id
        ? await sql`SELECT id, trade_name, legal_name, logo_data_url FROM companies WHERE id = ${pending.company_id} AND active = TRUE`
        : [];
    const media = await gowaDownloadMessageMedia(String(pending.device_id), String(pending.message_id), String(pending.chat_jid));
    return {
      title: "Revisar documento",
      description: "Confirma el tipo para guardarlo en Gastos y facturas.",
      expires_at: toIso(pending.expires_at),
      caption: String(pending.caption ?? ""),
      preview: { data_url: media.data_url, mime_type: media.mime_type, name: media.name },
      companies: companies.map((company: any) => ({ id: Number(company.id), name: String(company.trade_name || company.legal_name || "Empresa"), logo_data_url: String(company.logo_data_url ?? "") })),
      selected_company_id: pending.company_id == null ? null : Number(pending.company_id),
      kind_options: [
        { value: "ticket", label: "Ticket" },
        { value: "invoice", label: "Factura" },
        { value: "simplified_invoice", label: "Factura simplificada" },
        { value: "credit_note", label: "Abono / rectificativa" },
        { value: "receipt", label: "Justificante" },
      ],
    };
  },

  /** Complete a public WhatsApp upload after the user confirms its type. */
  async whatsapp_upload_confirm(token: string, kind: string, companyId?: number | null) {
    const allowed = new Set(["ticket", "invoice", "simplified_invoice", "credit_note", "receipt"]);
    if (!allowed.has(kind)) throw new Error("Tipo de documento no válido.");
    const pending = await resolveWhatsAppUploadLink(token);
    const linkedCompanies = await sql`
      SELECT c.id, c.trade_name, c.legal_name, c.logo_data_url
      FROM companies c
      INNER JOIN company_whatsapp_links wl ON wl.company_id = c.id
      WHERE wl.device_id = ${pending.device_id} AND c.active = TRUE
      ORDER BY c.trade_name, c.id
    `;
    const companies = linkedCompanies.length
      ? linkedCompanies
      : pending.company_id
        ? await sql`SELECT id, trade_name, legal_name, logo_data_url FROM companies WHERE id = ${pending.company_id} AND active = TRUE`
        : [];
    const requestedCompany = companyId == null ? null : companies.find((company: any) => Number(company.id) === Number(companyId));
    const selectedCompanyId = pending.company_id == null ? requestedCompany?.id : pending.company_id;
    if (!selectedCompanyId) {
      if (companies.length > 1) throw new Error("Selecciona la empresa para este documento.");
      if (companies.length === 1) {
        // The device currently maps to exactly one active company.
        await sql`UPDATE whatsapp_expense_pending SET company_id = ${companies[0].id}, status = 'awaiting_type', updated_at = NOW() WHERE id = ${pending.pending_id} AND status = 'awaiting_company'`;
      } else {
        throw new Error("La empresa de este documento ya no está disponible.");
      }
    } else if (pending.company_id == null) {
      await sql`UPDATE whatsapp_expense_pending SET company_id = ${selectedCompanyId}, status = 'awaiting_type', updated_at = NOW() WHERE id = ${pending.pending_id} AND status = 'awaiting_company'`;
    }

    // Claim before processing so two browser tabs cannot create two expenses.
    const claimed = await sql`
      UPDATE whatsapp_expense_links
      SET used_at = NOW()
      WHERE token_hash = ${pending.token_hash} AND used_at IS NULL AND expires_at > NOW()
      RETURNING token_hash
    `;
    if (!claimed.length) throw new Error("Este enlace ya no está disponible.");
    try {
      const result = await this.processWhatsAppExpenseMessage(String(pending.device_id), {
        from: String(pending.from_phone),
        chat_jid: String(pending.chat_jid),
        body: kind,
        id: `public-upload-${pending.message_id}`,
      });
      return { ...result, selected_company_id: Number(selectedCompanyId ?? pending.company_id) };
    } catch (error) {
      // Let the user retry if GOWA is temporarily unavailable.
      await sql`UPDATE whatsapp_expense_links SET used_at = NULL WHERE token_hash = ${pending.token_hash}`.catch(() => undefined);
      throw error;
    }
  },

  async list_companies(token: string | null, includeAll = false): Promise<Company[]> {
    const user = await requireSession(token);
    const companies = await loadCompanies();
    const members = await loadMembers();
    if (includeAll && !user.is_master) throw new Error("Solo un perfil maestro puede ver todos los tenants");
    return companiesVisibleToUser(
      user.id,
      members as { company_id: number; user_id: number; role: "admin" | "cajero" }[],
      companies,
      { isMaster: !!user.is_master, includeAll },
    );
  },

  async get_active_company(token: string | null): Promise<Company | null> {
    const user = await requireSession(token);
    if (!token) return null;
    const cid = await resolveActiveCompanyId(token, user.id);
    const companies = await loadCompanies();
    return companies.find((c) => c.id === cid) ?? null;
  },

  async set_active_company(company_id: number, token: string | null): Promise<Company> {
    const user = await requireSession(token);
    if (!token) throw new Error("Sesión no iniciada");
    const members = await loadMembers();
    if (
      !canAccessCompany(
        user.id,
        company_id,
        members as { company_id: number; user_id: number; role: "admin" | "cajero" }[],
        !!user.is_master,
      )
    ) {
      throw new Error("No tienes acceso a esa empresa");
    }
    await sql`UPDATE sessions SET active_company_id = ${company_id} WHERE token = ${token}`;
    const companies = await loadCompanies();
    const c = companies.find((x) => x.id === company_id);
    if (!c) throw new Error("Empresa no encontrada");
    return c;
  },

  async update_company_profile(input: Partial<Pick<Company, "logo_data_url" | "legal_name" | "trade_name" | "nif" | "kind" | "entity_type" | "address" | "postal_code" | "city" | "province" | "country" | "email" | "phone">>, token: string | null): Promise<Company> {
    const user = await requireSession(token);
    if (!token) throw new Error("Sesión no iniciada");
    if (user.role !== "admin" && !user.is_master) throw new Error("Se requieren permisos de administrador");
    const companyId = await resolveActiveCompanyId(token, user.id);
    const currentRows = await sql`SELECT id, legal_name, trade_name, nif, kind, entity_type, address, postal_code, city, province, country, email, phone, logo_data_url FROM companies WHERE id = ${companyId} AND active = TRUE`;
    const current = currentRows[0];
    if (!current) throw new Error("Empresa no encontrada");
    const logo = input.logo_data_url === undefined ? String(current.logo_data_url ?? "") : String(input.logo_data_url ?? "");
    const logoError = validateProjectLogo(logo);
    if (logoError) throw new Error(logoError);
    const legalName = input.legal_name === undefined ? String(current.legal_name ?? "") : String(input.legal_name ?? "").trim();
    const tradeName = input.trade_name === undefined ? String(current.trade_name ?? "") : String(input.trade_name ?? "").trim();
    const nif = input.nif === undefined ? String(current.nif ?? "") : String(input.nif ?? "").trim();
    const kind = input.kind === undefined ? String(current.kind ?? "generic") : String(input.kind ?? "generic");
    const entityType = input.entity_type === undefined ? String(current.entity_type ?? "otra") : String(input.entity_type ?? "otra");
    const address = input.address === undefined ? String(current.address ?? "") : String(input.address ?? "").trim();
    const postalCode = input.postal_code === undefined ? String(current.postal_code ?? "") : String(input.postal_code ?? "").trim();
    const city = input.city === undefined ? String(current.city ?? "") : String(input.city ?? "").trim();
    const province = input.province === undefined ? String(current.province ?? "") : String(input.province ?? "").trim();
    const country = input.country === undefined ? String(current.country ?? "España") : String(input.country ?? "España").trim();
    const email = input.email === undefined ? String(current.email ?? "") : String(input.email ?? "").trim();
    const phone = input.phone === undefined ? String(current.phone ?? "") : String(input.phone ?? "").trim();
    if (!["autonomo", "sl", "sa", "cooperativa", "otra"].includes(entityType)) throw new Error("Tipo de entidad no válido");
    if (!["retail_secondhand", "software_studio", "generic"].includes(kind)) throw new Error("Tipo de empresa no válido");
    if (!legalName || !tradeName) throw new Error("El nombre legal y el nombre comercial son obligatorios");
    const rows = await sql`
      UPDATE companies
      SET legal_name = ${legalName}, trade_name = ${tradeName}, nif = ${nif}, kind = ${kind}, entity_type = ${entityType}, address = ${address}, postal_code = ${postalCode}, city = ${city}, province = ${province}, country = ${country}, email = ${email}, phone = ${phone}, logo_data_url = ${logo}
      WHERE id = ${companyId} AND active = TRUE
      RETURNING *
    `;
    const r: any = rows[0];
    return { id: r.id, code: r.code, legal_name: r.legal_name, trade_name: r.trade_name, nif: r.nif, kind: r.kind, entity_type: r.entity_type ?? "otra", address: String(r.address ?? ""), postal_code: String(r.postal_code ?? ""), city: String(r.city ?? ""), province: String(r.province ?? ""), country: String(r.country ?? "España"), email: String(r.email ?? ""), phone: String(r.phone ?? ""), logo_data_url: String(r.logo_data_url ?? ""), active: !!r.active, created_at: toIso(r.created_at) };
  },

  async create_company(input: CompanyInput, token: string | null): Promise<Company> {
    const user = await requireSession(token);
    if (user.role !== "admin" && !user.is_master) throw new Error("Se requieren permisos de administrador");
    const legalName = String(input.legal_name ?? "").trim();
    const tradeName = String(input.trade_name ?? legalName).trim();
    if (!legalName || !tradeName) throw new Error("El nombre legal y el nombre comercial son obligatorios");
    const entityType = String(input.entity_type ?? "otra");
    if (!["autonomo", "sl", "sa", "cooperativa", "otra"].includes(entityType)) throw new Error("Tipo de entidad no válido");
    const kind = input.kind ?? "generic";
    if (!["retail_secondhand", "software_studio", "generic"].includes(kind)) throw new Error("Tipo de negocio no válido");
    const logo = String(input.logo_data_url ?? "");
    const logoError = validateProjectLogo(logo);
    if (logoError) throw new Error(logoError);
    const requestedCode = String(input.code ?? tradeName).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 12);
    const baseCode = requestedCode || `EMPRESA-${Date.now().toString().slice(-6)}`;
    let code = baseCode;
    let suffix = 2;
    while ((await sql`SELECT id FROM companies WHERE code = ${code} LIMIT 1`).length) {
      code = `${baseCode.slice(0, Math.max(1, 12 - String(suffix).length - 1))}-${suffix++}`;
    }
    const rows = await sql`
      INSERT INTO companies (code, legal_name, trade_name, nif, kind, entity_type, address, postal_code, city, province, country, email, phone, logo_data_url)
      VALUES (${code}, ${legalName}, ${tradeName}, ${String(input.nif ?? "").trim()}, ${kind}, ${entityType}, ${String(input.address ?? "").trim()}, ${String(input.postal_code ?? "").trim()}, ${String(input.city ?? "").trim()}, ${String(input.province ?? "").trim()}, ${String(input.country ?? "España").trim() || "España"}, ${String(input.email ?? "").trim()}, ${String(input.phone ?? "").trim()}, ${logo})
      RETURNING *
    `;
    const row: any = rows[0];
    await sql`INSERT INTO company_members (company_id, user_id, role) VALUES (${row.id}, ${user.id}, 'admin') ON CONFLICT (company_id, user_id) DO NOTHING`;
    return {
      id: row.id, code: row.code, legal_name: row.legal_name, trade_name: row.trade_name,
      nif: row.nif, kind: row.kind, entity_type: row.entity_type ?? "otra",
      address: String(row.address ?? ""), postal_code: String(row.postal_code ?? ""), city: String(row.city ?? ""), province: String(row.province ?? ""), country: String(row.country ?? "España"), email: String(row.email ?? ""), phone: String(row.phone ?? ""), logo_data_url: String(row.logo_data_url ?? ""), active: !!row.active, created_at: toIso(row.created_at),
    };
  },

  async billing_by_company(token: string | null) {
    const user = await requireSession(token);
    const companies = await loadCompanies();
    const members = await loadMembers();
    const visible = companiesVisibleToUser(
      user.id,
      members as { company_id: number; user_id: number; role: "admin" | "cajero" }[],
      companies,
      { isMaster: !!user.is_master, includeAll: false },
    );
    const visibleIds = visible.map((company) => company.id);
    if (!visibleIds.length) return [];
    const sales = await sql`
      SELECT company_id, total_cents, status FROM sales
      WHERE company_id IN ${sql(visibleIds)}
    `;
    return billingByCompany(
      sales.map((s) => ({
        company_id: s.company_id,
        total_cents: s.total_cents,
        status: s.status,
      })),
      visible,
    );
  },

  /** Consulta de solo lectura para ver el grupo sin cambiar de empresa activa. */
  async group_financial_summary(token: string | null) {
    const user = await requireSession(token);
    if (!token) throw new Error("Sesión no iniciada");
    const companies = await loadCompanies();
    const members = await loadMembers();
    const visible = companiesVisibleToUser(
      user.id,
      members as { company_id: number; user_id: number; role: "admin" | "cajero" }[],
      companies,
      { isMaster: !!user.is_master, includeAll: false },
    );
    return Promise.all(visible.map(async (company) => {
      const [invoices, expenses, payments, cash] = await Promise.all([
        sql`SELECT COALESCE(SUM(total_cents) FILTER (WHERE status = 'issued'), 0)::int AS issued_total, COALESCE(SUM(paid_cents) FILTER (WHERE status = 'issued'), 0)::int AS issued_paid FROM invoices WHERE company_id = ${company.id}`,
        sql`SELECT COALESCE(SUM(total_cents) FILTER (WHERE status IN ('review','approved','paid')), 0)::int AS received_total FROM expense_documents WHERE company_id = ${company.id}`,
        sql`SELECT COALESCE(SUM(amount_cents), 0)::int AS received_paid FROM expense_payments WHERE company_id = ${company.id}`,
        sql`SELECT COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'income'), 0)::int AS cash_income, COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'expense'), 0)::int AS cash_expense FROM cash_movements WHERE company_id = ${company.id}`,
      ]);
      const issuedTotal = Number(invoices[0]?.issued_total ?? 0);
      const issuedPaid = Number(invoices[0]?.issued_paid ?? 0);
      return {
        company_id: company.id,
        code: company.code,
        trade_name: company.trade_name,
        issued_total_cents: issuedTotal,
        issued_paid_cents: issuedPaid,
        issued_pending_cents: Math.max(0, issuedTotal - issuedPaid),
        received_total_cents: Number(expenses[0]?.received_total ?? 0),
        received_paid_cents: Number(payments[0]?.received_paid ?? 0),
        cash_income_cents: Number(cash[0]?.cash_income ?? 0),
        cash_expense_cents: Number(cash[0]?.cash_expense ?? 0),
      };
    }));
  },

  async list_plugins(token: string | null): Promise<TenantPlugin[]> {
    const user = await requireSession(token);
    if (!token) throw new Error("Sesión no iniciada");
    const companyId = await resolveActiveCompanyId(token, user.id);
    return Promise.all(PLUGIN_CATALOG.map((plugin) => tenantPlugin(companyId, plugin.key)));
  },

  async update_plugin(
    pluginKey: PluginKey,
    enabled: boolean,
    inputConfig: unknown,
    token: string | null,
    secretAction?: "save" | "replace" | "remove" | "keep",
    secretInput?: string | null,
  ): Promise<TenantPlugin> {
    const user = await requireAdmin(token);
    if (!token) throw new Error("Sesión no iniciada");
    pluginDefinition(pluginKey);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const config = sanitizePluginConfig(pluginKey, inputConfig);

    const rawInput = inputConfig && typeof inputConfig === "object" ? (inputConfig as Record<string, unknown>) : {};
    const action = secretAction ?? (rawInput.secret_action as "save" | "replace" | "remove" | "keep" | undefined);
    const rawSecret = secretInput ?? (typeof rawInput.secret === "string" ? rawInput.secret : null);

    let encryptedSecret: string | null | undefined = undefined;

    if ((pluginKey === "stripe_mcp" || pluginKey === "google_drive") && action) {
      if (action === "save" || action === "replace") {
        if (!rawSecret || !rawSecret.trim()) {
          throw new Error(`Debes proporcionar una credencial válida de ${pluginKey === "google_drive" ? "Google Drive" : "Stripe"}`);
        }
        encryptedSecret = encryptSecret(rawSecret.trim());
      } else if (action === "remove") {
        encryptedSecret = null;
      }
    }

    if (encryptedSecret !== undefined) {
      await sql`
        INSERT INTO tenant_plugins (company_id, plugin_key, enabled, config, encrypted_secret, last_error, updated_at)
        VALUES (${companyId}, ${pluginKey}, ${enabled}, ${sql.json(config as any)}, ${encryptedSecret}, NULL, NOW())
        ON CONFLICT (company_id, plugin_key) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          config = EXCLUDED.config,
          encrypted_secret = EXCLUDED.encrypted_secret,
          last_error = NULL,
          updated_at = NOW()
      `;
    } else {
      await sql`
        INSERT INTO tenant_plugins (company_id, plugin_key, enabled, config, last_error, updated_at)
        VALUES (${companyId}, ${pluginKey}, ${enabled}, ${sql.json(config as any)}, NULL, NOW())
        ON CONFLICT (company_id, plugin_key) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          config = EXCLUDED.config,
          last_error = NULL,
          updated_at = NOW()
      `;
    }

    const secretLabel = pluginKey === "google_drive" ? "Google Drive" : "Stripe";
    const auditSummary = action === "remove"
      ? `Credencial de ${secretLabel} eliminada`
      : action === "replace"
        ? `Credencial de ${secretLabel} reemplazada`
        : action === "save"
          ? `Credencial de ${secretLabel} guardada`
          : enabled
            ? "Configuración guardada y plugin activado"
            : "Plugin desactivado";

    await pluginAudit(
      companyId,
      user.id,
      pluginKey,
      action === "remove" ? "secret_removed" : enabled ? "enabled_or_updated" : "disabled",
      null,
      "ok",
      auditSummary,
    );
    return tenantPlugin(companyId, pluginKey);
  },

  async test_plugin(pluginKey: PluginKey, token: string | null): Promise<PluginTestResult> {
    const user = await requireAdmin(token);
    if (!token) throw new Error("Sesión no iniciada");
    pluginDefinition(pluginKey);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const plugin = await tenantPlugin(companyId, pluginKey);
    if (!plugin.enabled) {
      await pluginAudit(
        companyId,
        user.id,
        pluginKey,
        "connection_test_failed",
        null,
        "error",
        "Activa y guarda el plugin antes de probarlo",
      );
      throw new Error("Activa y guarda el plugin antes de probarlo");
    }

    let decryptedToken: string | undefined = undefined;

    if (pluginKey === "stripe_mcp" || pluginKey === "google_drive") {
      const row = await tenantPluginRow(companyId, pluginKey);
      if (!row?.encrypted_secret) {
        const msg = `Ingresa y guarda la credencial de ${pluginKey === "google_drive" ? "Google Drive" : "Stripe"} antes de probar la conexión`;
        await pluginAudit(companyId, user.id, pluginKey, "connection_test_failed", null, "error", msg);
        throw new Error(msg);
      }
      decryptedToken = decryptSecret(row.encrypted_secret);
    }

    try {
      const result = pluginKey === "database_bridge"
        ? await testDatabasePlugin(plugin.config)
        : pluginKey === "google_drive"
          ? await testGoogleDrive(decryptedToken ?? "")
          : await testStripePlugin(plugin.config, decryptedToken);

      await sql`UPDATE tenant_plugins SET last_error = NULL, updated_at = NOW() WHERE company_id = ${companyId} AND plugin_key = ${pluginKey}`;
      await pluginAudit(companyId, user.id, pluginKey, "connection_test_ok", null, "ok", result.message);
      return result;
    } catch (error) {
      const message = redactSensitive(error instanceof Error ? error.message : "No se pudo conectar");
      await sql`UPDATE tenant_plugins SET last_error = ${message.slice(0, 500)}, updated_at = NOW() WHERE company_id = ${companyId} AND plugin_key = ${pluginKey}`;
      await pluginAudit(companyId, user.id, pluginKey, "connection_test_failed", null, "error", message);
      throw new Error(message);
    }
  },

  async upload_project_file(input: StorageUploadInput, token: string | null): Promise<StorageUploadResult> {
    const user = await requireAdmin(token);
    if (!token) throw new Error("Sesión no iniciada");
    const companyId = await resolveActiveCompanyId(token, user.id);
    if (input.provider !== "google_drive") throw new Error("Proveedor de almacenamiento no soportado");
    const projects = await sql`SELECT id FROM work_projects WHERE id = ${input.project_id} AND (company_id = ${companyId} OR task_company_id = ${companyId})`;
    if (!projects[0]) throw new Error("Proyecto no encontrado");
    const plugin = await tenantPlugin(companyId, "google_drive");
    const row = await tenantPluginRow(companyId, "google_drive");
    if (!plugin.enabled || !row?.encrypted_secret) {
      throw new Error("Configura y activa Google Drive en Ajustes → Plugins");
    }
    const result = await uploadToGoogleDrive(plugin.config, decryptSecret(row.encrypted_secret), {
      name: input.name,
      mime_type: input.mime_type,
      bytes: decodeBase64File(input.content_base64),
    });
    await pluginAudit(companyId, user.id, "google_drive", "file_uploaded", null, "ok", `${result.name} (${result.size} bytes)`);
    return result;
  },

  async list_plugin_tools(pluginKey: PluginKey, token: string | null): Promise<any[]> {
    const user = await requireSession(token);
    if (!token) throw new Error("Sesión no iniciada");
    if (pluginKey !== "stripe_mcp") return [];
    const companyId = await resolveActiveCompanyId(token, user.id);
    const plugin = await tenantPlugin(companyId, pluginKey);
    if (!plugin.enabled || !plugin.secret_configured) return [];
    const row = await tenantPluginRow(companyId, pluginKey);
    if (!row?.encrypted_secret) return [];
    const secretToken = decryptSecret(row.encrypted_secret);
    const tools = await listStripeTools(plugin.config, secretToken);
    return tools.filter((tool) => stripeToolAccess(String(tool?.name ?? ""), plugin.config).allowed);
  },

  async call_plugin_tool(
    pluginKey: PluginKey,
    toolName: string,
    args: Record<string, unknown>,
    confirmed: boolean,
    token: string | null,
  ): Promise<PluginToolResult> {
    const user = await requireSession(token);
    if (!token) throw new Error("Sesión no iniciada");
    if (pluginKey !== "stripe_mcp") throw new Error("Este plugin no expone herramientas al asistente");
    const companyId = await resolveActiveCompanyId(token, user.id);
    const plugin = await tenantPlugin(companyId, pluginKey);
    if (!plugin.enabled) {
      await pluginAudit(
        companyId,
        user.id,
        pluginKey,
        "tool_requested",
        toolName,
        "blocked",
        "El plugin Stripe MCP no está activo para esta tienda",
      );
      throw new Error("El plugin Stripe MCP no está activo para esta tienda");
    }
    const access = stripeToolAccess(toolName, plugin.config);
    if (!access.allowed) {
      await pluginAudit(
        companyId,
        user.id,
        pluginKey,
        "tool_blocked_permission",
        toolName,
        "blocked",
        "Herramienta de Stripe no permitida en este tenant",
      );
      throw new Error("Herramienta de Stripe no permitida en este tenant");
    }
    if (access.write) {
      if (user.role !== "admin") {
        await pluginAudit(
          companyId,
          user.id,
          pluginKey,
          "tool_blocked_permission",
          toolName,
          "blocked",
          "Las operaciones de Stripe requieren un administrador",
        );
        throw new Error("Las operaciones de Stripe requieren un administrador");
      }
      if (!confirmed) {
        await pluginAudit(
          companyId,
          user.id,
          pluginKey,
          "tool_blocked_approval",
          toolName,
          "blocked",
          "Esta operación necesita confirmación explícita",
        );
        throw new Error("Esta operación necesita confirmación explícita");
      }
    }
    const row = await tenantPluginRow(companyId, pluginKey);
    if (!row?.encrypted_secret) {
      throw new Error("No hay credencial de Stripe configurada para esta tienda");
    }
    const secretToken = decryptSecret(row.encrypted_secret);
    try {
      const result = await callStripeTool(plugin.config, toolName, args ?? {}, secretToken);
      await pluginAudit(
        companyId,
        user.id,
        pluginKey,
        access.write ? "tool_write" : "tool_read",
        toolName,
        "ok",
        `Ejecución exitosa de ${toolName}`,
      );
      return result;
    } catch (err) {
      const msg = redactSensitive(err instanceof Error ? err.message : String(err));
      await pluginAudit(companyId, user.id, pluginKey, "tool_error", toolName, "error", msg);
      throw err;
    }
  },

  async list_plugin_logs(
    pluginKey: PluginKey,
    limit = 20,
    token: string | null,
  ): Promise<PluginAuditLogEntry[]> {
    const user = await requireAdmin(token);
    if (!token) throw new Error("Sesión no iniciada");
    pluginDefinition(pluginKey);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const maxLimit = Math.min(Math.max(1, limit), 100);

    const rows = await sql`
      SELECT l.id, l.company_id, l.user_id, u.display_name AS actor_name, l.plugin_key, l.action, l.tool_name, l.result, l.summary, l.created_at
      FROM plugin_audit_log l
      LEFT JOIN users u ON u.id = l.user_id
      WHERE l.company_id = ${companyId} AND l.plugin_key = ${pluginKey}
      ORDER BY l.id DESC
      LIMIT ${maxLimit}
    `;

    return rows.map((r) => ({
      id: Number(r.id),
      company_id: Number(r.company_id),
      user_id: r.user_id ? Number(r.user_id) : null,
      actor_name: r.actor_name ?? "Sistema",
      plugin_key: r.plugin_key as PluginKey,
      action: r.action,
      tool_name: r.tool_name ?? null,
      result: (r.result as PluginLogResult) || "ok",
      summary: r.summary ?? null,
      created_at: toIso(r.created_at),
    }));
  },

  async list_employees(token: string | null): Promise<Employee[]> {
    const actor = await requireAdmin(token);
    const companyId = await resolveActiveCompanyId(token, actor.id);
    const rows = await sql`SELECT * FROM employees WHERE company_id=${companyId} ORDER BY status, last_name, first_name`;
    return rows.map((r) => ({ ...r, id:Number(r.id), company_id:Number(r.company_id), user_id:r.user_id?Number(r.user_id):null, annual_gross_cents:Number(r.annual_gross_cents), payments_per_year:Number(r.payments_per_year), start_date:r.start_date?toIso(r.start_date).slice(0,10):null, end_date:r.end_date?toIso(r.end_date).slice(0,10):null, documents:Array.isArray(r.documents)?r.documents:[], created_at:toIso(r.created_at), updated_at:toIso(r.updated_at) })) as Employee[];
  },

  async upsert_employee(input: EmployeeInput, token: string | null): Promise<Employee> {
    const actor = await requireAdmin(token);
    const companyId = await resolveActiveCompanyId(token, actor.id);
    const firstName=(input.first_name??"").trim(), lastName=(input.last_name??"").trim();
    if(!firstName||!lastName) throw new Error("Nombre y apellidos son obligatorios");
    if(input.user_id){ const member=await sql`SELECT 1 FROM company_members WHERE company_id=${companyId} AND user_id=${input.user_id}`; if(!member.length) throw new Error("El usuario no pertenece a esta empresa"); }
    const values={ user_id:input.user_id??null, first_name:firstName,last_name:lastName,tax_id:(input.tax_id??"").trim(),social_security_number:(input.social_security_number??"").trim(),email:(input.email??"").trim(),phone:(input.phone??"").trim(),position:(input.position??"").trim(),contract_type:(input.contract_type??"").trim(),work_schedule:(input.work_schedule??"").trim(),collective_agreement:(input.collective_agreement??"").trim(),professional_group:(input.professional_group??"").trim(),start_date:input.start_date||null,end_date:input.end_date||null,annual_gross_cents:Math.max(0,Number(input.annual_gross_cents??0)),payments_per_year:[12,14].includes(Number(input.payments_per_year))?Number(input.payments_per_year):12,iban:(input.iban??"").trim(),status:input.status??"active",notes:input.notes??"",documents:input.documents??[] };
    let id:number;
    if(input.id){ const rows=await sql`UPDATE employees SET user_id=${values.user_id},first_name=${values.first_name},last_name=${values.last_name},tax_id=${values.tax_id},social_security_number=${values.social_security_number},email=${values.email},phone=${values.phone},position=${values.position},contract_type=${values.contract_type},work_schedule=${values.work_schedule},collective_agreement=${values.collective_agreement},professional_group=${values.professional_group},start_date=${values.start_date},end_date=${values.end_date},annual_gross_cents=${values.annual_gross_cents},payments_per_year=${values.payments_per_year},iban=${values.iban},status=${values.status},notes=${values.notes},documents=${sql.json(values.documents as any)},updated_at=NOW() WHERE id=${input.id} AND company_id=${companyId} RETURNING id`; if(!rows.length) throw new Error("Empleado no encontrado"); id=Number(rows[0].id); }
    else { const rows=await sql`INSERT INTO employees(company_id,user_id,first_name,last_name,tax_id,social_security_number,email,phone,position,contract_type,work_schedule,collective_agreement,professional_group,start_date,end_date,annual_gross_cents,payments_per_year,iban,status,notes,documents) VALUES(${companyId},${values.user_id},${values.first_name},${values.last_name},${values.tax_id},${values.social_security_number},${values.email},${values.phone},${values.position},${values.contract_type},${values.work_schedule},${values.collective_agreement},${values.professional_group},${values.start_date},${values.end_date},${values.annual_gross_cents},${values.payments_per_year},${values.iban},${values.status},${values.notes},${sql.json(values.documents as any)}) RETURNING id`; id=Number(rows[0].id); }
    return (await this.list_employees(token)).find((e)=>e.id===id)!;
  },

  async list_payrolls(employeeId: number | null, token: string | null): Promise<Payroll[]> {
    const actor=await requireAdmin(token); const companyId=await resolveActiveCompanyId(token,actor.id);
    const rows=employeeId?await sql`SELECT * FROM payrolls WHERE company_id=${companyId} AND employee_id=${employeeId} ORDER BY period DESC`:await sql`SELECT * FROM payrolls WHERE company_id=${companyId} ORDER BY period DESC`;
    return rows.map((r)=>({...r,id:Number(r.id),company_id:Number(r.company_id),employee_id:Number(r.employee_id),gross_cents:Number(r.gross_cents),employee_ss_cents:Number(r.employee_ss_cents),irpf_cents:Number(r.irpf_cents),other_deductions_cents:Number(r.other_deductions_cents),net_cents:Number(r.net_cents),employer_ss_cents:Number(r.employer_ss_cents),total_cost_cents:Number(r.total_cost_cents),cash_movement_id:r.cash_movement_id?Number(r.cash_movement_id):null,paid_at:r.paid_at?toIso(r.paid_at):null,created_at:toIso(r.created_at),updated_at:toIso(r.updated_at)})) as Payroll[];
  },

  async upsert_payroll(input: PayrollInput, token: string | null): Promise<Payroll> {
    const actor=await requireAdmin(token); const companyId=await resolveActiveCompanyId(token,actor.id);
    if(!/^\d{4}-\d{2}$/.test(input.period)) throw new Error("Periodo de nómina no válido");
    const employee=await sql`SELECT id FROM employees WHERE id=${input.employee_id} AND company_id=${companyId}`; if(!employee.length) throw new Error("Empleado no encontrado");
    const n=(value:unknown)=>Math.max(0,Number(value??0)); const gross=n(input.gross_cents), ess=n(input.employee_ss_cents), irpf=n(input.irpf_cents), other=n(input.other_deductions_cents), net=input.net_cents===undefined?Math.max(0,gross-ess-irpf-other):n(input.net_cents), employer=n(input.employer_ss_cents), total=input.total_cost_cents===undefined?gross+employer:n(input.total_cost_cents);
    const common={gross,ess,irpf,other,net,employer,total,status:input.status??"draft",document_name:input.document_name??"",document_url:input.document_url??"",paid_at:input.paid_at??null,cash_movement_id:input.cash_movement_id??null,notes:input.notes??""}; let id:number;
    if(input.id){const rows=await sql`UPDATE payrolls SET period=${input.period},gross_cents=${gross},employee_ss_cents=${ess},irpf_cents=${irpf},other_deductions_cents=${other},net_cents=${net},employer_ss_cents=${employer},total_cost_cents=${total},status=${common.status},document_name=${common.document_name},document_url=${common.document_url},paid_at=${common.paid_at},cash_movement_id=${common.cash_movement_id},notes=${common.notes},updated_at=NOW() WHERE id=${input.id} AND employee_id=${input.employee_id} AND company_id=${companyId} RETURNING id`;if(!rows.length)throw new Error("Nómina no encontrada");id=Number(rows[0].id);}else{const rows=await sql`INSERT INTO payrolls(company_id,employee_id,period,gross_cents,employee_ss_cents,irpf_cents,other_deductions_cents,net_cents,employer_ss_cents,total_cost_cents,status,document_name,document_url,paid_at,cash_movement_id,notes) VALUES(${companyId},${input.employee_id},${input.period},${gross},${ess},${irpf},${other},${net},${employer},${total},${common.status},${common.document_name},${common.document_url},${common.paid_at},${common.cash_movement_id},${common.notes}) ON CONFLICT(company_id,employee_id,period) DO UPDATE SET gross_cents=EXCLUDED.gross_cents,employee_ss_cents=EXCLUDED.employee_ss_cents,irpf_cents=EXCLUDED.irpf_cents,other_deductions_cents=EXCLUDED.other_deductions_cents,net_cents=EXCLUDED.net_cents,employer_ss_cents=EXCLUDED.employer_ss_cents,total_cost_cents=EXCLUDED.total_cost_cents,status=EXCLUDED.status,document_name=EXCLUDED.document_name,document_url=EXCLUDED.document_url,paid_at=EXCLUDED.paid_at,cash_movement_id=EXCLUDED.cash_movement_id,notes=EXCLUDED.notes,updated_at=NOW() RETURNING id`;id=Number(rows[0].id);} return (await this.list_payrolls(input.employee_id,token)).find((p)=>p.id===id)!;
  },

  async list_users(token: string | null): Promise<AuthUser[]> {
    const actor = await requireAdmin(token);
    const companyId = await resolveActiveCompanyId(token, actor.id);
    // User management is tenant-scoped. A normal company administrator must
    // never see or mutate accounts that only belong to another company. The
    // master account is the sole exception and can administer all tenants.
    const users = actor.is_master
      ? await sql`
          SELECT id, username, display_name, phone, avatar_data_url, role, active, created_at, must_change_password, temp_password_issued_at, is_master
          FROM users
          ORDER BY id ASC
        `
      : await sql`
          SELECT u.id, u.username, u.display_name, u.phone, u.avatar_data_url, u.role, u.active, u.created_at, u.must_change_password, u.temp_password_issued_at, u.is_master
          FROM users u
          INNER JOIN company_members cm ON cm.user_id = u.id AND cm.company_id = ${companyId}
          ORDER BY u.id ASC
        `;
    const access = await sql`
      SELECT user_id, project_id FROM project_client_access
      WHERE user_id = ANY(${users.map((u) => Number(u.id))}::int[])
    `;
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      phone: u.phone ?? "",
      avatar_data_url: u.avatar_data_url ?? "",
      role: u.role,
      active: u.active,
      created_at: toIso(u.created_at),
      must_change_password: !!u.must_change_password,
      temp_password_issued_at: toIso(u.temp_password_issued_at) || null,
      is_master: !!u.is_master,
      project_ids: access.filter((row) => Number(row.user_id) === Number(u.id)).map((row) => Number(row.project_id)),
    }));
  },

  async upsert_user(input: UserInput, token: string | null): Promise<CreateUserResult> {
    const actor = await requireAdmin(token);
    // Users are created from the active company context.  Previously the
    // account was inserted in `users` only, leaving it without a
    // `company_members` row.  Such a user could authenticate but received no
    // active company, which made the Dev workspace (and its project sections)
    // disappear on a fresh browser/session.
    const activeCompanyId = await resolveActiveCompanyId(token, actor.id);
    const now = new Date();
    const role = input.role === "cliente" ? "cliente" : input.role === "cajero" ? "cajero" : "admin";
    if (role === "cliente") {
      const companies = await sql`SELECT kind FROM companies WHERE id = ${activeCompanyId}`;
      if (companies[0]?.kind !== "software_studio") {
        throw new Error("El rol cliente solo está disponible para empresas Dev.");
      }
      if (!input.project_ids?.length) throw new Error("Asigna al menos un proyecto al cliente.");
    }
    const username = input.username.trim().toLowerCase();
    if (!username) throw new Error("Usuario obligatorio");
    const avatarError = validateUserAvatar(input.avatar_data_url);
    if (avatarError) throw new Error(avatarError);

    if (input.id) {
      if (!actor.is_master) {
        const member = await sql`
          SELECT 1 FROM company_members
          WHERE company_id = ${activeCompanyId} AND user_id = ${input.id}
          LIMIT 1
        `;
        if (!member.length) throw new Error("El usuario no pertenece a la empresa activa");
      }
      const updateData: Record<string, unknown> = {
        username,
        display_name: input.display_name.trim() || username,
        role,
        active: input.active ?? true,
      };
      if (input.phone !== undefined) updateData.phone = input.phone.trim();
      if (input.avatar_data_url !== undefined) updateData.avatar_data_url = input.avatar_data_url;

      let temporary_password: string | undefined;
      if (input.pin === "__regen_temp__") {
        temporary_password = generateTempPassword();
        const fields = issueTempCredentialFields();
        updateData.pin_hash = await hashCredential(temporary_password);
        updateData.must_change_password = fields.must_change_password;
        updateData.temp_password_issued_at = fields.temp_password_issued_at
          ? new Date(fields.temp_password_issued_at)
          : now;
      } else if (input.pin) {
        const pinOk = !validatePin(input.pin);
        const pwOk = !validatePermanentPassword(input.pin);
        if (!pinOk && !pwOk) {
          throw new Error(validatePermanentPassword(input.pin) || "Credencial no válida");
        }
        updateData.pin_hash = await hashCredential(input.pin);
        const cleared = clearTempCredentialFields();
        updateData.must_change_password = cleared.must_change_password;
        updateData.temp_password_issued_at = null;
      }

      const res = await sql`
        UPDATE users
        SET ${sql(updateData)}
        WHERE id = ${input.id}
        RETURNING id, username, display_name, phone, avatar_data_url, role, active, created_at, must_change_password, temp_password_issued_at, is_master
      `;
      if (res.length === 0) throw new Error("Usuario no encontrado");
      const u = res[0];
      await sql`
        INSERT INTO company_members (company_id, user_id, role)
        VALUES (${activeCompanyId}, ${u.id}, ${role})
        ON CONFLICT (company_id, user_id) DO UPDATE SET role = EXCLUDED.role
      `;
      await syncProjectClientAccess(Number(u.id), role, input.project_ids, activeCompanyId);
      return {
        user: {
          id: u.id,
          username: u.username,
          display_name: u.display_name,
          phone: u.phone ?? "",
          avatar_data_url: u.avatar_data_url ?? "",
          role: u.role,
          active: u.active,
          created_at: toIso(u.created_at),
          must_change_password: !!u.must_change_password,
          temp_password_issued_at: toIso(u.temp_password_issued_at) || null,
          is_master: !!u.is_master,
        },
        temporary_password,
      };
    }

    const temporary_password = generateTempPassword();
    const fields = issueTempCredentialFields();
    const hash = await hashCredential(temporary_password);

    const res = await sql`
      INSERT INTO users (username, display_name, phone, avatar_data_url, role, pin_hash, active, must_change_password, temp_password_issued_at)
      VALUES (
        ${username},
        ${input.display_name.trim() || username},
        ${input.phone?.trim() ?? ""},
        ${input.avatar_data_url ?? ""},
        ${role},
        ${hash},
        ${input.active ?? true},
        ${fields.must_change_password},
        ${fields.temp_password_issued_at ? new Date(fields.temp_password_issued_at) : now}
      )
      RETURNING id, username, display_name, phone, avatar_data_url, role, active, created_at, must_change_password, temp_password_issued_at, is_master
    `;
    const u = res[0];
    await sql`
      INSERT INTO company_members (company_id, user_id, role)
      VALUES (${activeCompanyId}, ${u.id}, ${role})
      ON CONFLICT (company_id, user_id) DO UPDATE SET role = EXCLUDED.role
    `;
    await syncProjectClientAccess(Number(u.id), role, input.project_ids, activeCompanyId);
    return {
      user: {
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        phone: u.phone ?? "",
        avatar_data_url: u.avatar_data_url ?? "",
        role: u.role,
        active: u.active,
        created_at: toIso(u.created_at),
        must_change_password: !!u.must_change_password,
        temp_password_issued_at: toIso(u.temp_password_issued_at) || null,
        is_master: !!u.is_master,
      },
      temporary_password,
    };
  },

  async change_own_pin(current_pin: string, new_pin: string, token: string | null): Promise<void> {
    const me = await requireSession(token);
    const userRes = await sql`SELECT pin_hash FROM users WHERE id = ${me.id}`;
    const user = userRes[0];
    const ok = await verifyCredential(current_pin, user.pin_hash);
    if (!ok) throw new Error("PIN actual incorrecto");

    const newHash = await hashCredential(new_pin);
    await sql`
      UPDATE users
      SET pin_hash = ${newHash}, must_change_password = FALSE, temp_password_issued_at = NULL
      WHERE id = ${me.id}
    `;
  },

  async complete_forced_password_change(current_password: string, new_password: string, token: string | null): Promise<AuthUser> {
    const me = await requireSession(token);
    const userRes = await sql`SELECT pin_hash FROM users WHERE id = ${me.id}`;
    const user = userRes[0];
    const ok = await verifyCredential(current_password, user.pin_hash);
    if (!ok) throw new Error("Contraseña actual incorrecta");

    const newHash = await hashCredential(new_password);
    const res = await sql`
      UPDATE users
      SET pin_hash = ${newHash}, must_change_password = FALSE, temp_password_issued_at = NULL
      WHERE id = ${me.id}
      RETURNING id, username, display_name, phone, avatar_data_url, role, active, created_at, must_change_password, temp_password_issued_at, is_master
    `;
    const u = res[0];
    return {
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      phone: u.phone ?? "",
      avatar_data_url: u.avatar_data_url ?? "",
      role: u.role,
      active: u.active,
      created_at: toIso(u.created_at),
      must_change_password: !!u.must_change_password,
      temp_password_issued_at: toIso(u.temp_password_issued_at) || null,
      is_master: !!u.is_master,
    };
  },

  async list_products(active_only: boolean, token: string | null): Promise<Product[]> {
    const user = await requireSession(token);
    if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);
    const products = active_only
      ? await sql`SELECT * FROM products WHERE active = TRUE AND company_id = ${cid} AND publication_status = 'published' AND sales_policy != 'not_sellable' AND supply_status NOT IN ('ordered', 'in_transit', 'negotiating', 'quality_hold') ORDER BY name ASC`
      : await sql`SELECT * FROM products WHERE company_id = ${cid} ORDER BY name ASC`;

    return products.map((p) => ({
      id: p.id,
      company_id: p.company_id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      category: p.category,
      stock: p.stock,
      min_stock: p.min_stock,
      cost_cents: p.cost_cents,
      price_cents: p.price_cents,
      vat_rate: p.vat_rate,
      supplier_name: p.supplier_name || "",
      supplier_contact: p.supplier_contact || "",
      supplier_email: p.supplier_email || "",
      supplier_phone: p.supplier_phone || "",
      fulfillment_mode: p.fulfillment_mode || "own_stock",
      stock_location: p.stock_location || "Almacén principal",
      condition_code: p.condition_code || "used",
      publication_status: p.publication_status || "published",
      sales_policy: p.sales_policy || "own_stock",
      supplier_source_status: p.supplier_source_status || "not_applicable",
      supply_status: p.supply_status || "not_applicable",
      supplier_last_verified_at: toIso(p.supplier_last_verified_at) || null,
      availability_eta: toIso(p.availability_eta) || null,
      active: !!p.active,
      created_at: toIso(p.created_at),
      updated_at: toIso(p.updated_at),
    }));
  },

  async upsert_product(input: ProductInput, token: string | null): Promise<Product> {
    const user = await requireSession(token);
    if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);
    const now = new Date();

    if (input.id) {
      // Update
      const existingRes = await sql`SELECT * FROM products WHERE id = ${input.id} AND company_id = ${cid}`;
      if (existingRes.length === 0) throw new Error("Producto no encontrado");
      const existing = existingRes[0];
      const fieldCheck = validateProductFields(input, existing);
      if (!fieldCheck.valid) throw new Error(fieldCheck.error);

      const publication_status = input.publication_status ?? existing.publication_status ?? "published";
      const sales_policy = input.sales_policy ?? existing.sales_policy ?? "own_stock";
      const supplier_source_status = input.supplier_source_status ?? existing.supplier_source_status ?? (sales_policy === "dropship" ? "negotiating" : "not_applicable");
      const supply_status = input.supply_status ?? existing.supply_status ?? "not_applicable";
      const supplier_last_verified_at = input.supplier_last_verified_at !== undefined ? input.supplier_last_verified_at : toIso(existing.supplier_last_verified_at);
      const availability_eta = input.availability_eta !== undefined ? input.availability_eta : toIso(existing.availability_eta);
      const stock = input.stock ?? existing.stock ?? 0;

      const invariantCheck = validateProductPublicationInvariants(
        publication_status,
        sales_policy,
        supplier_source_status,
        supplier_last_verified_at,
        availability_eta,
        stock,
        supply_status,
      );
      if (!invariantCheck.valid) {
        throw new Error(invariantCheck.error);
      }

      const res = await sql`
        UPDATE products
        SET 
          sku = ${input.sku},
          name = ${input.name},
          description = ${input.description ?? ""},
          category = ${input.category ?? ""},
          min_stock = ${input.min_stock ?? 0},
          cost_cents = ${input.cost_cents},
          price_cents = ${input.price_cents},
          vat_rate = ${input.vat_rate},
          supplier_name = ${input.supplier_name ?? ""},
          supplier_contact = ${input.supplier_contact ?? ""},
          supplier_email = ${input.supplier_email ?? ""},
          supplier_phone = ${input.supplier_phone ?? ""},
          fulfillment_mode = ${input.fulfillment_mode ?? "own_stock"},
          stock_location = ${input.stock_location ?? "Almacén principal"},
          condition_code = ${input.condition_code ?? "used"},
          publication_status = ${publication_status},
          sales_policy = ${sales_policy},
          supplier_source_status = ${supplier_source_status},
          supply_status = ${supply_status},
          supplier_last_verified_at = ${supplier_last_verified_at ? new Date(supplier_last_verified_at) : null},
          availability_eta = ${availability_eta ? new Date(availability_eta) : null},
          active = ${input.active ?? true},
          updated_at = ${now}
        WHERE id = ${input.id} AND company_id = ${cid}
        RETURNING *
      `;
      if (res.length === 0) throw new Error("Producto no encontrado");
      const p = res[0];
      const defaultLocation = await sql`SELECT id FROM stock_locations WHERE company_id=${cid} AND is_default=TRUE LIMIT 1`;
      if (defaultLocation[0]) {
        const previousStock = Number(existing.stock ?? 0);
        const stockDelta = Number(p.stock ?? 0) - previousStock;
        await sql`
          INSERT INTO stock_balances (company_id, product_id, location_id, on_hand, reserved, blocked, incoming, available, updated_at)
          VALUES (${cid}, ${p.id}, ${defaultLocation[0].id}, ${previousStock}, 0, 0, 0, ${previousStock}, NOW())
          ON CONFLICT (company_id, product_id, location_id) DO NOTHING
        `;
        if (stockDelta !== 0) await sql`
          UPDATE stock_balances
          SET on_hand=on_hand+${stockDelta}, available=available+${stockDelta}, updated_at=NOW()
          WHERE company_id=${cid} AND product_id=${p.id} AND location_id=${defaultLocation[0].id}
        `;
      }
      return {
        id: p.id,
        company_id: p.company_id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        category: p.category,
        stock: p.stock,
        min_stock: p.min_stock,
        cost_cents: p.cost_cents,
        price_cents: p.price_cents,
        vat_rate: p.vat_rate,
        supplier_name: p.supplier_name || "",
        supplier_contact: p.supplier_contact || "",
        supplier_email: p.supplier_email || "",
        supplier_phone: p.supplier_phone || "",
        fulfillment_mode: p.fulfillment_mode || "own_stock",
        stock_location: p.stock_location || "Almacén principal",
        condition_code: p.condition_code || "used",
        publication_status: p.publication_status,
        sales_policy: p.sales_policy,
        supplier_source_status: p.supplier_source_status,
        supply_status: p.supply_status,
        supplier_last_verified_at: toIso(p.supplier_last_verified_at) || null,
        availability_eta: toIso(p.availability_eta) || null,
        active: !!p.active,
        created_at: toIso(p.created_at),
        updated_at: toIso(p.updated_at),
      };
    } else {
      // Create
      const fieldCheck = validateProductFields(input);
      if (!fieldCheck.valid) throw new Error(fieldCheck.error);
      const defaults = resolveDefaultsForNewProduct(input);
      const publication_status = defaults.publication_status;
      const sales_policy = defaults.sales_policy;
      const supplier_source_status = defaults.supplier_source_status;
      const supply_status = defaults.supply_status;
      const supplier_last_verified_at = defaults.supplier_last_verified_at;
      const availability_eta = defaults.availability_eta;
      const stock = input.stock ?? 0;

      const invariantCheck = validateProductPublicationInvariants(
        publication_status,
        sales_policy,
        supplier_source_status,
        supplier_last_verified_at,
        availability_eta,
        stock,
        supply_status,
      );
      if (!invariantCheck.valid) {
        throw new Error(invariantCheck.error);
      }

      const res = await sql`
        INSERT INTO products (company_id, sku, name, description, category, stock, min_stock, cost_cents, price_cents, vat_rate, supplier_name, supplier_contact, supplier_email, supplier_phone, fulfillment_mode, stock_location, condition_code, active, publication_status, sales_policy, supplier_source_status, supply_status, supplier_last_verified_at, availability_eta)
        VALUES (
          ${cid},
          ${input.sku},
          ${input.name},
          ${input.description ?? ""},
          ${input.category ?? ""},
          ${stock},
          ${input.min_stock ?? 0},
          ${input.cost_cents},
          ${input.price_cents},
          ${input.vat_rate},
          ${input.supplier_name ?? ""},
          ${input.supplier_contact ?? ""},
          ${input.supplier_email ?? ""},
          ${input.supplier_phone ?? ""},
          ${input.fulfillment_mode ?? "own_stock"},
          ${input.stock_location ?? "Almacén principal"},
          ${input.condition_code ?? "used"},
          ${input.active ?? true},
          ${publication_status},
          ${sales_policy},
          ${supplier_source_status},
          ${supply_status},
          ${supplier_last_verified_at ? new Date(supplier_last_verified_at) : null},
          ${availability_eta ? new Date(availability_eta) : null}
        )
        RETURNING *
      `;
      const p = res[0];

      // Registrar movimiento de stock inicial si es mayor que 0
      if (p.stock > 0) {
        await sql`
          INSERT INTO stock_movements (product_id, company_id, delta, reason)
          VALUES (${p.id}, ${cid}, ${p.stock}, 'Stock inicial')
        `;
        const defaultLocation = await sql`SELECT id FROM stock_locations WHERE company_id=${cid} AND is_default=TRUE LIMIT 1`;
        if (defaultLocation[0]) await sql`
          INSERT INTO stock_balances (company_id, product_id, location_id, on_hand, reserved, blocked, incoming, available, updated_at)
          VALUES (${cid}, ${p.id}, ${defaultLocation[0].id}, ${p.stock}, 0, 0, 0, ${p.stock}, NOW())
          ON CONFLICT (company_id, product_id, location_id) DO UPDATE SET on_hand=${p.stock}, available=${p.stock}, updated_at=NOW()
        `;
      }

      return {
        id: p.id,
        company_id: p.company_id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        category: p.category,
        stock: p.stock,
        min_stock: p.min_stock,
        cost_cents: p.cost_cents,
        price_cents: p.price_cents,
        vat_rate: p.vat_rate,
        supplier_name: p.supplier_name || "",
        supplier_contact: p.supplier_contact || "",
        supplier_email: p.supplier_email || "",
        supplier_phone: p.supplier_phone || "",
        fulfillment_mode: p.fulfillment_mode || "own_stock",
        stock_location: p.stock_location || "Almacén principal",
        condition_code: p.condition_code || "used",
        publication_status: p.publication_status,
        sales_policy: p.sales_policy,
        supplier_source_status: p.supplier_source_status,
        supply_status: p.supply_status,
        supplier_last_verified_at: toIso(p.supplier_last_verified_at) || null,
        availability_eta: toIso(p.availability_eta) || null,
        active: !!p.active,
        created_at: toIso(p.created_at),
        updated_at: toIso(p.updated_at),
      };
    }
  },

  async list_suppliers(token: string | null) {
    const user = await requireSession(token); if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);
    const rows = await sql`SELECT * FROM suppliers WHERE company_id = ${cid} ORDER BY name ASC`;
    return rows.map((s) => ({ id: s.id, company_id: s.company_id, name: s.name, contact: s.contact, email: s.email, phone: s.phone, ordering_method: s.ordering_method, notes: s.notes, active: !!s.active, created_at: toIso(s.created_at), updated_at: toIso(s.updated_at) }));
  },

  async upsert_supplier(input: { id?: number | null; name: string; contact?: string; email?: string; phone?: string; ordering_method?: string; notes?: string; active?: boolean }, token: string | null) {
    const user = await requireSession(token); if (!token) throw new Error("Sesión no iniciada"); const cid = await resolveActiveCompanyId(token, user.id); const now = new Date();
    const row = input.id
      ? (await sql`UPDATE suppliers SET name=${input.name}, contact=${input.contact ?? ""}, email=${input.email ?? ""}, phone=${input.phone ?? ""}, ordering_method=${input.ordering_method ?? "email"}, notes=${input.notes ?? ""}, active=${input.active ?? true}, updated_at=${now} WHERE id=${input.id} AND company_id=${cid} RETURNING *`)[0]
      : (await sql`INSERT INTO suppliers (company_id,name,contact,email,phone,ordering_method,notes,active) VALUES (${cid},${input.name},${input.contact ?? ""},${input.email ?? ""},${input.phone ?? ""},${input.ordering_method ?? "email"},${input.notes ?? ""},${input.active ?? true}) RETURNING *`)[0];
    if (!row) throw new Error("Proveedor no encontrado");
    return { id: row.id, company_id: row.company_id, name: row.name, contact: row.contact, email: row.email, phone: row.phone, ordering_method: row.ordering_method, notes: row.notes, active: !!row.active, created_at: toIso(row.created_at), updated_at: toIso(row.updated_at) };
  },

  async adjust_stock(product_id: number, delta: number, reason: string, token: string | null): Promise<Product> {
    const user = await requireSession(token); if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);
    if (!Number.isInteger(delta) || !Number.isFinite(delta) || delta === 0) throw new Error("El ajuste debe ser un entero distinto de cero");
    const now = new Date();

    const updated = await sql.begin(async (tx) => {
      // Leer actual
      const prodRes = await tx`SELECT stock FROM products WHERE id = ${product_id} AND company_id = ${cid}`;
      if (prodRes.length === 0) throw new Error("Producto no encontrado");
      const currentStock = prodRes[0].stock;
      const newStock = currentStock + delta;
      if (newStock < 0) throw new Error("El stock resultante no puede ser negativo");

      // Actualizar
      const res = await tx`
        UPDATE products
        SET stock = ${newStock}, updated_at = ${now}
        WHERE id = ${product_id} AND company_id = ${cid}
        RETURNING *
      `;

      // Registrar movimiento
      await tx`
        INSERT INTO stock_movements (product_id, company_id, delta, reason)
        VALUES (${product_id}, ${cid}, ${delta}, ${reason})
      `;

      const defaultLocation = await tx`SELECT id FROM stock_locations WHERE company_id=${cid} AND is_default=TRUE LIMIT 1`;
      if (defaultLocation[0]) {
        await tx`
          INSERT INTO stock_balances (company_id, product_id, location_id, on_hand, reserved, blocked, incoming, available, updated_at)
          VALUES (${cid}, ${product_id}, ${defaultLocation[0].id}, ${currentStock}, 0, 0, 0, ${currentStock}, NOW())
          ON CONFLICT (company_id, product_id, location_id) DO NOTHING
        `;
        await tx`
          UPDATE stock_balances
          SET on_hand=on_hand+${delta}, available=available+${delta}, updated_at=NOW()
          WHERE company_id=${cid} AND product_id=${product_id} AND location_id=${defaultLocation[0].id}
        `;
      }

      return res[0];
    });

    return {
      id: updated.id,
      company_id: updated.company_id,
      sku: updated.sku,
      name: updated.name,
      description: updated.description,
      category: updated.category,
      stock: updated.stock,
      min_stock: updated.min_stock,
      cost_cents: updated.cost_cents,
      price_cents: updated.price_cents,
      vat_rate: updated.vat_rate,
      active: !!updated.active,
      created_at: toIso(updated.created_at),
      updated_at: toIso(updated.updated_at),
    };
  },

  async list_customers(token: string | null, companyId?: number | null): Promise<Customer[]> {
    const user = await requireSession(token);
    const requestedCompanyId = companyId == null
      ? await resolveActiveCompanyId(token, user.id)
      : Number(companyId);
    const members = await loadMembers();
    if (!canAccessCompany(user.id, requestedCompanyId, members as { company_id: number; user_id: number; role: "admin" | "cajero" }[], !!user.is_master)) {
      throw new Error("No tienes acceso a esa empresa");
    }
    const customers = await sql`
      SELECT * FROM customers
      WHERE company_id = ${requestedCompanyId}
      ORDER BY name ASC
    `;
    return customers.map((c) => ({
      id: c.id,
      company_id: c.company_id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      nif: c.nif,
      notes: c.notes,
      created_at: toIso(c.created_at),
    }));
  },

  async upsert_customer(input: CustomerInput, token: string | null): Promise<Customer> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    if (input.id) {
      const res = await sql`
        UPDATE customers
        SET 
          name = ${input.name},
          email = ${input.email ?? ""},
          phone = ${input.phone ?? ""},
          nif = ${input.nif ?? ""},
          notes = ${input.notes ?? ""}
        WHERE id = ${input.id} AND company_id = ${companyId}
        RETURNING *
      `;
      if (res.length === 0) throw new Error("Cliente no encontrado");
      const c = res[0];
      return {
        id: c.id,
        company_id: c.company_id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        nif: c.nif,
        notes: c.notes,
        created_at: toIso(c.created_at),
      };
    } else {
      const res = await sql`
        INSERT INTO customers (company_id, name, email, phone, nif, notes)
        VALUES (${companyId}, ${input.name}, ${input.email ?? ""}, ${input.phone ?? ""}, ${input.nif ?? ""}, ${input.notes ?? ""})
        RETURNING *
      `;
      const c = res[0];
      return {
        id: c.id,
        company_id: c.company_id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        nif: c.nif,
        notes: c.notes,
        created_at: toIso(c.created_at),
      };
    }
  },

  async create_sale(lines: SaleLineInput[], customer_id: number | null | undefined, notes: string | undefined, token: string | null): Promise<Sale> {
    const user = await requireSession(token);
    if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);
    if (lines.length === 0) throw new Error("La venta debe contener al menos una línea");

    const sale = await sql.begin(async (tx) => {
      const customerId = customer_id == null ? null : Number(customer_id);
      if (customerId != null) {
        const customerRows = await tx`
          SELECT id FROM customers WHERE id = ${customerId} AND company_id = ${cid}
        `;
        if (customerRows.length === 0) throw new Error("El cliente no pertenece a la empresa activa");
      }
      // 1. Calcular totales
      let subtotal = 0;
      let totalVat = 0;
      let total = 0;

      // Obtener todos los productos implicados para verificar stock e IVA
      const productIds = lines.map((l) => l.product_id);
      const prods = await tx`SELECT id, name, price_cents, vat_rate, stock, company_id, publication_status, sales_policy, supply_status FROM products WHERE id IN ${tx(productIds)} AND company_id = ${cid}`;
      const prodMap = new Map(prods.map((p) => [p.id, p]));

      const calculatedLines = [];

      for (const line of lines) {
        const prod = prodMap.get(line.product_id);
        if (!prod) throw new Error(`Producto ${line.product_id} no encontrado`);
        if (!Number.isInteger(line.qty) || line.qty <= 0) throw new Error(`Cantidad inválida para ${prod.name}`);

        const pubStatus = prod.publication_status || "published";
        const salesPolicy = prod.sales_policy || "own_stock";
        const supplyStatus = prod.supply_status || "not_applicable";

        if (["ordered", "in_transit", "negotiating", "quality_hold"].includes(supplyStatus)) {
          throw new Error(`El producto '${prod.name}' está en estado de abastecimiento '${supplyStatus}' y no admite venta`);
        }

        if (pubStatus !== "published" || salesPolicy === "not_sellable") {
          throw new Error(`El producto '${prod.name}' no está publicado o no es vendible`);
        }
        if (salesPolicy === "dropship" || salesPolicy === "preorder" || salesPolicy === "make_to_order") {
          throw new Error(`La modalidad '${salesPolicy}' para '${prod.name}' no admite cobro directo en TPV local en esta versión`);
        }

        if (prod.stock < line.qty) {
          throw new Error(`Stock insuficiente para ${prod.name}. Disponible: ${prod.stock}, Solicitado: ${line.qty}`);
        }

        // Unit price: optional override; discount_cents is tax-inclusive (same as TPV / browser-store).
        const unit = line.unit_price_cents ?? prod.price_cents;
        if (!Number.isInteger(unit) || unit < 0) throw new Error(`Importe inválido para ${prod.name}`);
        if (line.discount_cents !== undefined && (!Number.isInteger(line.discount_cents) || line.discount_cents < 0)) {
          throw new Error(`Descuento inválido para ${prod.name}`);
        }
        const maxDisc = unit * line.qty;
        const discount = Math.min(Math.max(0, line.discount_cents ?? 0), maxDisc);
        const rate: VatRate = isVatRate(Number(prod.vat_rate))
          ? (Number(prod.vat_rate) as VatRate)
          : 21;
        const br = lineBreakdown({
          qty: line.qty,
          unitPriceCents: unit,
          vatRate: rate,
          discountCents: discount,
        });

        subtotal += br.lineBaseCents;
        totalVat += br.lineVatCents;
        total += br.lineTotalCents;

        calculatedLines.push({
          product_id: line.product_id,
          qty: line.qty,
          unit_price_cents: unit,
          vat_rate: rate,
          line_base_cents: br.lineBaseCents,
          line_vat_cents: br.lineVatCents,
          line_total_cents: br.lineTotalCents,
        });
      }

      // 2. Generar número correlativo
      const now = new Date();
      const year = now.getFullYear();
      const countRes = await tx`SELECT COUNT(*)::int as count FROM sales WHERE company_id=${cid} AND sold_at >= ${new Date(year, 0, 1)}`;
      const corr = String(countRes[0].count + 1).padStart(5, "0");
      const saleNumber = `V${year}-${corr}`;

      // 3. Crear venta
      const saleRes = await tx`
        INSERT INTO sales (customer_id, number, subtotal_cents, vat_cents, total_cents, notes, status, company_id)
        VALUES (${customerId}, ${saleNumber}, ${subtotal}, ${totalVat}, ${total}, ${notes ?? ""}, 'completed', ${cid})
        RETURNING *
      `;
      const createdSale = saleRes[0];

      // 4. Crear líneas de venta y ajustar stock
      for (const cl of calculatedLines) {
        await tx`
          INSERT INTO sale_lines (sale_id, product_id, qty, unit_price_cents, vat_rate, line_base_cents, line_vat_cents, line_total_cents)
          VALUES (${createdSale.id}, ${cl.product_id}, ${cl.qty}, ${cl.unit_price_cents}, ${cl.vat_rate}, ${cl.line_base_cents}, ${cl.line_vat_cents}, ${cl.line_total_cents})
        `;

        await tx`
          UPDATE products
          SET stock = stock - ${cl.qty}, updated_at = ${now}
          WHERE id = ${cl.product_id}
        `;

        await tx`
          INSERT INTO stock_movements (product_id, company_id, delta, reason, ref_type, ref_id)
          VALUES (${cl.product_id}, ${cid}, ${-cl.qty}, 'Venta', 'sale', ${createdSale.id})
        `;

        // The legacy TPV updates products.stock and stock_movements. Bridge it
        // to the location-aware inventory ledger so both screens agree.
        const defaultLocation = await tx`SELECT id FROM stock_locations WHERE company_id=${cid} AND is_default=TRUE LIMIT 1`;
        if (defaultLocation[0]) {
          const productStock = prodMap.get(cl.product_id)?.stock ?? 0;
          await tx`
            INSERT INTO stock_balances (company_id, product_id, location_id, on_hand, reserved, blocked, incoming, available, updated_at)
            VALUES (${cid}, ${cl.product_id}, ${defaultLocation[0].id}, ${productStock}, 0, 0, 0, ${productStock}, NOW())
            ON CONFLICT (company_id, product_id, location_id) DO NOTHING
          `;
          await tx`
            UPDATE stock_balances
            SET on_hand=on_hand-${cl.qty}, available=available-${cl.qty}, updated_at=NOW()
            WHERE company_id=${cid} AND product_id=${cl.product_id} AND location_id=${defaultLocation[0].id}
          `;
        }
      }

      // 5. Registrar movimiento de caja
      await tx`
        INSERT INTO cash_movements (company_id, kind, amount_cents, category, description, sale_id)
        VALUES (${cid}, 'income', ${total}, 'ventas', ${`Venta ${saleNumber}`}, ${createdSale.id})
      `;

      return createdSale;
    });

    return this.get_sale(sale.id, token);
  },

  async list_sales(token: string | null): Promise<Sale[]> {
    const user = await requireSession(token);
    if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);
    const sales = await sql`
      SELECT s.*, c.name as customer_name
      FROM sales s
      LEFT JOIN customers c ON s.customer_id = c.id AND c.company_id = s.company_id
      WHERE s.company_id = ${cid}
      ORDER BY s.sold_at DESC
    `;
    return sales.map((s) => ({
      id: s.id,
      company_id: s.company_id,
      customer_id: s.customer_id,
      customer_name: s.customer_name || undefined,
      number: s.number,
      sold_at: toIso(s.sold_at),
      subtotal_cents: s.subtotal_cents,
      vat_cents: s.vat_cents,
      total_cents: s.total_cents,
      refunded_cents: s.refunded_cents ?? 0,
      notes: s.notes,
      status: s.status,
    }));
  },

  async get_sale(id: number, token: string | null): Promise<Sale> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const saleRes = await sql`
      SELECT s.*, c.name as customer_name
      FROM sales s
      LEFT JOIN customers c ON s.customer_id = c.id AND c.company_id = s.company_id
      WHERE s.id = ${id} AND s.company_id = ${companyId}
    `;
    if (saleRes.length === 0) throw new Error("Venta no encontrada");
    const s = saleRes[0];

    const lines = await sql`
      SELECT sl.*, p.name as product_name
      FROM sale_lines sl
      JOIN products p ON sl.product_id = p.id AND p.company_id = ${companyId}
      WHERE sl.sale_id = ${id}
    `;

    return {
      id: s.id,
      company_id: s.company_id,
      customer_id: s.customer_id,
      customer_name: s.customer_name || undefined,
      number: s.number,
      sold_at: toIso(s.sold_at),
      subtotal_cents: s.subtotal_cents,
      vat_cents: s.vat_cents,
      total_cents: s.total_cents,
      refunded_cents: s.refunded_cents ?? 0,
      notes: s.notes,
      status: s.status,
      lines: lines.map((l) => ({
        id: l.id,
        sale_id: l.sale_id,
        product_id: l.product_id,
        product_name: l.product_name,
        qty: l.qty,
        returned_qty: l.returned_qty ?? 0,
        unit_price_cents: l.unit_price_cents,
        vat_rate: l.vat_rate,
        line_base_cents: l.line_base_cents,
        line_vat_cents: l.line_vat_cents,
        line_total_cents: l.line_total_cents,
      })),
    };
  },

  async return_sale_lines(
    id: number,
    requests: ReturnLineInput[],
    token: string | null,
  ): Promise<Sale> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const now = new Date();

    await sql.begin(async (tx) => {
      const saleRes = await tx`SELECT * FROM sales WHERE id = ${id} AND company_id = ${companyId}`;
      if (saleRes.length === 0) throw new Error("Venta no encontrada");
      const s = saleRes[0];
      const lines = await tx`SELECT * FROM sale_lines WHERE sale_id = ${id}`;
      const plan = planPartialReturn(
        {
          id: s.id,
          number: s.number,
          status: s.status,
          total_cents: s.total_cents,
          refunded_cents: s.refunded_cents ?? 0,
        },
        lines.map((l) => ({
          id: l.id,
          product_id: l.product_id,
          qty: l.qty,
          returned_qty: l.returned_qty ?? 0,
          line_total_cents: l.line_total_cents,
          line_base_cents: l.line_base_cents,
          line_vat_cents: l.line_vat_cents,
        })),
        requests,
      );

      for (const pl of plan.lines) {
        await tx`
          UPDATE sale_lines SET returned_qty = ${pl.new_returned_qty} WHERE id = ${pl.line_id}
        `;
      }
      for (const r of plan.stock_restores) {
        await tx`
          UPDATE products SET stock = stock + ${r.qty}, updated_at = ${now} WHERE id = ${r.product_id}
        `;
        await tx`
          INSERT INTO stock_movements (product_id, company_id, delta, reason, ref_type, ref_id)
          VALUES (${r.product_id}, ${companyId}, ${r.qty}, ${plan.cash_description}, 'sale', ${id})
        `;
        const defaultLocation = await tx`SELECT id FROM stock_locations WHERE company_id=${companyId} AND is_default=TRUE LIMIT 1`;
        if (defaultLocation[0]) {
          const productRows = await tx`SELECT stock FROM products WHERE id=${r.product_id} AND company_id=${companyId}`;
          const productStock = productRows[0]?.stock ?? 0;
          await tx`
            INSERT INTO stock_balances (company_id, product_id, location_id, on_hand, reserved, blocked, incoming, available, updated_at)
            VALUES (${companyId}, ${r.product_id}, ${defaultLocation[0].id}, ${productStock}, 0, 0, 0, ${productStock}, NOW())
            ON CONFLICT (company_id, product_id, location_id) DO NOTHING
          `;
          await tx`
            UPDATE stock_balances
            SET on_hand=on_hand+${r.qty}, available=available+${r.qty}, updated_at=NOW()
            WHERE company_id=${companyId} AND product_id=${r.product_id} AND location_id=${defaultLocation[0].id}
          `;
        }
      }
      await tx`
        UPDATE sales
        SET status = ${plan.new_status}, refunded_cents = ${plan.new_refunded_cents}
        WHERE id = ${id}
      `;
      await tx`
        INSERT INTO cash_movements (company_id, kind, amount_cents, category, description, sale_id)
        VALUES (${companyId}, 'expense', ${plan.cash_expense_cents}, ${plan.cash_category}, ${plan.cash_description}, ${id})
      `;
    });

    return this.get_sale(id, token);
  },

  async cancel_sale(id: number, token: string | null): Promise<Sale> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const saleRes = await sql`SELECT * FROM sales WHERE id = ${id} AND company_id = ${companyId}`;
    if (saleRes.length === 0) throw new Error("Venta no encontrada");
    if (saleRes[0].status === "cancelled") throw new Error("La venta ya está cancelada");
    const lines = await sql`SELECT id, qty, returned_qty FROM sale_lines WHERE sale_id = ${id}`;
    const requests: ReturnLineInput[] = lines
      .map((l) => ({
        line_id: l.id as number,
        qty: Math.max(0, (l.qty as number) - ((l.returned_qty as number) ?? 0)),
      }))
      .filter((r) => r.qty > 0);
    if (!requests.length) throw new Error("La venta ya está anulada");
    return this.return_sale_lines(id, requests, token);
  },

  async list_cash_movements(token: string | null): Promise<CashMovement[]> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const movements = await sql`
      SELECT cm.*, s.number as sale_number
      FROM cash_movements cm
      LEFT JOIN sales s ON cm.sale_id = s.id AND s.company_id = cm.company_id
      WHERE cm.company_id = ${companyId}
      ORDER BY cm.occurred_at DESC
    `;
    return movements.map((m) => ({
      id: m.id,
      company_id: m.company_id,
      project_id: m.project_id ?? null,
      kind: m.kind,
      amount_cents: m.amount_cents,
      category: m.category,
      description: m.description ?? "",
      sale_id: m.sale_id ?? null,
      sale_number: m.sale_number || undefined,
      occurred_at: toIso(m.occurred_at),
    }));
  },

  async listInvoices(token: string | null): Promise<Invoice[]> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const rows = await sql`SELECT * FROM invoices WHERE company_id = ${companyId} ORDER BY issued_at DESC, id DESC`;
    return rows.map(formatInvoice);
  },

  async listBudgets(token: string | null): Promise<Budget[]> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const rows = await sql`SELECT * FROM budgets WHERE company_id=${companyId} ORDER BY operation_date DESC, id DESC`;
    return rows.map(formatBudget);
  },

  async getBudget(id: number, token: string | null): Promise<Budget> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const rows = await sql`SELECT * FROM budgets WHERE id=${Number(id)} AND company_id=${companyId}`;
    if (!rows.length) throw new Error("Presupuesto no encontrado");
    return formatBudget(rows[0]);
  },

  async upsertBudget(input: BudgetInput, token: string | null): Promise<Budget> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const projectExplanation = String(input?.project_explanation ?? "").trim();
    if (!projectExplanation) throw new Error("Explica el proyecto y su alcance antes de guardar el presupuesto");
    const normalizedLines = normalizeBudgetLines(input?.lines ?? []);
    const globalDiscountType = input?.global_discount_type === "amount" ? "amount" : "percent";
    const globalDiscountValue = Math.max(0, Number(input?.global_discount_value ?? 0));
    if (!Number.isFinite(globalDiscountValue)) throw new Error("El descuento general no es válido");
    const afterLineDiscounts = normalizedLines.reduce((sum, line) => sum + line.base_cents, 0);
    const requestedGlobalDiscount = globalDiscountType === "percent" ? Math.round(afterLineDiscounts * Math.min(100, globalDiscountValue) / 100) : Math.round(globalDiscountValue * 100);
    const globalDiscountCents = Math.min(afterLineDiscounts, requestedGlobalDiscount);
    let allocatedGlobalDiscount = 0;
    const lines = normalizedLines.map((line, index) => {
      const share = index === normalizedLines.length - 1 ? globalDiscountCents - allocatedGlobalDiscount : afterLineDiscounts ? Math.round(globalDiscountCents * line.base_cents / afterLineDiscounts) : 0;
      allocatedGlobalDiscount += share;
      const base_cents = Math.max(0, line.base_cents - share);
      const vat_cents = Math.round(base_cents * line.vat_rate / 100);
      return { ...line, global_discount_cents: share, base_cents, vat_cents, total_cents: base_cents + vat_cents };
    });
    const baseCents = lines.reduce((sum, line) => sum + line.base_cents, 0);
    const vatCents = lines.reduce((sum, line) => sum + line.vat_cents, 0);
    const discountCents = lines.reduce((sum, line) => sum + line.discount_cents + line.global_discount_cents, 0);
    const irpfRate = Math.max(0, Math.min(100, Number(input?.irpf_rate ?? 0)));
    if (!Number.isFinite(irpfRate)) throw new Error("La retención no es válida");
    const irpfCents = Math.round(baseCents * irpfRate / 100);
    const status = (input?.status ?? "draft") as BudgetStatus;
    if (status !== "draft" && status !== "sent") throw new Error("Un presupuesto solo se guarda como borrador o enviado");
    const operationDate = String(input?.operation_date ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    const series = String(input?.series ?? "E").trim().toUpperCase() || "E";
    const customerId = input?.customer_id == null ? null : Number(input.customer_id);
    const customerRows = customerId == null ? [] : await sql`SELECT id,name,nif,email FROM customers WHERE id=${customerId} AND company_id=${companyId}`;
    if (customerId != null && !customerRows.length) throw new Error("El cliente seleccionado no pertenece a la empresa activa");
    const customer = customerRows[0];
    const customerName = customer?.name ?? String(input?.customer_name ?? "").trim();
    const customerNif = customer?.nif ?? String(input?.customer_nif ?? "").trim();
    const customerEmail = customer?.email ?? String(input?.customer_email ?? "").trim();
    const tags = Array.isArray(input?.tags) ? input.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 50) : [];
    const common = {
      series, status, operationDate, dueAt: input?.due_at ? String(input.due_at).slice(0, 10) : null, customerId, customerName, customerNif, customerEmail,
      projectExplanation, lines, globalDiscountType, globalDiscountValue, discountCents, baseCents, vatCents, irpfRate, irpfCents, totalCents: baseCents + vatCents - irpfCents,
      paymentMethod: String(input?.payment_method ?? "").trim(), account: String(input?.account ?? "").trim(), tags, notes: String(input?.notes ?? "").trim(),
    };
    if (input?.id != null) {
      const currentRows = await sql`SELECT * FROM budgets WHERE id=${Number(input.id)} AND company_id=${companyId}`;
      if (!currentRows.length) throw new Error("Presupuesto no encontrado");
      const current = formatBudget(currentRows[0]);
      if (!(["draft", "sent"] as string[]).includes(current.status)) throw new Error("Solo se pueden editar presupuestos en borrador o enviados");
      const rows = await sql`UPDATE budgets SET series=${common.series},status=${common.status},operation_date=${common.operationDate},due_at=${common.dueAt},customer_id=${common.customerId},customer_name=${common.customerName},customer_nif=${common.customerNif},customer_email=${common.customerEmail},project_explanation=${common.projectExplanation},lines=${sql.json(common.lines as any)},global_discount_type=${common.globalDiscountType},global_discount_value=${common.globalDiscountValue},discount_cents=${common.discountCents},base_cents=${common.baseCents},vat_cents=${common.vatCents},irpf_rate=${common.irpfRate},irpf_cents=${common.irpfCents},total_cents=${common.totalCents},payment_method=${common.paymentMethod},account=${common.account},tags=${sql.json(common.tags as any)},notes=${common.notes},updated_at=NOW() WHERE id=${current.id} AND company_id=${companyId} RETURNING *`;
      return formatBudget(rows[0]);
    }
    let number = String(input?.number ?? "").trim().toUpperCase();
    if (!number) {
      const year = operationDate.slice(0, 4);
      const countRows = await sql`SELECT COUNT(*)::int AS count FROM budgets WHERE company_id=${companyId} AND series=${series} AND operation_date >= ${`${year}-01-01`} AND operation_date < ${`${Number(year) + 1}-01-01`}`;
      number = `${series}${year.slice(-2)}${String(Number(countRows[0]?.count ?? 0) + 1).padStart(4, "0")}`;
    }
    const rows = await sql`INSERT INTO budgets (company_id,series,number,status,operation_date,due_at,customer_id,customer_name,customer_nif,customer_email,project_explanation,lines,global_discount_type,global_discount_value,discount_cents,base_cents,vat_cents,irpf_rate,irpf_cents,total_cents,payment_method,account,tags,notes,created_by) VALUES (${companyId},${common.series},${number},${common.status},${common.operationDate},${common.dueAt},${common.customerId},${common.customerName},${common.customerNif},${common.customerEmail},${common.projectExplanation},${sql.json(common.lines as any)},${common.globalDiscountType},${common.globalDiscountValue},${common.discountCents},${common.baseCents},${common.vatCents},${common.irpfRate},${common.irpfCents},${common.totalCents},${common.paymentMethod},${common.account},${sql.json(common.tags as any)},${common.notes},${user.id}) RETURNING *`;
    return formatBudget(rows[0]);
  },

  async updateBudgetStatus(id: number, nextStatus: BudgetStatus, token: string | null): Promise<Budget> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const allowed = new Set<BudgetStatus>(["draft", "sent", "accepted", "rejected", "expired", "cancelled"]);
    if (!allowed.has(nextStatus) || nextStatus === "invoiced") throw new Error("Estado de presupuesto no válido");
    const currentRows = await sql`SELECT * FROM budgets WHERE id=${Number(id)} AND company_id=${companyId}`;
    if (!currentRows.length) throw new Error("Presupuesto no encontrado");
    const current = formatBudget(currentRows[0]);
    const transitions: Record<string, string[]> = { draft: ["sent", "accepted", "rejected", "cancelled"], sent: ["accepted", "rejected", "expired", "cancelled"], accepted: [], rejected: [], expired: [], cancelled: [], invoiced: [] };
    if (!transitions[current.status]?.includes(nextStatus)) throw new Error(`No se puede pasar de ${current.status} a ${nextStatus}`);
    const rows = nextStatus === "accepted"
      ? await sql`UPDATE budgets SET status='accepted',accepted_at=NOW(),rejected_at=NULL,updated_at=NOW() WHERE id=${current.id} AND company_id=${companyId} RETURNING *`
      : nextStatus === "rejected"
        ? await sql`UPDATE budgets SET status='rejected',rejected_at=NOW(),updated_at=NOW() WHERE id=${current.id} AND company_id=${companyId} RETURNING *`
        : await sql`UPDATE budgets SET status=${nextStatus},updated_at=NOW() WHERE id=${current.id} AND company_id=${companyId} RETURNING *`;
    return formatBudget(rows[0]);
  },

  async convertBudgetToInvoice(id: number, token: string | null): Promise<{ budget: Budget; invoice: Invoice }> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const result = await sql.begin(async (tx) => {
      const budgetRows = await tx`SELECT * FROM budgets WHERE id=${Number(id)} AND company_id=${companyId} FOR UPDATE`;
      if (!budgetRows.length) throw new Error("Presupuesto no encontrado");
      const budget = formatBudget(budgetRows[0]);
      if (budget.status !== "accepted") throw new Error("Solo se puede convertir un presupuesto aceptado");
      if (budget.invoice_id) throw new Error("Este presupuesto ya tiene una factura");
      const [companyRows, customerRows, profileRows] = await Promise.all([
        tx`SELECT * FROM companies WHERE id=${companyId}`,
        budget.customer_id ? tx`SELECT * FROM customers WHERE id=${budget.customer_id} AND company_id=${companyId}` : Promise.resolve([]),
        tx`SELECT * FROM fiscal_profiles WHERE company_id=${companyId}`,
      ]);
      const company = companyRows[0];
      if (!company) throw new Error("Empresa no encontrada");
      const customer = customerRows[0] ? { id: customerRows[0].id, company_id: companyId, name: customerRows[0].name, email: customerRows[0].email ?? "", phone: customerRows[0].phone ?? "", nif: customerRows[0].nif ?? "", notes: "", created_at: toIso(customerRows[0].created_at) } : null;
      const issuedAt = new Date().toISOString();
      const invoiceSeries = profileRows[0]?.invoice_series ?? "F";
      const countRows = await tx`SELECT COUNT(*)::int AS count FROM invoices WHERE company_id=${companyId} AND series=${invoiceSeries} AND issued_at >= ${new Date(`${issuedAt.slice(0, 4)}-01-01T00:00:00Z`)}`;
      const invoiceNumber = `${issuedAt.slice(0, 4)}-${String(Number(countRows[0]?.count ?? 0) + 1).padStart(5, "0")}`;
      const invoice = buildManualInvoice({ id: 0, company: { id: company.id, code: company.code, legal_name: company.legal_name, trade_name: company.trade_name, nif: company.nif, kind: company.kind, active: company.active, created_at: toIso(company.created_at) }, customer, lines: budget.lines.map((line) => ({ description: line.description, quantity: line.quantity, unit_price_cents: Math.round(line.base_cents / line.quantity), vat_rate: line.vat_rate })), invoice: { status: "issued", series: invoiceSeries, kind: customer?.nif ? "complete" : "simplified", operation_date: budget.operation_date, due_at: budget.due_at, irpf_rate: budget.irpf_rate, notes: budget.notes }, created_by: user.id, number: invoiceNumber, issued_at: issuedAt, profile: profileRows[0] ? formatFiscalProfile(profileRows[0]) : null });
      const invoiceRows = await tx`INSERT INTO invoices (company_id,sale_id,series,number,kind,status,issued_at,operation_date,due_at,seller_legal_name,seller_nif,seller_trade_name,customer_id,customer_name,customer_nif,customer_email,lines,base_cents,vat_cents,irpf_rate,irpf_cents,total_cents,paid_cents,payment_status,notes,created_by) VALUES (${companyId},NULL,${invoice.series},${invoice.number},${invoice.kind},${invoice.status},${invoice.issued_at},${invoice.operation_date},${invoice.due_at},${invoice.seller_legal_name},${invoice.seller_nif},${invoice.seller_trade_name},${invoice.customer_id},${invoice.customer_name},${invoice.customer_nif},${invoice.customer_email},${sql.json(invoice.lines as any)},${invoice.base_cents},${invoice.vat_cents},${invoice.irpf_rate},${invoice.irpf_cents},${invoice.total_cents},0,'pending',${invoice.notes},${user.id}) RETURNING *`;
      const budgetUpdate = await tx`UPDATE budgets SET status='invoiced',invoice_id=${invoiceRows[0].id},converted_at=NOW(),updated_at=NOW() WHERE id=${budget.id} AND company_id=${companyId} RETURNING *`;
      return { budget: formatBudget(budgetUpdate[0]), invoice: formatInvoice(invoiceRows[0]), profile: profileRows[0] ? formatFiscalProfile(profileRows[0]) : null };
    });
    await this.appendVerifactuRecord(result.invoice, result.profile, "alta");
    return { budget: result.budget, invoice: result.invoice };
  },

  async deleteBudget(id: number, token: string | null): Promise<void> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const rows = await sql`SELECT status FROM budgets WHERE id=${Number(id)} AND company_id=${companyId}`;
    if (!rows.length) throw new Error("Presupuesto no encontrado");
    if (rows[0].status !== "draft") throw new Error("Solo se pueden eliminar presupuestos en borrador");
    await sql`DELETE FROM budgets WHERE id=${Number(id)} AND company_id=${companyId}`;
  },

  async appendVerifactuRecord(invoice: Invoice, profile: FiscalProfile | null, recordType: "alta" | "anulacion"): Promise<void> {
    if (!profile || (profile.verifactu_mode ?? "disabled") === "disabled") return;
    const previousRows = await sql`SELECT hash FROM verifactu_records WHERE company_id=${invoice.company_id} ORDER BY id DESC LIMIT 1`;
    const draft = createVerifactuRecord({ invoice, profile, recordType, previousHash: previousRows[0]?.hash ?? "" });
    if (!draft) return;
    await sql`INSERT INTO verifactu_records (company_id,invoice_id,record_type,issuer_nif,issuer_name,invoice_series,invoice_number,invoice_date,invoice_type,vat_cents,total_cents,previous_hash,hash,generated_at,mode,status,qr_url,payload_json,error) VALUES (${draft.company_id},${draft.invoice_id},${draft.record_type},${draft.issuer_nif},${draft.issuer_name},${draft.invoice_series},${draft.invoice_number},${draft.invoice_date.slice(0, 10)},${draft.invoice_type},${draft.vat_cents},${draft.total_cents},${draft.previous_hash},${draft.hash},${draft.generated_at},${draft.mode},${draft.status},${draft.qr_url},${sql.json(JSON.parse(draft.payload_json))},${draft.error})`;
  },

  async issueInvoice(input: InvoiceInput, token: string | null): Promise<Invoice> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const projectId = input.project_id == null ? null : Number(input.project_id);
    if (projectId != null) {
      const projects = await sql`SELECT id FROM work_projects WHERE id=${projectId} AND company_id=${companyId} AND project_type='client'`;
      if (!projects.length) throw new Error("El proyecto de la factura no es válido.");
    }
    if (input.draft_id) {
      const draftRows = await sql`SELECT * FROM invoices WHERE id=${input.draft_id} AND company_id=${companyId}`;
      if (!draftRows.length) throw new Error("Borrador no encontrado");
      const draft = formatInvoice(draftRows[0]);
      if (draft.status !== "draft") throw new Error("Solo se pueden modificar facturas en borrador");
      if (!input.lines?.length) throw new Error("La factura debe tener al menos una línea");
      const [companyRows, customerRows, profileRows] = await Promise.all([
        sql`SELECT * FROM companies WHERE id=${companyId}`,
        input.customer_id ? sql`SELECT * FROM customers WHERE id=${input.customer_id} AND company_id=${companyId}` : Promise.resolve([]),
        sql`SELECT * FROM fiscal_profiles WHERE company_id=${companyId}`,
      ]);
      const company = companyRows[0];
      if (!company) throw new Error("Empresa no encontrada");
      const customer = customerRows[0] ? { id: customerRows[0].id, company_id: companyId, name: customerRows[0].name, email: customerRows[0].email ?? "", phone: customerRows[0].phone ?? "", nif: customerRows[0].nif ?? "", notes: customerRows[0].notes ?? "", created_at: toIso(customerRows[0].created_at) } : (input.customer_name || input.customer_nif || input.customer_email ? { id: 0, company_id: companyId, name: input.customer_name?.trim() || "Cliente contado", email: input.customer_email?.trim() || "", phone: "", nif: input.customer_nif?.trim() || "", notes: "", created_at: new Date().toISOString() } : null);
      const invoice = buildManualInvoice({ id: draft.id, company: { id: company.id, code: company.code, legal_name: company.legal_name, trade_name: company.trade_name, nif: company.nif, kind: company.kind, active: company.active, created_at: toIso(company.created_at) }, customer, lines: input.lines, invoice: { ...input, status: input.status ?? "issued" }, created_by: draft.created_by, number: draft.number, issued_at: (input.status ?? "issued") === "issued" ? new Date().toISOString() : draft.issued_at, profile: profileRows[0] ? formatFiscalProfile(profileRows[0]) : null });
      const rows = await sql`UPDATE invoices SET project_id=${projectId},kind=${invoice.kind},status=${invoice.status},issued_at=${invoice.issued_at},operation_date=${invoice.operation_date},due_at=${invoice.due_at},customer_id=${invoice.customer_id},customer_name=${invoice.customer_name},customer_nif=${invoice.customer_nif},customer_email=${invoice.customer_email},lines=${sql.json(invoice.lines as any)},base_cents=${invoice.base_cents},vat_cents=${invoice.vat_cents},irpf_rate=${invoice.irpf_rate},irpf_cents=${invoice.irpf_cents},total_cents=${invoice.total_cents},notes=${invoice.notes},updated_at=NOW() WHERE id=${draft.id} AND company_id=${companyId} RETURNING *`;
      const saved = formatInvoice(rows[0]);
      if (saved.status === "issued") await this.appendVerifactuRecord(saved, profileRows[0] ? formatFiscalProfile(profileRows[0]) : null, "alta");
      return saved;
    }
    if (input.rectifies_invoice_id) {
      const baseRows = await sql`SELECT * FROM invoices WHERE id=${input.rectifies_invoice_id} AND company_id=${companyId}`;
      if (!baseRows.length) throw new Error("Factura original no encontrada");
      const base = formatInvoice(baseRows[0]);
      if (base.status !== "issued") throw new Error("Solo se pueden rectificar facturas emitidas");
      const issuedAt = new Date().toISOString();
      const series = (input.series ?? base.series).trim().toUpperCase() || base.series;
      const countRows = await sql`SELECT COUNT(*)::int AS count FROM invoices WHERE company_id=${companyId} AND series=${series} AND issued_at >= ${new Date(`${issuedAt.slice(0, 4)}-01-01T00:00:00Z`)}`;
      const number = `${issuedAt.slice(0, 4)}-${String(Number(countRows[0]?.count ?? 0) + 1).padStart(5, "0")}`;
      const invoice = buildRectifyingInvoice({ id: 0, base, number, created_by: user.id, issued_at: issuedAt, notes: input.notes });
      invoice.series = series;
      invoice.operation_date = input.operation_date || base.operation_date;
      const rows = await sql`INSERT INTO invoices (company_id,sale_id,series,number,kind,status,issued_at,operation_date,due_at,seller_legal_name,seller_nif,seller_trade_name,customer_id,customer_name,customer_nif,customer_email,lines,base_cents,vat_cents,irpf_rate,irpf_cents,total_cents,paid_cents,payment_status,notes,created_by) VALUES (${companyId},${invoice.sale_id},${invoice.series},${invoice.number},${invoice.kind},${invoice.status},${invoice.issued_at},${invoice.operation_date},${invoice.due_at},${invoice.seller_legal_name},${invoice.seller_nif},${invoice.seller_trade_name},${invoice.customer_id},${invoice.customer_name},${invoice.customer_nif},${invoice.customer_email},${sql.json(invoice.lines as any)},${invoice.base_cents},${invoice.vat_cents},${invoice.irpf_rate},${invoice.irpf_cents},${invoice.total_cents},0,'pending',${invoice.notes},${user.id}) RETURNING *`;
      const saved = formatInvoice(rows[0]);
      const profileRows = await sql`SELECT * FROM fiscal_profiles WHERE company_id=${companyId}`;
      if (saved.status === "issued") await this.appendVerifactuRecord(saved, profileRows[0] ? formatFiscalProfile(profileRows[0]) : null, "alta");
      return saved;
    }
    if (!input.sale_id && input.lines?.length) {
      const [companyRows, customerRows, profileRows] = await Promise.all([
        sql`SELECT * FROM companies WHERE id = ${companyId}`,
        input.customer_id ? sql`SELECT * FROM customers WHERE id = ${input.customer_id} AND company_id = ${companyId}` : Promise.resolve([]),
        sql`SELECT * FROM fiscal_profiles WHERE company_id = ${companyId}`,
      ]);
      const company = companyRows[0];
      if (!company) throw new Error("Empresa no encontrada");
      const customer = customerRows[0] ? { id: customerRows[0].id, company_id: companyId, name: customerRows[0].name, email: customerRows[0].email ?? "", phone: customerRows[0].phone ?? "", nif: customerRows[0].nif ?? "", notes: customerRows[0].notes ?? "", created_at: toIso(customerRows[0].created_at) } : (input.customer_name || input.customer_nif || input.customer_email ? { id: 0, company_id: companyId, name: input.customer_name?.trim() || "Cliente contado", email: input.customer_email?.trim() || "", phone: "", nif: input.customer_nif?.trim() || "", notes: "", created_at: new Date().toISOString() } : null);
      const issuedAt = new Date().toISOString();
      const series = (input.series ?? profileRows[0]?.invoice_series ?? "F").trim().toUpperCase() || "F";
      const year = issuedAt.slice(0, 4);
      const countRows = await sql`SELECT COUNT(*)::int AS count FROM invoices WHERE company_id = ${companyId} AND series = ${series} AND issued_at >= ${new Date(`${year}-01-01T00:00:00Z`)}`;
      const number = `${year}-${String(Number(countRows[0]?.count ?? 0) + 1).padStart(5, "0")}`;
      const invoice = buildManualInvoice({ id: 0, company: { id: company.id, code: company.code, legal_name: company.legal_name, trade_name: company.trade_name, nif: company.nif, kind: company.kind, active: company.active, created_at: toIso(company.created_at) }, customer, lines: input.lines, invoice: input, created_by: user.id, number, issued_at: issuedAt, profile: profileRows[0] ? formatFiscalProfile(profileRows[0]) : null });
      const rows = await sql`INSERT INTO invoices (company_id,project_id,sale_id,series,number,kind,status,issued_at,operation_date,due_at,seller_legal_name,seller_nif,seller_trade_name,customer_id,customer_name,customer_nif,customer_email,lines,base_cents,vat_cents,irpf_rate,irpf_cents,total_cents,paid_cents,payment_status,notes,created_by) VALUES (${companyId},${projectId},NULL,${invoice.series},${invoice.number},${invoice.kind},${invoice.status},${invoice.issued_at},${invoice.operation_date},${invoice.due_at},${invoice.seller_legal_name},${invoice.seller_nif},${invoice.seller_trade_name},${invoice.customer_id},${invoice.customer_name},${invoice.customer_nif},${invoice.customer_email},${sql.json(invoice.lines as any)},${invoice.base_cents},${invoice.vat_cents},${invoice.irpf_rate},${invoice.irpf_cents},${invoice.total_cents},0,'pending',${invoice.notes},${user.id}) RETURNING *`;
      const saved = formatInvoice(rows[0]);
      if (saved.status === "issued") await this.appendVerifactuRecord(saved, profileRows[0] ? formatFiscalProfile(profileRows[0]) : null, "alta");
      return saved;
    }
    if (!input.sale_id) throw new Error("La venta o las líneas de la factura son obligatorias");
    const saleRows = await sql`SELECT * FROM sales WHERE id = ${input.sale_id} AND company_id = ${companyId}`;
    if (!saleRows.length) throw new Error("Venta no encontrada");
    const existingRows = await sql`SELECT * FROM invoices WHERE sale_id = ${input.sale_id} AND company_id = ${companyId} AND status <> 'cancelled' LIMIT 1`;
    if (existingRows.length) return formatInvoice(existingRows[0]);
    const [companyRows, customerRows, linesRows, profileRows] = await Promise.all([
      sql`SELECT * FROM companies WHERE id = ${companyId}`,
      saleRows[0].customer_id ? sql`SELECT * FROM customers WHERE id = ${saleRows[0].customer_id} AND company_id = ${companyId}` : Promise.resolve([]),
      sql`SELECT sl.*, p.name AS product_name FROM sale_lines sl JOIN products p ON p.id = sl.product_id WHERE sl.sale_id = ${input.sale_id}`,
      sql`SELECT * FROM fiscal_profiles WHERE company_id = ${companyId}`,
    ]);
    const company = companyRows[0];
    const sale = { ...saleRows[0], sold_at: toIso(saleRows[0].sold_at), company_id: companyId };
    const customer = customerRows[0] ? { id: customerRows[0].id, company_id: companyId, name: customerRows[0].name, email: customerRows[0].email ?? "", phone: customerRows[0].phone ?? "", nif: customerRows[0].nif ?? "", notes: customerRows[0].notes ?? "", created_at: toIso(customerRows[0].created_at) } : null;
    const issuedAt = new Date().toISOString();
    const series = (input.series ?? profileRows[0]?.invoice_series ?? "F").trim().toUpperCase() || "F";
    const year = issuedAt.slice(0, 4);
    const countRows = await sql`SELECT COUNT(*)::int AS count FROM invoices WHERE company_id = ${companyId} AND series = ${series} AND issued_at >= ${new Date(`${year}-01-01T00:00:00Z`)}`;
    const number = `${year}-${String(Number(countRows[0]?.count ?? 0) + 1).padStart(5, "0")}`;
    const invoice = buildInvoiceFromSale({
      id: 0, company: { id: company.id, code: company.code, legal_name: company.legal_name, trade_name: company.trade_name, nif: company.nif, kind: company.kind, active: company.active, created_at: toIso(company.created_at) },
      customer, sale: sale as any, lines: linesRows as any, invoice: input, created_by: user.id, number, issued_at: issuedAt, profile: profileRows[0] ? formatFiscalProfile(profileRows[0]) : null,
    });
    const rows = await sql`INSERT INTO invoices (company_id,sale_id,series,number,kind,status,issued_at,operation_date,due_at,seller_legal_name,seller_nif,seller_trade_name,customer_id,customer_name,customer_nif,customer_email,lines,base_cents,vat_cents,irpf_rate,irpf_cents,total_cents,paid_cents,payment_status,notes,created_by) VALUES (${companyId},${invoice.sale_id},${invoice.series},${invoice.number},${invoice.kind},${invoice.status},${invoice.issued_at},${invoice.operation_date},${invoice.due_at},${invoice.seller_legal_name},${invoice.seller_nif},${invoice.seller_trade_name},${invoice.customer_id},${invoice.customer_name},${invoice.customer_nif},${invoice.customer_email},${sql.json(invoice.lines as any)},${invoice.base_cents},${invoice.vat_cents},${invoice.irpf_rate},${invoice.irpf_cents},${invoice.total_cents},0,'pending',${invoice.notes},${user.id}) RETURNING *`;
    const saved = formatInvoice(rows[0]);
    if (saved.status === "issued") await this.appendVerifactuRecord(saved, profileRows[0] ? formatFiscalProfile(profileRows[0]) : null, "alta");
    return saved;
  },

  async cancelInvoice(id: number, token: string | null): Promise<Invoice> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const existing = await sql`SELECT status FROM invoices WHERE id=${id} AND company_id=${companyId}`;
    if (!existing.length) throw new Error("Factura no encontrada");
    const rows = await sql`UPDATE invoices SET status='cancelled', updated_at=NOW() WHERE id=${id} AND company_id=${companyId} RETURNING *`;
    if (!rows.length) throw new Error("Factura no encontrada");
    const profileRows = await sql`SELECT * FROM fiscal_profiles WHERE company_id=${companyId}`;
    if (existing[0].status === "issued") await this.appendVerifactuRecord(formatInvoice(rows[0]), profileRows[0] ? formatFiscalProfile(profileRows[0]) : null, "anulacion");
    void user;
    return formatInvoice(rows[0]);
  },

  async listVerifactuRecords(token: string | null): Promise<VerifactuRecord[]> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const rows = await sql`SELECT * FROM verifactu_records WHERE company_id=${companyId} ORDER BY id DESC`;
    return rows.map((row: any) => ({
      id: Number(row.id), company_id: Number(row.company_id), invoice_id: Number(row.invoice_id), record_type: row.record_type,
      issuer_nif: row.issuer_nif, issuer_name: row.issuer_name ?? "", invoice_series: row.invoice_series, invoice_number: row.invoice_number,
      invoice_date: String(row.invoice_date).slice(0, 10), invoice_type: row.invoice_type, vat_cents: Number(row.vat_cents ?? 0), total_cents: Number(row.total_cents ?? 0),
      previous_hash: row.previous_hash ?? "", hash: row.hash, generated_at: toIso(row.generated_at), mode: row.mode, status: row.status,
      qr_url: row.qr_url ?? "", payload_json: typeof row.payload_json === "string" ? row.payload_json : JSON.stringify(row.payload_json ?? {}), error: row.error ?? null,
    }));
  },

  async verifyVerifactuChain(token: string | null): Promise<{ ok: boolean; error?: string }> {
    return verifyVerifactuChain(await this.listVerifactuRecords(token));
  },

  async listInvoicePayments(invoiceId: number, token: string | null): Promise<InvoicePayment[]> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const rows = await sql`SELECT * FROM invoice_payments WHERE invoice_id=${invoiceId} AND company_id=${companyId} ORDER BY paid_at DESC, id DESC`;
    return rows.map((row: any) => ({ id: Number(row.id), invoice_id: Number(row.invoice_id), company_id: Number(row.company_id), amount_cents: Number(row.amount_cents), paid_at: toIso(row.paid_at), method: row.method, notes: row.notes ?? "", created_by: Number(row.created_by) }));
  },

  async addInvoicePayment(input: InvoicePaymentInput, token: string | null): Promise<InvoicePayment> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const amount = Math.round(Number(input.amount_cents));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("El importe debe ser mayor que cero");
    const paidAt = input.paid_at || new Date().toISOString();
    const row = await sql.begin(async (tx) => {
      const invoiceRows = await tx`SELECT * FROM invoices WHERE id=${input.invoice_id} AND company_id=${companyId} FOR UPDATE`;
      if (!invoiceRows.length) throw new Error("Factura no encontrada");
      const invoice = formatInvoice(invoiceRows[0]);
      if (invoice.status !== "issued") throw new Error("Solo se pueden cobrar facturas emitidas");
      if (amount > invoice.total_cents - invoice.paid_cents) throw new Error("El cobro supera el importe pendiente");
      const rows = await tx`INSERT INTO invoice_payments (invoice_id,company_id,amount_cents,paid_at,method,notes,created_by) VALUES (${invoice.id},${companyId},${amount},${paidAt},${input.method ?? "bank_transfer"},${input.notes ?? ""},${user.id}) RETURNING *`;
      const paidCents = invoice.paid_cents + amount;
      await tx`UPDATE invoices SET paid_cents=${paidCents}, payment_status=${paidCents >= invoice.total_cents ? "paid" : "partial"}, updated_at=NOW() WHERE id=${invoice.id} AND company_id=${companyId}`;
      await tx`INSERT INTO cash_movements (company_id,kind,amount_cents,category,description,sale_id,occurred_at) VALUES (${companyId},'income',${amount},'cobro_factura',${`Cobro ${invoice.series}-${invoice.number}`},${invoice.sale_id},${paidAt})`;
      return rows[0];
    });
    return { id: Number(row.id), invoice_id: Number(row.invoice_id), company_id: Number(row.company_id), amount_cents: Number(row.amount_cents), paid_at: toIso(row.paid_at), method: row.method, notes: row.notes ?? "", created_by: Number(row.created_by) };
  },

  async listExpenseDocuments(token: string | null): Promise<ExpenseDocument[]> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const rows = await sql`SELECT * FROM expense_documents WHERE company_id = ${companyId} ORDER BY created_at DESC, id DESC`;
    return rows.map(formatExpenseDocument);
  },

  async upsertExpenseDocument(input: any, token: string | null): Promise<ExpenseDocument> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    if (!String(input.title ?? "").trim()) throw new Error("El título del gasto es obligatorio.");
    const allowedStatuses = new Set(["draft", "review", "approved", "paid", "rejected"]);
    const allowedKinds = new Set(["ticket", "invoice", "simplified_invoice", "credit_note", "receipt"]);
    let id = input.id ? Number(input.id) : null;
    let existing: any = null;
    if (id) {
      const existingRows = await sql`SELECT * FROM expense_documents WHERE id = ${id} AND company_id = ${companyId}`;
      if (!existingRows.length) throw new Error("Gasto no encontrado.");
      existing = existingRows[0];
    }
    const kind = String(input.kind ?? existing?.kind ?? "invoice");
    if (!allowedKinds.has(kind)) throw new Error("Tipo de documento no válido.");
    const vatRate = Number(input.vat_rate ?? existing?.vat_rate ?? 21);
    if (!isVatRate(vatRate)) throw new Error("El IVA debe ser 0%, 4%, 10% o 21%.");
    if (input.ocr_confidence !== undefined && input.ocr_confidence !== null && (!Number.isFinite(Number(input.ocr_confidence)) || Number(input.ocr_confidence) < 0 || Number(input.ocr_confidence) > 1)) {
      throw new Error("La confianza OCR debe estar entre 0 y 1.");
    }
    for (const [label, value] of [["base", input.base_cents], ["IVA", input.vat_cents], ["retención", input.withholding_cents], ["total", input.total_cents]] as const) {
      if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0)) throw new Error(`El importe de ${label} no puede ser negativo.`);
    }
    const projectId = input.project_id == null ? null : Number(input.project_id);
    if (projectId != null) {
      const projectRows = await sql`
        SELECT id FROM work_projects
        WHERE id=${projectId} AND (company_id=${companyId} OR task_company_id=${companyId})
      `;
      if (!projectRows.length) throw new Error("El proyecto no pertenece a la empresa activa.");
    }
    const status = String(input.status ?? existing?.status ?? "review");
    if (!allowedStatuses.has(status)) throw new Error("Estado de gasto no válido.");
    if (id) {
      await sql`UPDATE expense_documents SET status=${status}, kind=${kind}, title=${String(input.title).trim()}, supplier_name=${input.supplier_name ?? existing.supplier_name ?? ""}, supplier_tax_id=${input.supplier_tax_id ?? existing.supplier_tax_id ?? ""}, invoice_number=${input.invoice_number ?? existing.invoice_number ?? ""}, issued_at=${input.issued_at ?? existing.issued_at ?? null}, accounting_date=${input.accounting_date ?? input.issued_at ?? existing.accounting_date ?? null}, deductible=${input.deductible ?? existing.deductible ?? true}, deduction_period=${input.deduction_period ?? existing.deduction_period ?? null}, due_at=${input.due_at ?? existing.due_at ?? null}, project_id=${projectId}, category=${input.category ?? existing.category ?? "otros"}, base_cents=${input.base_cents ?? existing.base_cents ?? 0}, vat_rate=${vatRate}, vat_cents=${input.vat_cents ?? existing.vat_cents ?? 0}, withholding_cents=${input.withholding_cents ?? existing.withholding_cents ?? 0}, total_cents=${input.total_cents ?? existing.total_cents ?? 0}, currency=${input.currency ?? existing.currency ?? "EUR"}, notes=${input.notes ?? existing.notes ?? ""}, attachments=${sql.json(input.attachments ?? existing.attachments ?? [])}, source=${input.source ?? existing.source ?? "manual"}, source_phone=${input.source_phone ?? existing.source_phone ?? null}, ocr_confidence=${input.ocr_confidence ?? existing.ocr_confidence ?? null}, updated_at=NOW() WHERE id=${id} AND company_id=${companyId}`;
    } else {
      const result = await sql`INSERT INTO expense_documents (company_id,status,kind,title,supplier_name,supplier_tax_id,invoice_number,issued_at,accounting_date,deductible,deduction_period,due_at,project_id,category,base_cents,vat_rate,vat_cents,withholding_cents,total_cents,currency,notes,attachments,source,source_phone,ocr_confidence,created_by) VALUES (${companyId},${status},${kind},${String(input.title).trim()},${input.supplier_name ?? ""},${input.supplier_tax_id ?? ""},${input.invoice_number ?? ""},${input.issued_at || null},${input.accounting_date || input.issued_at || null},${input.deductible !== false},${input.deduction_period ?? null},${input.due_at || null},${projectId},${input.category ?? "otros"},${input.base_cents ?? 0},${vatRate},${input.vat_cents ?? 0},${input.withholding_cents ?? 0},${input.total_cents ?? 0},${input.currency ?? "EUR"},${input.notes ?? ""},${sql.json(input.attachments ?? [])},${input.source ?? "manual"},${input.source_phone ?? null},${input.ocr_confidence ?? null},${user.id}) RETURNING id`;
      id = result[0].id;
    }
    const rows = await sql`SELECT * FROM expense_documents WHERE id=${id} AND company_id=${companyId}`;
    return formatExpenseDocument(rows[0]);
  },

  async approveExpenseDocument(id: number, token: string | null): Promise<ExpenseDocument> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const result = await sql.begin(async (tx) => {
      const current = await tx`SELECT * FROM expense_documents WHERE id=${id} AND company_id=${companyId} FOR UPDATE`;
      if (!current.length) throw new Error("Gasto no encontrado.");
      if (current[0].status === "approved" || current[0].status === "paid") return formatExpenseDocument(current[0]);
      if (current[0].status === "rejected") throw new Error("No se puede aprobar un gasto rechazado.");
      const rows = await tx`UPDATE expense_documents SET status='approved', approved_at=NOW(), updated_at=NOW() WHERE id=${id} AND company_id=${companyId} RETURNING *`;
      const expense = formatExpenseDocument(rows[0]);
      await tx`INSERT INTO cash_movements (company_id,project_id,kind,amount_cents,category,description,occurred_at) VALUES (${companyId},${expense.project_id},'expense',${expense.total_cents},${expense.category},${expense.title},COALESCE(${expense.issued_at}::timestamptz,NOW()))`;
      return expense;
    });
    return result;
  },

  async listExpensePayments(expenseId: number, token: string | null): Promise<ExpensePayment[]> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const rows = await sql`SELECT * FROM expense_payments WHERE expense_id=${expenseId} AND company_id=${companyId} ORDER BY paid_at DESC, id DESC`;
    return rows.map((row: any) => ({ id: Number(row.id), expense_id: Number(row.expense_id), company_id: Number(row.company_id), amount_cents: Number(row.amount_cents), paid_at: toIso(row.paid_at), method: row.method, notes: row.notes ?? "", created_by: Number(row.created_by) }));
  },

  async addExpensePayment(input: ExpensePaymentInput, token: string | null): Promise<ExpensePayment> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const amount = Math.round(Number(input.amount_cents));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("El importe debe ser mayor que cero");
    const paidAt = input.paid_at || new Date().toISOString();
    const row = await sql.begin(async (tx) => {
      const expenseRows = await tx`SELECT * FROM expense_documents WHERE id=${input.expense_id} AND company_id=${companyId} FOR UPDATE`;
      if (!expenseRows.length) throw new Error("Factura recibida no encontrada");
      const expense = formatExpenseDocument(expenseRows[0]);
      if (expense.status === "rejected") throw new Error("No se puede pagar un documento rechazado");
      if (amount > expense.total_cents - (expense.paid_cents ?? 0)) throw new Error("El pago supera el importe pendiente");
      const rows = await tx`INSERT INTO expense_payments (expense_id,company_id,amount_cents,paid_at,method,notes,created_by) VALUES (${expense.id},${companyId},${amount},${paidAt},${input.method ?? "bank_transfer"},${input.notes ?? ""},${user.id}) RETURNING *`;
      const paidCents = (expense.paid_cents ?? 0) + amount;
      await tx`UPDATE expense_documents SET paid_cents=${paidCents}, payment_status=${paidCents >= expense.total_cents ? "paid" : "partial"}, status=${paidCents >= expense.total_cents ? "paid" : expense.status}, updated_at=NOW() WHERE id=${expense.id} AND company_id=${companyId}`;
      await tx`INSERT INTO cash_movements (company_id,project_id,kind,amount_cents,category,description,occurred_at) VALUES (${companyId},${expense.project_id},'expense',${amount},'pago_factura_recibida',${`Pago ${expense.title}`},${paidAt})`;
      return rows[0];
    });
    return { id: Number(row.id), expense_id: Number(row.expense_id), company_id: Number(row.company_id), amount_cents: Number(row.amount_cents), paid_at: toIso(row.paid_at), method: row.method, notes: row.notes ?? "", created_by: Number(row.created_by) };
  },

  async ingestWhatsAppExpense(deviceId: string, payload: any): Promise<ExpenseDocument> {
    const match = /^hexa-(\d+)-(\d+)$/.exec(deviceId);
    if (!match) throw new Error("Dispositivo de WhatsApp no asociado a una empresa.");
    const companyId = Number(match[1]);
    const userId = Number(match[2]);
    const users = await sql`SELECT u.id FROM users u INNER JOIN company_members cm ON cm.user_id = u.id WHERE u.id=${userId} AND cm.company_id=${companyId} LIMIT 1`;
    if (!users.length) throw new Error("Dispositivo de WhatsApp no asociado a un usuario válido.");
    const body = String(payload.body ?? payload.caption ?? "");
    const hints = extractExpenseHints(body);
    const media = payload.image ?? payload.document ?? payload.media;
    const attachment = media ? [{ id: `wa-${Date.now()}`, name: typeof media === "string" ? media.split("/").pop() || "whatsapp-documento" : "whatsapp-documento", mime_type: String(payload.mimetype ?? "application/octet-stream"), size: 0, href: typeof media === "string" ? media : undefined }] : [];
    const result = await sql`INSERT INTO expense_documents (company_id,status,kind,title,notes,attachments,source,source_phone,ocr_confidence,total_cents,issued_at,created_by) VALUES (${companyId},'review','invoice',${hints.title ?? "Factura recibida por WhatsApp"},${hints.notes ?? ""},${sql.json(attachment as any)},'whatsapp',${String(payload.from ?? payload.chat_id ?? "")},${hints.ocr_confidence ?? null},${hints.total_cents ?? 0},${hints.issued_at ?? null},${userId}) RETURNING *`;
    return formatExpenseDocument(result[0]);
  },

  async processWhatsAppExpenseMessage(deviceId: string, payload: any): Promise<{ state: string; expense?: ExpenseDocument }> {
    const match = /^hexa-(\d+)-(\d+)$/.exec(deviceId);
    if (!match) throw new Error("Dispositivo de WhatsApp no asociado a un usuario.");
    const legacyUserId = Number(match[2]);
    const linkRows = await sql`SELECT phone,linked_by FROM company_whatsapp_links WHERE device_id=${deviceId} ORDER BY updated_at DESC LIMIT 1`;
    const userId = linkRows.length ? Number(linkRows[0].linked_by) : legacyUserId;
    // Route by the receiving phone. If several companies share it, defer the
    // choice to WhatsApp. The membership fallback keeps pre-migration devices
    // working until their next status refresh records the explicit link.
    const companyRows = linkRows.length
      ? await sql`SELECT c.id,c.trade_name,c.legal_name FROM companies c INNER JOIN company_whatsapp_links wl ON wl.company_id=c.id WHERE wl.phone=${linkRows[0].phone} AND c.active=TRUE ORDER BY c.trade_name,c.id`
      : await sql`SELECT c.id,c.trade_name,c.legal_name FROM companies c INNER JOIN company_members cm ON cm.company_id=c.id INNER JOIN users u ON u.id=cm.user_id WHERE u.id=${userId} AND u.active=TRUE AND c.active=TRUE ORDER BY c.trade_name,c.id`;
    if (!companyRows.length) throw new Error("El teléfono de WhatsApp no está asociado a ninguna empresa activa.");
    const from = String(payload.from ?? payload.chat_jid ?? payload.sender_jid ?? "");
    const chatJid = String(payload.chat_jid ?? from);
    const messageId = String(payload.message_id ?? payload.id ?? payload.key?.id ?? "");
    const senderDigits = from.replace(/\D/g, "");
    if (!senderDigits || !companyRows.length) return { state: "ignored" };
    const linkedCompanyIds = companyRows.map((company: any) => Number(company.id));
    const authorizedSender = await sql`
      SELECT DISTINCT u.id
      FROM users u
      INNER JOIN company_members cm ON cm.user_id = u.id
      WHERE u.active = TRUE
        AND regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') = ${senderDigits}
        AND cm.company_id IN ${sql(linkedCompanyIds)}
      LIMIT 1
    `;
    // Documents are accepted only from a phone explicitly registered on an
    // active Hexa user who belongs to the receiving company. Unknown senders
    // are deliberately silent: no reply, no pending row and no expense.
    if (!authorizedSender.length) return { state: "ignored" };
    const mediaType = String(payload.media_type ?? payload.type ?? payload.message_type ?? "").toLowerCase();
    const hasMedia = Boolean(payload.image || payload.document || payload.media || payload.filename || payload.url) || ["image", "document", "file", "pdf"].some((kind) => mediaType.includes(kind));
    if (hasMedia) {
      if (!messageId) throw new Error("El mensaje multimedia no incluye identificador para descargarlo.");
      const caption = String(payload.caption ?? payload.body ?? payload.content ?? "");
      const companyId = companyRows.length === 1 ? Number(companyRows[0].id) : null;
      const initialStatus = companyId == null ? "awaiting_company" : "awaiting_type";
      const inserted = await sql`INSERT INTO whatsapp_expense_pending (company_id,user_id,device_id,message_id,chat_jid,from_phone,caption,media_type,status,updated_at) VALUES (${companyId},${userId},${deviceId},${messageId},${chatJid},${from},${caption},${mediaType || "image"},${initialStatus},NOW()) ON CONFLICT (device_id,message_id) DO NOTHING RETURNING id`;
      // GOWA retries webhooks. Do not reopen or duplicate a document that is
      // already waiting for classification (or has already been processed).
      if (!inserted.length) return { state: "duplicate" };
      if (from) {
        try {
          const link = await createWhatsAppUploadLink(Number(inserted[0].id));
          await gowaSendText(deviceId, from, `He recibido tu documento 📎\n\nClica aquí para revisarlo y elegir el tipo:\n${link}\n\nEl enlace caduca en ${WHATSAPP_UPLOAD_LINK_TTL_MINUTES} minutos.`);
        } catch (error) {
          console.warn("Public WhatsApp upload link unavailable; using poll fallback", error);
          if (companyId == null) {
            const choices = companyRows.map((company, index) => `${index + 1}. ${company.trade_name || company.legal_name}`).join("\n");
            await gowaSendText(deviceId, from, `He recibido el documento 📎. ¿Para qué empresa es?\n${choices}\n\nResponde con el número o el nombre.`);
          } else {
            await sendExpenseTypePrompt(deviceId, from);
          }
        }
      }
      return { state: initialStatus };
    }
    const pollSelection = Array.isArray(payload.selected_options)
      ? payload.selected_options[0]
      : payload.selected_options?.option ?? payload.selected_option ?? payload.vote ?? payload.poll_answer ?? "";
    // Our patched GOWA exposes the decrypted WhatsApp poll vote as SHA-256
    // option hashes. WhatsApp deliberately sends hashes, not the label text;
    // map the fixed document-classification poll back to its visible label.
    const selectedPollHashes = Array.isArray(payload.selected_option_hashes)
      ? payload.selected_option_hashes.map((value: unknown) => String(value).toLowerCase())
      : [];
    const selectedPollLabel = [
      ["Ticket", "ticket"],
      ["Factura", "factura"],
      ["Factura simplificada", "factura simplificada"],
      ["Abono", "abono"],
      ["Justificante", "justificante"],
    ].find(([label]) => selectedPollHashes.includes(sha256HexSync(label).toLowerCase()))?.[1] ?? "";
    const listSelection = payload.list_response?.row_id ?? payload.list_response?.id ?? payload.list_response?.title
      ?? payload.selected_row_id ?? payload.row_id ?? payload.list?.row_id ?? payload.list?.title ?? "";
    const nestedText = typeof payload.text === "object" && payload.text !== null
      ? (payload.text as any).body ?? (payload.text as any).text ?? (payload.text as any).content ?? ""
      : payload.text;
    const rawTypeText = listSelection || pollSelection || selectedPollLabel || payload.body || payload.content || nestedText
      || payload.message?.text || payload.message?.body || payload.message?.content || "";
    const text = String(rawTypeText).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    const kind = text === "1" || text.includes("ticket") ? "ticket"
      : text === "2" || text === "factura" ? "invoice"
      : text === "3" || text.includes("simplificada") ? "simplified_invoice"
      : text === "4" || text.includes("abono") || text.includes("rectific") ? "credit_note"
      : text === "5" || text.includes("justificante") || text.includes("recibo") ? "receipt"
      : text.includes("factura") ? "invoice" : null;
    const pendingRows = from ? await sql`SELECT * FROM whatsapp_expense_pending WHERE device_id=${deviceId} AND from_phone=${from} AND status IN ('awaiting_company','awaiting_type') ORDER BY created_at DESC LIMIT 1` : [];
    if (!pendingRows.length) return { state: "ignored" };
    const pending = pendingRows[0];
    if (pending.status === "awaiting_company") {
      const selectedIndex = /^\d+$/.test(text) ? Number(text) - 1 : -1;
      const selected = selectedIndex >= 0
        ? companyRows[selectedIndex]
        : companyRows.find((company) => [company.trade_name, company.legal_name].some((name) => String(name || "").trim().toLowerCase() === text));
      if (!selected) {
        const choices = companyRows.map((company, index) => `${index + 1}. ${company.trade_name || company.legal_name}`).join("\n");
        await gowaSendText(deviceId, from, `No he identificado la empresa. Responde con el número o el nombre:\n${choices}`);
        return { state: "awaiting_company" };
      }
      await sql`UPDATE whatsapp_expense_pending SET company_id=${selected.id},status='awaiting_type',updated_at=NOW() WHERE id=${pending.id} AND status='awaiting_company'`;
      await sendExpenseTypePrompt(deviceId, from);
      return { state: "awaiting_type" };
    }
    if (!kind) {
      await gowaSendText(deviceId, from, "No he identificado el tipo. Responde TICKET, FACTURA, FACTURA SIMPLIFICADA, ABONO o JUSTIFICANTE.");
      return { state: "awaiting_type" };
    }
    const companyId = Number(pending.company_id);
    if (!companyId || !companyRows.some((company) => Number(company.id) === companyId)) throw new Error("La empresa seleccionada ya no está disponible para este teléfono.");
    const media = await gowaDownloadMessageMedia(deviceId, pending.message_id, pending.chat_jid);
    const settingsRows = await sql`
      SELECT key, value
      FROM settings
      WHERE key IN ('ollama_url','ollama_model')
         OR key IN (${companySettingKey(companyId, "ollama_url")}, ${companySettingKey(companyId, "ollama_model")})
    `;
    let vision: ExpenseDocumentInput = {};
    let visionError = "";
    try {
      vision = await extractExpenseFromImage(media.data_url, pending.caption, {
        baseUrl: settingValue(settingsRows, companyId, "ollama_url") || undefined,
        model: settingValue(settingsRows, companyId, "ollama_model") || undefined,
      });
    } catch (error) {
      // A broken/missing vision model must not discard the document or make
      // GOWA retry the same poll indefinitely. Keep the attachment in review
      // with caption-derived hints and tell the sender what happened.
      visionError = error instanceof Error ? error.message : "El lector automático no está disponible";
      console.warn("WhatsApp OCR unavailable; keeping document for manual review", visionError);
    }
    const hints = { ...extractExpenseHints(pending.caption), ...vision };
    // A webhook has no browser session. Persist with the company and user that
    // were cryptographically bound to the GOWA device instead of calling the
    // session-protected upsertExpenseDocument method.
    const attachments = [{ id: `wa-${pending.message_id}`, name: media.name, mime_type: media.mime_type, size: Math.floor((media.data_url.length * 3) / 4), data_url: media.data_url }];
    const expenseRows = await sql.begin(async (tx) => {
      const rows = await tx`INSERT INTO expense_documents (company_id,status,kind,title,supplier_name,supplier_tax_id,invoice_number,issued_at,accounting_date,base_cents,vat_cents,total_cents,notes,attachments,source,source_phone,ocr_confidence,created_by) VALUES (${companyId},'review',${kind},${hints.title || media.name},${hints.supplier_name || ""},${hints.supplier_tax_id || ""},${hints.invoice_number || ""},${hints.issued_at || null},${hints.issued_at || null},${hints.base_cents || 0},${hints.vat_cents || 0},${hints.total_cents || 0},${hints.notes || pending.caption},${tx.json(attachments)},'whatsapp',${pending.from_phone},${hints.ocr_confidence ?? 0.8},${userId}) RETURNING *`;
      await tx`UPDATE whatsapp_expense_pending SET status='processed',updated_at=NOW() WHERE id=${pending.id} AND status='awaiting_type'`;
      return rows;
    });
    const expense = formatExpenseDocument(expenseRows[0]);
    await gowaSendText(deviceId, from, visionError
      ? `Documento recibido como ${kind === "ticket" ? "ticket" : kind === "credit_note" ? "abono" : "factura"}. Lo he dejado en Gastos y facturas para revisión; no he podido leer automáticamente todos los datos.`
      : `Documento recibido como ${kind === "ticket" ? "ticket" : kind === "credit_note" ? "abono" : "factura"}. Lo he dejado en Gastos y facturas para revisión.`);
    return { state: "processed", expense };
  },

  async syncWhatsAppExpense(token: string | null, kind: ExpenseDocument["kind"] = "invoice"): Promise<ExpenseDocument> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const deviceId = gowaDeviceId(companyId, user.id);
    const latest = await gowaLatestMedia(deviceId);
    const settings = await this.get_settings(token);
    const vision = await extractExpenseFromImage(latest.media.data_url, latest.caption, { baseUrl: settings.ollama_url, model: settings.ollama_model });
    const hints = { ...extractExpenseHints(latest.caption), ...vision };
    const input = { kind, title: hints.title || latest.media.name, supplier_name: hints.supplier_name || "", supplier_tax_id: hints.supplier_tax_id || "", invoice_number: hints.invoice_number || "", issued_at: hints.issued_at || null, base_cents: hints.base_cents || 0, vat_cents: hints.vat_cents || 0, total_cents: hints.total_cents || 0, notes: hints.notes || latest.caption, ocr_confidence: hints.ocr_confidence ?? 0.8, attachments: [{ id: `wa-${latest.message_id}`, name: latest.media.name, mime_type: latest.media.mime_type, size: Math.floor((latest.media.data_url.length * 3) / 4), data_url: latest.media.data_url }], source: "whatsapp" as const, source_phone: latest.from };
    return this.upsertExpenseDocument(input, token);
  },

  async create_cash_movement(input: CashInput, token: string | null): Promise<CashMovement> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const amount = Number(input.amount_cents);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("El importe debe ser un entero mayor que cero");
    if (!["income", "expense", "adjustment"].includes(input.kind)) throw new Error("Tipo de movimiento no válido");
    if (input.project_id != null) {
      const projectRows = await sql`
        SELECT id, customer_id FROM work_projects
        WHERE id = ${input.project_id} AND (company_id = ${companyId} OR task_company_id = ${companyId})
      `;
      if (projectRows.length === 0) throw new Error("Proyecto no encontrado.");
      if (projectRows[0].customer_id == null) {
        throw new Error("Los proyectos propios no admiten movimientos de pago.");
      }
    }

    const occurredAt = input.occurred_at?.trim() || null;
    const res = await sql`
      INSERT INTO cash_movements (company_id, project_id, kind, amount_cents, category, description, occurred_at)
      VALUES (${companyId}, ${input.project_id ?? null}, ${input.kind}, ${amount}, ${input.category || "otros"}, ${input.description || ""}, COALESCE(${occurredAt}::timestamptz, NOW()))
      RETURNING *
    `;
    const m = res[0];
    return {
      id: m.id,
      company_id: m.company_id,
      project_id: m.project_id ?? null,
      kind: m.kind,
      amount_cents: m.amount_cents,
      category: m.category,
      description: m.description ?? "",
      sale_id: m.sale_id ?? null,
      occurred_at: toIso(m.occurred_at),
    };
  },

  async get_cash_balance(token: string | null): Promise<number> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const res = await sql`
      SELECT COALESCE(
        SUM(CASE WHEN kind = 'expense' THEN -ABS(amount_cents) ELSE ABS(amount_cents) END),
        0
      )::int as balance
      FROM cash_movements
      WHERE company_id = ${companyId}
    `;
    return res[0].balance;
  },

  async vat_summary(from: string, to: string, token: string | null): Promise<VatSummary> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    // completed + partially_returned; net amounts after returned_qty (ciclo 8)
    const lines = await sql`
      SELECT sl.id, sl.product_id, sl.qty, sl.returned_qty, sl.vat_rate,
             sl.line_base_cents, sl.line_vat_cents, sl.line_total_cents
      FROM sale_lines sl
      JOIN sales s ON sl.sale_id = s.id
      WHERE s.status IN ('completed', 'partially_returned')
        AND s.company_id = ${companyId}
        AND s.sold_at >= ${new Date(from)}
        AND s.sold_at <= ${new Date(to + "T23:59:59.999Z")}
    `;

    const bucketsMap = new Map<number, { base: number; vat: number; total: number }>();
    for (const rate of [0, 4, 10, 21]) {
      bucketsMap.set(rate, { base: 0, vat: 0, total: 0 });
    }
    let totalBase = 0;
    let totalVat = 0;
    let totalSales = 0;
    for (const l of lines) {
      const net = remainingLineAmounts({
        id: l.id,
        product_id: l.product_id,
        qty: l.qty,
        returned_qty: l.returned_qty ?? 0,
        line_total_cents: l.line_total_cents,
        line_base_cents: l.line_base_cents,
        line_vat_cents: l.line_vat_cents,
      });
      const rate = Number(l.vat_rate);
      const b = bucketsMap.get(rate) ?? { base: 0, vat: 0, total: 0 };
      b.base += net.base_cents;
      b.vat += net.vat_cents;
      b.total += net.total_cents;
      bucketsMap.set(rate, b);
      totalBase += net.base_cents;
      totalVat += net.vat_cents;
      totalSales += net.total_cents;
    }
    const buckets = [0, 4, 10, 21].map((vat_rate) => {
      const b = bucketsMap.get(vat_rate)!;
      return {
        vat_rate: vat_rate as 0 | 4 | 10 | 21,
        base_cents: b.base,
        vat_cents: b.vat,
        total_cents: b.total,
      };
    });

    return {
      from,
      to,
      buckets,
      base_cents: totalBase,
      vat_cents: totalVat,
      total_cents: totalSales,
    };
  },

  async listFiscalProfiles(token: string | null): Promise<FiscalProfile[]> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const rows = await sql`SELECT * FROM fiscal_profiles WHERE company_id = ${companyId}`;
    return rows.map(formatFiscalProfile);
  },

  async upsertFiscalProfile(input: any, token: string | null): Promise<FiscalProfile> {
    const user = await requireAdmin(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const previousRows = await sql`SELECT * FROM fiscal_profiles WHERE company_id = ${companyId}`;
    const previous = previousRows[0] ? formatFiscalProfile(previousRows[0]) : null;
    const regime = String(input?.regime ?? previous?.regime ?? "general");
    const period = String(input?.period ?? previous?.period ?? "quarterly");
    const entityType = String(input?.entity_type ?? previous?.entity_type ?? "autonomo");
    if (!["general", "simplified", "recargo_equivalencia", "other"].includes(regime)) throw new Error("Régimen fiscal no válido");
    if (!["monthly", "quarterly"].includes(period)) throw new Error("Periodicidad no válida");
    if (!["autonomo", "sociedad", "otra"].includes(entityType)) throw new Error("Tipo de contribuyente no válido");
    const taxSetup = normalizeTaxSetup(input?.tax_setup ?? previous?.tax_setup);
    if (entityType === "autonomo" && !["direct_estimation", "objective_estimation", "none"].includes(taxSetup.income_regime)) {
      throw new Error("Selecciona el régimen de IRPF del autónomo");
    }
    const siiEnabled = input?.sii_enabled === undefined ? !!previous?.sii_enabled : !!input.sii_enabled;
    if (siiEnabled && period !== "monthly") throw new Error("El SII requiere periodicidad mensual");
    const rate = Number(input?.default_irpf_rate ?? previous?.default_irpf_rate ?? 0);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("El IRPF debe estar entre 0 y 100");
    const verifactuMode = String(input?.verifactu_mode ?? previous?.verifactu_mode ?? "disabled");
    if (!["disabled", "test", "production"].includes(verifactuMode)) throw new Error("Modo VERI*FACTU no válido");
    const producerNif = String(input?.verifactu_producer_nif ?? previous?.verifactu_producer_nif ?? "").trim().toUpperCase();
    if (verifactuMode !== "disabled" && !producerNif) throw new Error("El NIF emisor es obligatorio para activar VERI*FACTU");
    const profileCompleted = input?.profile_completed === undefined ? !!previous?.profile_completed : input.profile_completed === true;
    const taxModels = deriveTaxModels({ entity_type: entityType as FiscalProfile["entity_type"], regime: regime as FiscalProfile["regime"], period: period as FiscalProfile["period"], sii_enabled: siiEnabled, profile_completed: profileCompleted, tax_setup: taxSetup });
    const rows = await sql`
      INSERT INTO fiscal_profiles (company_id, invoice_series, regime, period, entity_type, irpf_enabled, default_irpf_rate, sii_enabled, verifactu_mode, verifactu_software_id, verifactu_software_name, verifactu_software_version, verifactu_producer_name, verifactu_producer_nif, tax_models, tax_setup, profile_completed, updated_at)
      VALUES (${companyId}, ${String(input?.invoice_series ?? previous?.invoice_series ?? "F").trim().toUpperCase() || "F"}, ${regime}, ${period}, ${entityType}, ${input?.irpf_enabled === undefined ? !!previous?.irpf_enabled : !!input.irpf_enabled}, ${rate}, ${siiEnabled}, ${verifactuMode}, ${String(input?.verifactu_software_id ?? previous?.verifactu_software_id ?? "hexa-crm")}, ${String(input?.verifactu_software_name ?? previous?.verifactu_software_name ?? "Hexa CRM")}, ${String(input?.verifactu_software_version ?? previous?.verifactu_software_version ?? "0.3.2")}, ${String(input?.verifactu_producer_name ?? previous?.verifactu_producer_name ?? "")}, ${producerNif}, ${sql.json(taxModels.map((model) => model.code))}, ${sql.json(taxSetup)}, ${profileCompleted}, NOW())
      ON CONFLICT (company_id) DO UPDATE SET regime=EXCLUDED.regime, period=EXCLUDED.period,
        invoice_series=EXCLUDED.invoice_series,
        entity_type=EXCLUDED.entity_type,
        irpf_enabled=EXCLUDED.irpf_enabled, default_irpf_rate=EXCLUDED.default_irpf_rate,
        sii_enabled=EXCLUDED.sii_enabled, verifactu_mode=EXCLUDED.verifactu_mode,
        verifactu_software_id=EXCLUDED.verifactu_software_id, verifactu_software_name=EXCLUDED.verifactu_software_name,
        verifactu_software_version=EXCLUDED.verifactu_software_version, verifactu_producer_name=EXCLUDED.verifactu_producer_name,
        verifactu_producer_nif=EXCLUDED.verifactu_producer_nif, tax_models=EXCLUDED.tax_models,
        tax_setup=EXCLUDED.tax_setup, profile_completed=EXCLUDED.profile_completed, updated_at=NOW()
      RETURNING *
    `;
    return formatFiscalProfile(rows[0]);
  },

  async model303Draft(from: string, to: string, token: string | null): Promise<Model303Draft> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const [salesRows, linesRows, expenseRows, profileRows] = await Promise.all([
      sql`SELECT * FROM sales WHERE company_id = ${companyId} AND sold_at >= ${new Date(from)} AND sold_at <= ${new Date(to + "T23:59:59.999Z")}`,
      sql`SELECT sl.* FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id WHERE s.company_id = ${companyId} AND s.sold_at >= ${new Date(from)} AND s.sold_at <= ${new Date(to + "T23:59:59.999Z")}`,
      sql`SELECT * FROM expense_documents WHERE company_id = ${companyId}`,
      sql`SELECT * FROM fiscal_profiles WHERE company_id = ${companyId}`,
    ]);
    const sales = salesRows.map((row: any) => ({ ...row, sold_at: toIso(row.sold_at), company_id: companyId }));
    const saleLines = linesRows.map((row: any) => ({ ...row, returned_qty: row.returned_qty ?? 0 }));
    return buildModel303Draft({
      company_id: companyId,
      from,
      to,
      sales: sales as any,
      saleLines: saleLines as any,
      expenses: expenseRows.map(formatExpenseDocument),
      profile: profileRows[0] ? formatFiscalProfile(profileRows[0]) : null,
    });
  },

  async dashboard_stats(token: string | null): Promise<DashboardStats & { sales_yesterday_cents?: number }> {
    const user = await requireSession(token);
    if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const monthStr = todayStr.slice(0, 7);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const startToday = new Date(todayStr + "T00:00:00.000Z");
    const endToday = new Date(todayStr + "T23:59:59.999Z");
    const startYesterday = new Date(yesterdayStr + "T00:00:00.000Z");
    const endYesterday = new Date(yesterdayStr + "T23:59:59.999Z");
    const startMonth = new Date(monthStr + "-01T00:00:00.000Z");

    // Net revenue = total_cents - refunded_cents; include partial returns
    const todayRes = await sql`
      SELECT COALESCE(SUM(total_cents - COALESCE(refunded_cents, 0)), 0)::int as total,
             COUNT(*)::int as count
      FROM sales
      WHERE status IN ('completed', 'partially_returned')
        AND company_id = ${cid}
        AND sold_at >= ${startToday} AND sold_at <= ${endToday}
    `;

    const yesterdayRes = await sql`
      SELECT COALESCE(SUM(total_cents - COALESCE(refunded_cents, 0)), 0)::int as total,
             COUNT(*)::int as count
      FROM sales
      WHERE status IN ('completed', 'partially_returned')
        AND company_id = ${cid}
        AND sold_at >= ${startYesterday} AND sold_at <= ${endYesterday}
    `;

    const monthRes = await sql`
      SELECT
        COALESCE(SUM(total_cents - COALESCE(refunded_cents, 0)), 0)::int as total,
        COALESCE(SUM(vat_cents), 0)::int as vat,
        COALESCE(SUM(subtotal_cents), 0)::int as base,
        COUNT(*)::int as count
      FROM sales
      WHERE status IN ('completed', 'partially_returned') AND company_id = ${cid} AND sold_at >= ${startMonth}
    `;

    const cash = await this.get_cash_balance(token);

    const lowRows = await sql`
      SELECT *
      FROM products
      WHERE active = TRUE AND company_id = ${cid} AND stock <= min_stock
      ORDER BY stock ASC, name ASC
    `;

    const low_stock: Product[] = lowRows.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      category: p.category ?? "",
      stock: p.stock,
      min_stock: p.min_stock,
      cost_cents: p.cost_cents,
      price_cents: p.price_cents,
      vat_rate: p.vat_rate,
      active: !!p.active,
      created_at: toIso(p.created_at),
      updated_at: toIso(p.updated_at),
    }));

    return {
      sales_today_cents: todayRes[0].total,
      sales_today_count: todayRes[0].count,
      sales_month_cents: monthRes[0].total,
      sales_month_count: monthRes[0].count,
      cash_balance_cents: cash,
      low_stock,
      vat_month_cents: monthRes[0].vat,
      base_month_cents: monthRes[0].base,
      // Extra for AI context (not required by UI type)
      sales_yesterday_cents: yesterdayRes[0].total,
    };
  },

  async get_settings(token: string | null): Promise<Settings> {
    const user = await requireSession(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const companyRows = await sql`SELECT trade_name FROM companies WHERE id = ${companyId} AND active = TRUE`;
    const rows = await sql`SELECT key, value FROM settings`;

    return {
      shop_name: String(companyRows[0]?.trade_name || settingValue(rows, companyId, "shop_name", "Mi Tienda")),
      ollama_model: settingValue(rows, companyId, "ollama_model", "qwen3.5:4b"),
      ollama_url: settingValue(rows, companyId, "ollama_url", "http://127.0.0.1:11434"),
      default_vat: (() => {
        const n = Number(settingValue(rows, companyId, "default_vat", "21"));
        return isVatRate(n) ? n : 21;
      })(),
      idle_timeout_minutes: (() => {
        const n = Number(settingValue(rows, companyId, "idle_timeout_minutes", "15"));
        return Number.isInteger(n) && n >= 0 && n <= 480 ? n : 15;
      })(),
      last_backup_at: settingValue(rows, companyId, "last_backup_at") || null,
      monthly_economic_goals: (() => {
        try {
          const parsed = JSON.parse(settingValue(rows, companyId, "monthly_economic_goals", "{}"));
          return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
          return {};
        }
      })(),
    };
  },

  async update_settings(partial: Partial<Settings>, token: string | null): Promise<Settings> {
    const user = await requireAdmin(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const allowed: (keyof Settings)[] = [
      "shop_name",
      "ollama_model",
      "ollama_url",
      "default_vat",
      "idle_timeout_minutes",
      "last_backup_at",
      "monthly_economic_goals",
    ];
    for (const key of allowed) {
      const value = partial[key];
      if (value !== undefined) {
        if (
          key === "idle_timeout_minutes" &&
          (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 480)
        ) {
          throw new Error("El bloqueo automático debe estar entre 0 y 480 minutos");
        }
        const storedValue = key === "monthly_economic_goals"
          ? JSON.stringify(value)
          : value == null ? "" : value.toString();
        if (key === "shop_name") {
          await sql`UPDATE companies SET trade_name = ${String(value ?? "").trim()} WHERE id = ${companyId} AND active = TRUE`;
        }
        await sql`
          INSERT INTO settings (key, value)
          VALUES (${companySettingKey(companyId, key)}, ${storedValue})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `;
      }
    }
    return this.get_settings(token);
  },

  async ai_chat(messages: AiMessage[], token: string | null): Promise<AiChatResult> {
    const me = await requireSession(token);
    const settings = await this.get_settings(token);
    const cid = await resolveActiveCompanyId(token, me.id);

    const todayStr = new Date().toISOString().slice(0, 10);

    // Contexto compacto de negocio
    const stats = await this.dashboard_stats(token);
    const lowStockProds = await sql`
      SELECT name, stock, price_cents
      FROM products
      WHERE active = TRUE AND company_id = ${cid}
      ORDER BY stock ASC
      LIMIT 10
    `;

    const context = {
      tienda: settings.shop_name,
      fecha_hoy: todayStr,
      ventas_hoy_eur: (stats.sales_today_cents / 100).toFixed(2),
      tickets_hoy: stats.sales_today_count,
      ventas_ayer_eur: ((stats.sales_yesterday_cents ?? 0) / 100).toFixed(2),
      ventas_mes_eur: (stats.sales_month_cents / 100).toFixed(2),
      tickets_mes: stats.sales_month_count,
      caja_eur: (stats.cash_balance_cents / 100).toFixed(2),
      iva_mes_eur: (stats.vat_month_cents / 100).toFixed(2),
      productos_bajo_stock: lowStockProds.map(
        (p) => `${p.name} (${p.stock} uds - ${(p.price_cents / 100).toFixed(2)}€)`,
      ),
    };

    const systemPrompt = `Te llamas Lucía y eres la asistente virtual inteligente de la tienda "${settings.shop_name}" en España. 
Responde siempre en español, de manera concisa, técnica y con un tono profesional pero cercano y de chica.
Tus habilidades en este CRM incluyen:
- Gestionar y supervisar el inventario (alertar sobre existencias bajas).
- Analizar estadísticas de ventas del día, comparativa con el ayer y consolidados mensuales.
- Controlar movimientos de efectivo e ingresos de caja.
- Calcular desgloses de impuestos e IVA (0%, 4%, 10%, 21% de España).
- Apoyar en operaciones de ventas y facturación de mostrador.
Precios en EUR con IVA incluido. Contexto de negocio actual (JSON compacto): ${JSON.stringify(context)}.
No inventes datos fuera de este contexto. Si falta información, indícalo educadamente.`;

    const payloadMsgs = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const url = `${settings.ollama_url.replace(/\/$/, "")}/api/chat`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ollamaChatBody(settings.ollama_model, payloadMsgs, { num_predict: 96 })),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          reply: `Error de conexión con Ollama (HTTP ${response.status})${body ? `: ${body.slice(0, 160)}` : ""}.`,
          model: settings.ollama_model,
          offline: true,
        };
      }

      const data = await response.json();
      if (data.error) {
        return {
          reply: `Error de Ollama: ${data.error}`,
          model: settings.ollama_model,
          offline: true,
        };
      }
      return {
        reply: extractOllamaReply(data.message),
        model: data.model || settings.ollama_model,
        offline: false,
      };
    } catch {
      return {
        reply: "No se puede conectar con el servicio local de Ollama. Asegúrate de tener Ollama activo y el modelo correspondiente descargado.",
        model: settings.ollama_model,
        offline: true,
      };
    }
  },

  async ollama_health(token: string | null): Promise<{ ok: boolean; models: string[] }> {
    await requireSession(token);
    const settings = await this.get_settings(token);
    const url = `${settings.ollama_url.replace(/\/$/, "")}/api/tags`;

    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const models = data.models?.map((m: any) => m.name) || [];
        return { ok: true, models };
      }
      return { ok: false, models: [] };
    } catch {
      return { ok: false, models: [] };
    }
  },

  async reset_demo(token: string | null): Promise<void> {
    await requireAdmin(token);
    if (CENTRAL_MODE) {
      throw new Error("Restaurar demo está desactivado en el CRM central; no se pueden borrar datos de otras empresas.");
    }
    // Truncar tablas y volver a sembrar
    await sql`TRUNCATE TABLE sessions, work_items, work_projects, work_categories, cash_movements, sale_lines, sales, stock_movements, products, customers RESTART IDENTITY CASCADE`;
    await seedProductsAndCustomers();
  },

  async export_backup(token: string | null): Promise<BackupEnvelope> {
    const user = await requireAdmin(token);
    const companyId = await resolveActiveCompanyId(token, user.id);
    const [products, customers, sales, sale_lines, cash_movements, stock_movements, settings, users, work_categories, work_projects, work_items] =
      await Promise.all([
        sql`SELECT * FROM products WHERE company_id = ${companyId} ORDER BY id`,
        sql`SELECT * FROM customers WHERE company_id = ${companyId} ORDER BY id`,
        sql`SELECT * FROM sales WHERE company_id = ${companyId} ORDER BY id`,
        sql`SELECT sl.* FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id WHERE s.company_id = ${companyId} ORDER BY sl.id`,
        sql`SELECT * FROM cash_movements WHERE company_id = ${companyId} ORDER BY id`,
        sql`SELECT * FROM stock_movements WHERE company_id = ${companyId} ORDER BY id`,
        sql`SELECT * FROM settings WHERE key LIKE ${`company:${companyId}:%`} OR key = 'whatsapp_webhook_trace' ORDER BY key`,
        sql`SELECT u.id, u.username, u.display_name, u.role, u.active, u.created_at, u.must_change_password, u.temp_password_issued_at
            FROM users u INNER JOIN company_members cm ON cm.user_id = u.id
            WHERE cm.company_id = ${companyId} ORDER BY u.id`,
        sql`SELECT * FROM work_categories WHERE company_id = ${companyId} ORDER BY id`,
        sql`SELECT * FROM work_projects WHERE company_id = ${companyId} OR task_company_id = ${companyId} ORDER BY id`,
        sql`SELECT * FROM work_items WHERE company_id = ${companyId} ORDER BY id`,
      ]);
    const backup = await createBackupEnvelope({
      backend: "postgres",
      products,
      customers,
      sales,
      sale_lines,
      cash_movements,
      stock_movements,
      settings,
      users,
      work_categories,
      work_projects,
      work_items,
    });
    await sql`
      INSERT INTO settings (key, value) VALUES (${companySettingKey(companyId, "last_backup_at")}, ${backup.created_at})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
    return backup;
  },

  async pre_migration_backup(reason: string, token: string | null): Promise<BackupEnvelope> {
    await requireAdmin(token);
    const full = await this.export_backup(token);
    return createPreMigrationBackup(full.payload, reason);
  },

  async restore_backup(raw: unknown, token: string | null): Promise<{ imported: Record<string, number> }> {
    const user = await requireAdmin(token);
    const v = await validateBackup(raw);
    if (!v.ok) throw new Error(v.error);
    const p = v.envelope.payload as { backend?: string; products?: unknown[] };
    if (!p || p.backend !== "postgres" || !Array.isArray(p.products)) {
      const companyId = await resolveActiveCompanyId(token, user.id);
      return { imported: await importLocalBackup(v.envelope.payload, companyId, user.id) };
    }
    // Conservative: full restore is destructive; require explicit structure
    throw new Error(
      "Restauración completa Postgres desde UI desactivada por seguridad. Usa docs/BACKUP.md (pg_dump) o un runbook admin.",
    );
  },

  /* -------------------------------------------------------------
     Módulo Trabajo (Multiempresa) PostgreSQL Implementation
     ------------------------------------------------------------- */

  async portal_list_projects(token: string | null): Promise<ClientPortalProject[]> {
    const user = await requireSession(token);
    if (user.role !== "cliente") throw new Error("Se requiere un perfil de cliente.");
    const rows = await sql`
      SELECT p.* FROM work_projects p
      INNER JOIN project_client_access access ON access.project_id = p.id
      WHERE access.user_id = ${user.id} AND p.status <> 'archived'
      ORDER BY p.updated_at DESC
    `;
    return Promise.all(rows.map((row) => this.portal_get_project(String(row.uid), token)));
  },

  async portal_get_project(reference: string, token: string | null): Promise<ClientPortalProject> {
    const user = await requireSession(token);
    if (user.role !== "cliente") throw new Error("Se requiere un perfil de cliente.");
    const projectRows = await sql`
      SELECT p.* FROM work_projects p
      INNER JOIN project_client_access access ON access.project_id = p.id
      WHERE access.user_id = ${user.id} AND (p.uid::text = ${String(reference)} OR p.id::text = ${String(reference)})
      LIMIT 1
    `;
    if (!projectRows.length) throw new Error("Proyecto no encontrado o sin acceso.");
    const row = projectRows[0];
    const [taskRows, invoiceRows] = await Promise.all([
      sql`
        SELECT wi.id,wi.parent_id,wi.title,wi.status,wi.priority,wi.due_date,
               COALESCE(wi.due_date,parent.due_date) AS effective_due_date
        FROM work_items wi
        LEFT JOIN work_items parent ON parent.id=wi.parent_id
        WHERE wi.project_id=${row.id} AND wi.status <> 'archived'
        ORDER BY wi.sort_order,wi.created_at
      `,
      sql`
        SELECT id,series,number,kind,status,issued_at,operation_date,due_at,total_cents,paid_cents,payment_status
        FROM invoices
        WHERE project_id=${row.id} AND status='issued'
        ORDER BY issued_at DESC
      `,
    ]);
    const management = normalizeProjectManagement(row.management);
    return {
      id: Number(row.id), uid: String(row.uid), name: String(row.name), description: String(row.description ?? ""),
      status: row.status, start_date: toIso(row.start_date) || null, target_date: toIso(row.target_date) || null,
      logo_data_url: String(row.logo_data_url ?? ""), milestones: management.milestones,
      tasks: taskRows.map((task) => ({ id:Number(task.id),parent_id:task.parent_id==null?null:Number(task.parent_id),title:String(task.title),status:task.status,priority:task.priority,due_date:toIso(task.due_date)||null,effective_due_date:toIso(task.effective_due_date)||null })),
      invoices: invoiceRows.map((invoice) => ({ id:Number(invoice.id),series:String(invoice.series),number:String(invoice.number),kind:invoice.kind,status:invoice.status,issued_at:toIso(invoice.issued_at),operation_date:toIso(invoice.operation_date).slice(0,10),due_at:toIso(invoice.due_at)||null,total_cents:Number(invoice.total_cents),paid_cents:Number(invoice.paid_cents),payment_status:invoice.payment_status })),
      requests: (Array.isArray(row.requests) ? row.requests : []).filter(
        (request: WorkProjectRequest) => request.requester_user_id === Number(user.id),
      ),
    };
  },

  async portal_create_request(reference: string, input: Partial<WorkProjectRequest>, token: string | null): Promise<WorkProjectRequest> {
    const user = await requireSession(token);
    if (user.role !== "cliente") throw new Error("Se requiere un perfil de cliente.");
    const allowedTypes = new Set(["suggestion","improvement","issue","feature","question"]);
    const type = allowedTypes.has(String(input.type)) ? input.type! : "suggestion";
    const title = String(input.title ?? "").trim().slice(0,180);
    const description = String(input.description ?? "").trim().slice(0,5000);
    if (!title || !description) throw new Error("Indica un título y una descripción.");
    const now = new Date().toISOString();
    const request: WorkProjectRequest = { id: randomBytes(12).toString("hex"), type, title, description, requester:user.display_name, requester_user_id:Number(user.id), priority:input.priority??"normal", impact:String(input.impact??"").slice(0,1000), status:"new", reviewer_id:null, task_id:null, messages:[], created_at:now, updated_at:now };
    await sql.begin(async (tx) => {
      const rows = await tx`SELECT p.id,p.requests FROM work_projects p INNER JOIN project_client_access access ON access.project_id=p.id WHERE access.user_id=${user.id} AND (p.uid::text=${String(reference)} OR p.id::text=${String(reference)}) FOR UPDATE`;
      if (!rows.length) throw new Error("Proyecto no encontrado o sin acceso.");
      const requests = Array.isArray(rows[0].requests) ? rows[0].requests : [];
      await tx`UPDATE work_projects SET requests=${tx.json([...requests,request] as any)},updated_at=NOW() WHERE id=${rows[0].id}`;
    });
    return request;
  },

  async portal_add_request_message(reference: string, requestId: string, text: string, token: string | null): Promise<WorkProjectRequest> {
    const user = await requireSession(token);
    if (user.role !== "cliente") throw new Error("Se requiere un perfil de cliente.");
    const messageText = String(text).trim().slice(0,3000);
    if (!messageText) throw new Error("Escribe un mensaje.");
    return sql.begin(async (tx) => {
      const rows = await tx`SELECT p.id,p.requests FROM work_projects p INNER JOIN project_client_access access ON access.project_id=p.id WHERE access.user_id=${user.id} AND (p.uid::text=${String(reference)} OR p.id::text=${String(reference)}) FOR UPDATE`;
      if (!rows.length) throw new Error("Proyecto no encontrado o sin acceso.");
      const requests = (Array.isArray(rows[0].requests) ? rows[0].requests : []) as WorkProjectRequest[];
      const index = requests.findIndex((entry) => entry.id === String(requestId));
      if (index < 0) throw new Error("Solicitud no encontrada.");
      if (requests[index].requester_user_id !== Number(user.id)) throw new Error("Solicitud no encontrada.");
      const now = new Date().toISOString();
      requests[index] = { ...requests[index], updated_at:now, messages:[...(requests[index].messages??[]),{ id:randomBytes(10).toString("hex"),author:user.display_name,text:messageText,created_at:now }] };
      await tx`UPDATE work_projects SET requests=${tx.json(requests as any)},updated_at=NOW() WHERE id=${rows[0].id}`;
      return requests[index];
    });
  },

  async listWorkProjects(status_filter?: string, token?: string | null): Promise<WorkProject[]> {
    const user = await requireSession(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);

    let query = sql`
      SELECT * FROM work_projects
      WHERE (company_id = ${companyId} OR task_company_id = ${companyId})
    `;
    if (status_filter && status_filter.trim() !== "" && status_filter !== "all") {
      query = sql`${query} AND status = ${status_filter.trim()}`;
    }
    query = sql`${query} ORDER BY created_at DESC, id DESC`;
    const rows = await query;
    return attachProjectRevenueMilestones(rows.map(formatWorkProject), companyId);
  },

  async getWorkProject(reference: number | string, token?: string | null): Promise<WorkProject> {
    const user = await requireSession(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);
    const ref = String(reference);
    const numericId = /^\d+$/.test(ref) ? Number(ref) : null;

    const rows = await sql`
      SELECT * FROM work_projects
      WHERE (company_id = ${companyId} OR task_company_id = ${companyId})
        AND (uid::text = ${ref} OR (${numericId}::integer IS NOT NULL AND id = ${numericId}))
    `;
    if (rows.length === 0) throw new Error("Proyecto no encontrado.");
    return (await attachProjectRevenueMilestones([formatWorkProject(rows[0])], companyId))[0];
  },

  async upsertWorkProject(input: WorkProjectInput, token?: string | null): Promise<WorkProject> {
    const user = await requireAdminProjectManagementPg(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);

    const name = (input.name ?? "").trim();
    if (!name) throw new Error("El nombre del proyecto es obligatorio.");
    if (input.documents) {
      const documentError = validateProjectDocuments(input.documents);
      if (documentError) throw new Error(documentError);
    }
    const logoError = validateProjectLogo(input.logo_data_url);
    if (logoError) throw new Error(logoError);

    let existing: any = null;
    if (input.id != null) {
      const existingRows = await sql`
        SELECT * FROM work_projects
        WHERE id = ${input.id} AND (company_id = ${companyId} OR task_company_id = ${companyId})
      `;
      if (existingRows.length === 0) throw new Error("Proyecto no encontrado.");
      existing = existingRows[0];
    }

    const startDate = input.start_date !== undefined ? (input.start_date ?? null) : (existing?.start_date ? toIso(existing.start_date) : null);
    const targetDate = input.target_date !== undefined ? (input.target_date ?? null) : (existing?.target_date ? toIso(existing.target_date) : null);

    if (startDate && targetDate) {
      const startMs = new Date(startDate).getTime();
      const targetMs = new Date(targetDate).getTime();
      if (targetMs < startMs) {
        throw new Error("La fecha de fin no puede ser anterior a la fecha de inicio.");
      }
    }

    const status = input.status ?? existing?.status ?? "planned";
    const projectType = input.project_type ?? existing?.project_type ?? (existing?.customer_id == null ? "own" : "client");
    if (!["own", "client", "internal"].includes(projectType)) throw new Error("Tipo de proyecto no válido.");
    const requestedClientCompanyId = input.client_company_id !== undefined
      ? (input.client_company_id ?? null)
      : (existing?.client_company_id ?? null);
    // Own products are managed by the studio itself and never retain a
    // client-company relation when changing type from client/internal.
    const clientCompanyId = projectType === "own" ? null : requestedClientCompanyId;
    if (projectType === "internal" && clientCompanyId == null && input.project_type !== undefined) throw new Error("Selecciona la empresa propietaria.");
    if (clientCompanyId != null) {
      const companyRows = await sql`SELECT id FROM companies WHERE id = ${clientCompanyId} AND active = TRUE`;
      if (companyRows.length === 0) throw new Error("Empresa cliente no encontrada.");
      const members = await loadMembers();
      if (!canAccessCompany(user.id, Number(clientCompanyId), members as { company_id: number; user_id: number; role: "admin" | "cajero" }[], !!user.is_master)) throw new Error("No tienes acceso a la empresa cliente.");
    }
    const taskCompanyId = projectType === "internal" ? clientCompanyId : companyId;
    if (projectType === "internal" && taskCompanyId == null) throw new Error("Selecciona la empresa propietaria.");
    if (taskCompanyId != null) {
      const taskCompanyRows = await sql`SELECT id FROM companies WHERE id = ${taskCompanyId} AND active = TRUE`;
      if (taskCompanyRows.length === 0) throw new Error("Empresa de tareas no encontrada.");
      const taskMembers = await loadMembers();
      if (!canAccessCompany(user.id, Number(taskCompanyId), taskMembers as { company_id: number; user_id: number; role: "admin" | "cajero" }[], !!user.is_master)) throw new Error("No tienes acceso a la empresa de tareas.");
    }
    const valueCents = input.value_cents ?? existing?.value_cents ?? 0;
    if (valueCents < 0) throw new Error("El valor del proyecto no puede ser negativo.");
    const monthlyEstimateCents = input.revenue_milestones !== undefined
      ? input.revenue_milestones.reduce((sum, milestone) => sum + milestone.amount_cents, 0)
      : (input.monthly_estimate_cents ?? existing?.monthly_estimate_cents ?? 0);
    if (monthlyEstimateCents < 0) {
      throw new Error("La estimación mensual no puede ser negativa.");
    }
    const revenueTargetDate = input.revenue_target_date !== undefined
      ? input.revenue_target_date
      : (existing?.revenue_target_date ? toIso(existing.revenue_target_date) : null);
    const description = input.description !== undefined ? (input.description ?? "") : (existing?.description ?? "");
    const documents = input.documents !== undefined
      ? normalizeProjectDocuments(input.documents)
      : (Array.isArray(existing?.documents) ? existing.documents : []);
    const requests = input.requests !== undefined
      ? input.requests
      : (Array.isArray(existing?.requests) ? existing.requests : []);
    const prd = input.prd !== undefined ? normalizeProjectPrd(input.prd) : normalizeProjectPrd(existing?.prd);
    const techStack = input.tech_stack !== undefined ? normalizeTechStack(input.tech_stack) : normalizeTechStack(existing?.tech_stack);
    const brief = input.brief !== undefined ? normalizeProjectBrief(input.brief, techStack) : normalizeProjectBrief(existing?.brief, techStack);
    const management = input.management !== undefined ? normalizeProjectManagement(input.management) : normalizeProjectManagement(existing?.management);
    const logoDataUrl = input.logo_data_url !== undefined ? input.logo_data_url : (existing?.logo_data_url ?? "");
    const ownerLogoRows = projectType === "own"
      ? await sql`SELECT logo_data_url FROM companies WHERE id = ${existing?.company_id ?? companyId}`
      : [];
    const effectiveLogoDataUrl = logoDataUrl || String(ownerLogoRows[0]?.logo_data_url ?? "");
    const requestedCustomerId = input.customer_id !== undefined
      ? input.customer_id
      : (existing?.customer_id ?? null);
    const customerId = projectType === "client" ? requestedCustomerId : null;
    if (customerId != null) {
      const customerRows = await sql`
        SELECT id FROM customers
        WHERE id = ${customerId} AND company_id = ${existing?.company_id ?? companyId}
      `;
      if (customerRows.length === 0) {
        throw new Error("Cliente no encontrado en la empresa activa.");
      }
    }

    let projectId: number;
    if (existing) {
      const updated = await sql`
        UPDATE work_projects SET
          name = ${name},
          project_type = ${projectType},
          client_company_id = ${clientCompanyId},
          task_company_id = ${taskCompanyId ?? existing?.company_id ?? companyId},
          description = ${description},
          status = ${status},
          customer_id = ${customerId},
          value_cents = ${valueCents},
          monthly_estimate_cents = ${monthlyEstimateCents},
          revenue_target_date = ${revenueTargetDate},
          documents = ${sql.json(documents as any)},
          requests = ${sql.json(requests as any)},
          prd = ${prd},
          tech_stack = ${sql.json(techStack as any)},
          brief = ${sql.json(brief as any)},
          management = ${sql.json(management as any)},
          logo_data_url = ${effectiveLogoDataUrl},
          start_date = ${startDate},
          target_date = ${targetDate},
          updated_at = NOW()
        WHERE id = ${existing.id} AND company_id = ${existing.company_id}
        RETURNING id
      `;
      projectId = updated[0].id;
    } else {
      const inserted = await sql`
        INSERT INTO work_projects (
          company_id, project_type, client_company_id, task_company_id, customer_id, value_cents, monthly_estimate_cents, revenue_target_date, documents, requests, prd, tech_stack, brief, management, logo_data_url,
          name, description, status, start_date, target_date, created_by
        ) VALUES (
          ${companyId}, ${projectType}, ${clientCompanyId}, ${taskCompanyId ?? companyId}, ${customerId}, ${valueCents}, ${monthlyEstimateCents}, ${revenueTargetDate}, ${sql.json(documents as any)}, ${sql.json(requests as any)}, ${prd}, ${sql.json(techStack as any)}, ${sql.json(brief as any)}, ${sql.json(management as any)}, ${effectiveLogoDataUrl},
          ${name}, ${description}, ${status}, ${startDate}, ${targetDate}, ${user.id}
        )
        RETURNING id
      `;
      projectId = inserted[0].id;
    }

    if (input.revenue_milestones !== undefined) {
      const minimumMonth = new Date().toISOString().slice(0, 7);
      const milestoneMonths = new Set<string>();
      for (const milestone of input.revenue_milestones) {
        if (
          milestone.amount_cents <= 0 ||
          !/^\d{4}-\d{2}$/.test(milestone.target_month) ||
          milestone.target_month < minimumMonth ||
          milestoneMonths.has(milestone.target_month)
        ) {
          throw new Error("Cada hito mensual debe tener un importe y un mes futuro no repetido.");
        }
        milestoneMonths.add(milestone.target_month);
      }
      await sql`
        DELETE FROM work_project_revenue_milestones
        WHERE project_id = ${projectId} AND company_id = ${existing?.company_id ?? companyId}
      `;
      for (const milestone of input.revenue_milestones) {
        await sql`
          INSERT INTO work_project_revenue_milestones (
            company_id, project_id, amount_cents, target_month
          ) VALUES (
            ${existing?.company_id ?? companyId}, ${projectId}, ${milestone.amount_cents}, ${milestone.target_month}
          )
        `;
      }
    }

    const fetched = await sql`
      SELECT * FROM work_projects WHERE id = ${projectId} AND (company_id = ${companyId} OR task_company_id = ${companyId})
    `;
    return (await attachProjectRevenueMilestones([formatWorkProject(fetched[0])], companyId))[0];
  },

  async archiveWorkProject(id: number, token?: string | null): Promise<WorkProject> {
    const user = await requireAdminProjectManagementPg(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);

    const res = await sql`
      UPDATE work_projects
      SET status = 'archived', updated_at = NOW()
      WHERE id = ${id} AND (company_id = ${companyId} OR task_company_id = ${companyId})
      RETURNING id
    `;
    if (res.length === 0) throw new Error("Proyecto no encontrado.");

    const fetched = await sql`
      SELECT * FROM work_projects WHERE id = ${id} AND (company_id = ${companyId} OR task_company_id = ${companyId})
    `;
    return formatWorkProject(fetched[0]);
  },

  async deleteProjectWorkItems(projectId: number, itemIds?: number[], token?: string | null): Promise<number> {
    const user = await requireAdminProjectManagementPg(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);
    const project = await sql`
      SELECT id FROM work_projects
      WHERE id = ${projectId} AND (company_id = ${companyId} OR task_company_id = ${companyId})
    `;
    if (project.length === 0) throw new Error("Proyecto no encontrado.");

    const deleted = itemIds?.length
      ? await sql`
          DELETE FROM work_items
          WHERE project_id = ${projectId}
            AND company_id = (SELECT task_company_id FROM work_projects WHERE id = ${projectId})
            AND (id = ANY(${itemIds}::int[]) OR parent_id = ANY(${itemIds}::int[]))
          RETURNING id
        `
      : await sql`
          DELETE FROM work_items
          WHERE project_id = ${projectId} AND company_id = (SELECT task_company_id FROM work_projects WHERE id = ${projectId})
          RETURNING id
        `;
    return deleted.length;
  },

  async listWorkItems(filters?: WorkItemFilters, token?: string | null): Promise<WorkItem[]> {
    const user = await requireSession(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);
    let workCompanyId = companyId;

    // A portfolio company may own an internal project whose tasks live in the
    // project company's tenant. Resolve that tenant only after confirming the
    // active company is allowed to see the project.
    if (typeof filters?.project_id === "number") {
      const projectRows = await sql`
        SELECT COALESCE(task_company_id, company_id) AS task_company_id
        FROM work_projects
        WHERE id = ${filters.project_id}
          AND (company_id = ${companyId} OR task_company_id = ${companyId})
        LIMIT 1
      `;
      if (projectRows.length === 0) throw new Error("Proyecto no encontrado.");
      workCompanyId = Number(projectRows[0].task_company_id);
    }

    let query = sql`
      SELECT
        wi.*,
        COALESCE(wi.assignee_id, parent.assignee_id) AS effective_assignee_id,
        COALESCE(wi.due_date, parent.due_date) AS effective_due_date,
        wc.name AS category_name,
        wc.normalized_name AS category_normalized_name,
        wc.color AS category_color,
        wc.archived_at AS category_archived_at,
        wc.created_at AS category_created_at,
        wc.updated_at AS category_updated_at,
        u.display_name AS assignee_name,
        u.avatar_data_url AS assignee_avatar_data_url,
        parent.title AS parent_title
      FROM work_items wi
      LEFT JOIN work_categories wc ON wi.category_id = wc.id
      LEFT JOIN work_items parent ON wi.parent_id = parent.id
      LEFT JOIN users u ON COALESCE(wi.assignee_id, parent.assignee_id) = u.id
      WHERE wi.company_id = ${workCompanyId}
    `;

    if (filters) {
      if (filters.status) query = sql`${query} AND wi.status = ${filters.status}`;
      if (filters.type) query = sql`${query} AND wi.type = ${filters.type}`;
      if (filters.priority) query = sql`${query} AND wi.priority = ${filters.priority}`;
      if (filters.category_id !== undefined) {
        if (filters.category_id === null) {
          query = sql`${query} AND wi.category_id IS NULL`;
        } else {
          query = sql`${query} AND wi.category_id = ${filters.category_id}`;
        }
      }
      if (filters.project_id !== undefined) {
        if (filters.project_id === null) {
          query = sql`${query} AND wi.project_id IS NULL`;
        } else if (typeof filters.project_id === "number") {
          query = sql`${query} AND wi.project_id = ${filters.project_id}`;
        }
      }
      if (filters.assignee_id !== undefined) {
        if (filters.assignee_id === null) {
          query = sql`${query} AND COALESCE(wi.assignee_id, parent.assignee_id) IS NULL`;
        } else {
          query = sql`${query} AND COALESCE(wi.assignee_id, parent.assignee_id) = ${filters.assignee_id}`;
        }
      }
      if (filters.text && filters.text.trim()) {
        const pattern = `%${filters.text.trim()}%`;
        query = sql`${query} AND (wi.title ILIKE ${pattern} OR wi.description ILIKE ${pattern})`;
      }
    }

    query = sql`${query} ORDER BY wi.sort_order ASC, wi.created_at DESC`;
    const rows = await query;
    return rows.map(formatWorkItem);
  },

  async upsertWorkItem(input: WorkItemInput, token?: string | null): Promise<WorkItem> {
    const user = await requireSession(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);

    const title = (input.title ?? "").trim();
    if (!title) throw new Error("El título es obligatorio.");
    const truncatedTitle = title.slice(0, 255);

    if (input.assignee_id != null) {
      const members = await this.listWorkMembers(token);
      if (!members.some((m) => m.id === input.assignee_id)) {
        throw new Error("El responsable no pertenece a esta empresa.");
      }
    }

    let categoryId = input.category_id ?? null;
    if (input.category_name && input.category_name.trim() !== "") {
      const catName = input.category_name.trim();
      const normName = catName.toUpperCase();
      const catRows = await sql`
        SELECT id FROM work_categories
        WHERE company_id = ${companyId} AND normalized_name = ${normName}
        LIMIT 1
      `;
      if (catRows.length > 0) {
        categoryId = catRows[0].id;
      } else {
        const newCat = await sql`
          INSERT INTO work_categories (company_id, name, normalized_name, color)
          VALUES (${companyId}, ${catName}, ${normName}, '#6b7280')
          RETURNING id
        `;
        categoryId = newCat[0].id;
      }
    }

    if (categoryId != null) {
      const catCheck = await sql`SELECT id FROM work_categories WHERE id = ${categoryId} AND company_id = ${companyId}`;
      if (catCheck.length === 0) throw new Error("La categoría no pertenece a esta empresa.");
    }

    if (input.project_id != null) {
      const projCheck = await sql`SELECT id, status FROM work_projects WHERE id = ${input.project_id} AND (company_id = ${companyId} OR task_company_id = ${companyId})`;
      if (projCheck.length === 0) throw new Error("El proyecto no pertenece a esta empresa.");
      if (projCheck[0].status === "archived") throw new Error("No se pueden crear ni asignar tareas a un proyecto archivado.");
    }

    let existing: any = null;
    if (input.id != null) {
      const existingRows = await sql`SELECT * FROM work_items WHERE id = ${input.id} AND company_id = ${companyId}`;
      if (existingRows.length === 0) throw new Error("Tarea no encontrada.");
      existing = existingRows[0];
    }

    let parentId = input.parent_id !== undefined ? input.parent_id : (existing?.parent_id ?? null);
    const previousParentId = existing?.parent_id ?? null;
    if (parentId != null) {
      const parentRows = await sql`
        SELECT id, parent_id, project_id, status
        FROM work_items
        WHERE id = ${parentId} AND company_id = ${companyId}
      `;
      if (parentRows.length === 0) throw new Error("La tarea padre no pertenece a esta empresa.");
      const parent = parentRows[0];
      if (parent.id === input.id) throw new Error("Una tarea no puede ser su propia subtarea.");
      if (parent.parent_id != null) throw new Error("Las subtareas no pueden tener otras subtareas.");
      if (parent.status === "archived") throw new Error("No se pueden añadir subtareas a una tarea archivada.");
      if (input.id != null) {
        const childRows = await sql`
          SELECT id FROM work_items
          WHERE parent_id = ${input.id} AND company_id = ${companyId} AND status <> 'archived'
          LIMIT 1
        `;
        if (childRows.length > 0) {
          throw new Error("Una tarea con subtareas no puede convertirse en subtarea.");
        }
      }
      parentId = parent.id;
      input = { ...input, project_id: parent.project_id };
    }

    const targetStatus = input.status ?? existing?.status ?? "inbox";
    if (targetStatus === "done" && existing?.status !== "validation" && existing?.status !== "done") {
      throw new Error("La tarea debe pasar por Validación antes de marcarla como hecha.");
    }
    const sourceType = input.source_type !== undefined ? input.source_type : (existing?.source_type ?? null);
    const sourceKey = input.source_key !== undefined ? input.source_key : (existing?.source_key ?? null);
    const isActive = targetStatus !== "done" && targetStatus !== "archived";

    if (sourceType && sourceKey && isActive) {
      const dupQuery = input.id != null
        ? sql`SELECT id FROM work_items WHERE company_id = ${companyId} AND source_type = ${sourceType} AND source_key = ${sourceKey} AND status NOT IN ('done', 'archived') AND id <> ${input.id} LIMIT 1`
        : sql`SELECT id FROM work_items WHERE company_id = ${companyId} AND source_type = ${sourceType} AND source_key = ${sourceKey} AND status NOT IN ('done', 'archived') LIMIT 1`;
      const activeDup = await dupQuery;
      if (activeDup.length > 0) {
        throw new Error("Ya existe una tarea activa para este origen.");
      }
    }

    let completedAt: Date | null = null;
    if (targetStatus === "done") {
      completedAt = existing && existing.status === "done" && existing.completed_at ? existing.completed_at : new Date();
    } else {
      completedAt = null;
    }

    let itemId: number;
    if (existing) {
      const updated = await sql`
        UPDATE work_items SET
          parent_id = ${parentId},
          category_id = ${categoryId},
          project_id = ${input.project_id !== undefined ? input.project_id : existing.project_id},
          assignee_id = ${input.assignee_id !== undefined ? input.assignee_id : existing.assignee_id},
          title = ${truncatedTitle},
          description = ${input.description !== undefined ? input.description : existing.description},
          type = ${input.type ?? existing.type},
          status = ${targetStatus},
          priority = ${input.priority ?? existing.priority},
          start_date = ${input.start_date !== undefined ? (input.start_date ?? null) : (existing.start_date ?? null)},
          due_date = ${input.due_date !== undefined ? (input.due_date ?? null) : (existing.due_date ?? null)},
          sort_order = ${input.sort_order ?? existing.sort_order ?? 0},
          source_type = ${sourceType ?? null},
          source_key = ${sourceKey ?? null},
          source_href = ${input.source_href !== undefined ? (input.source_href ?? null) : (existing.source_href ?? null)},
          completed_at = ${completedAt ?? null},
          review_messages = ${sql.json((input.review_messages ?? existing.review_messages ?? []) as any)},
          updated_at = NOW()
        WHERE id = ${input.id ?? null} AND company_id = ${companyId}
        RETURNING id
      `;
      itemId = updated[0].id;
    } else {
      const inserted = await sql`
        INSERT INTO work_items (
          company_id, parent_id, category_id, project_id, assignee_id, created_by, title, description,
          type, status, priority, start_date, due_date, sort_order, source_type, source_key,
          source_href, completed_at, review_messages
        ) VALUES (
          ${companyId}, ${parentId}, ${categoryId}, ${input.project_id ?? null}, ${input.assignee_id ?? null},
          ${user.id}, ${truncatedTitle}, ${input.description ?? ""}, ${input.type ?? "task"},
          ${targetStatus}, ${input.priority ?? "normal"}, ${input.start_date ?? null}, ${input.due_date ?? null},
          ${input.sort_order ?? 0}, ${sourceType}, ${sourceKey}, ${input.source_href ?? null}, ${completedAt}, ${sql.json((input.review_messages ?? []) as any)}
        )
        RETURNING id
      `;
      itemId = inserted[0].id;
    }

    const affectedParentIds = Array.from(
      new Set(
        [previousParentId, parentId].filter((id): id is number => id != null),
      ),
    );
    for (const affectedParentId of affectedParentIds) {
      await sql`
        UPDATE work_items parent SET
          status = CASE
            WHEN NOT EXISTS (
              SELECT 1 FROM work_items child
              WHERE child.parent_id = parent.id AND child.status NOT IN ('done', 'archived')
            ) THEN 'done'
            WHEN EXISTS (
              SELECT 1 FROM work_items child
              WHERE child.parent_id = parent.id AND child.status = 'blocked'
            ) THEN 'blocked'
            WHEN EXISTS (
              SELECT 1 FROM work_items child
              WHERE child.parent_id = parent.id AND child.status = 'validation'
            ) THEN 'validation'
            WHEN EXISTS (
              SELECT 1 FROM work_items child
              WHERE child.parent_id = parent.id AND child.status = 'in_progress'
            ) THEN 'in_progress'
            WHEN EXISTS (
              SELECT 1 FROM work_items child
              WHERE child.parent_id = parent.id AND child.status = 'planned'
            ) THEN 'planned'
            ELSE 'inbox'
          END,
          completed_at = CASE
            WHEN NOT EXISTS (
              SELECT 1 FROM work_items child
              WHERE child.parent_id = parent.id AND child.status NOT IN ('done', 'archived')
            ) THEN COALESCE(parent.completed_at, NOW())
            ELSE NULL
          END,
          updated_at = NOW()
        WHERE parent.id = ${affectedParentId} AND parent.company_id = ${companyId}
      `;
    }

    const fetched = await sql`
      SELECT
        wi.*,
        COALESCE(wi.assignee_id, parent.assignee_id) AS effective_assignee_id,
        COALESCE(wi.due_date, parent.due_date) AS effective_due_date,
        wc.name AS category_name,
        wc.normalized_name AS category_normalized_name,
        wc.color AS category_color,
        wc.archived_at AS category_archived_at,
        wc.created_at AS category_created_at,
        wc.updated_at AS category_updated_at,
        u.display_name AS assignee_name,
        u.avatar_data_url AS assignee_avatar_data_url,
        parent.title AS parent_title
      FROM work_items wi
      LEFT JOIN work_categories wc ON wi.category_id = wc.id
      LEFT JOIN work_items parent ON wi.parent_id = parent.id
      LEFT JOIN users u ON COALESCE(wi.assignee_id, parent.assignee_id) = u.id
      WHERE wi.id = ${itemId} AND wi.company_id = ${companyId}
    `;
    return formatWorkItem(fetched[0]);
  },

  async archiveWorkItem(id: number, token?: string | null): Promise<WorkItem> {
    const user = await requireSession(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);
    const res = await sql`
      UPDATE work_items
      SET status = 'archived', completed_at = NULL, updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
      RETURNING id, parent_id
    `;
    if (res.length === 0) throw new Error("Tarea no encontrada.");
    const parentId = res[0].parent_id ?? null;
    if (parentId != null) {
      await sql`
        UPDATE work_items parent SET
          status = CASE
            WHEN NOT EXISTS (
              SELECT 1 FROM work_items child
              WHERE child.parent_id = parent.id AND child.status NOT IN ('done', 'archived')
            ) THEN 'done'
            WHEN EXISTS (
              SELECT 1 FROM work_items child
              WHERE child.parent_id = parent.id AND child.status = 'blocked'
            ) THEN 'blocked'
            WHEN EXISTS (
              SELECT 1 FROM work_items child
              WHERE child.parent_id = parent.id AND child.status = 'validation'
            ) THEN 'validation'
            WHEN EXISTS (
              SELECT 1 FROM work_items child
              WHERE child.parent_id = parent.id AND child.status = 'in_progress'
            ) THEN 'in_progress'
            WHEN EXISTS (
              SELECT 1 FROM work_items child
              WHERE child.parent_id = parent.id AND child.status = 'planned'
            ) THEN 'planned'
            ELSE 'inbox'
          END,
          completed_at = CASE
            WHEN NOT EXISTS (
              SELECT 1 FROM work_items child
              WHERE child.parent_id = parent.id AND child.status NOT IN ('done', 'archived')
            ) THEN COALESCE(parent.completed_at, NOW())
            ELSE NULL
          END,
          updated_at = NOW()
        WHERE parent.id = ${parentId} AND parent.company_id = ${companyId}
      `;
    }

    const fetched = await sql`
      SELECT
        wi.*,
        COALESCE(wi.assignee_id, parent.assignee_id) AS effective_assignee_id,
        COALESCE(wi.due_date, parent.due_date) AS effective_due_date,
        wc.name AS category_name,
        wc.normalized_name AS category_normalized_name,
        wc.color AS category_color,
        wc.archived_at AS category_archived_at,
        wc.created_at AS category_created_at,
        wc.updated_at AS category_updated_at,
        u.display_name AS assignee_name,
        u.avatar_data_url AS assignee_avatar_data_url,
        parent.title AS parent_title
      FROM work_items wi
      LEFT JOIN work_categories wc ON wi.category_id = wc.id
      LEFT JOIN work_items parent ON wi.parent_id = parent.id
      LEFT JOIN users u ON COALESCE(wi.assignee_id, parent.assignee_id) = u.id
      WHERE wi.id = ${id} AND wi.company_id = ${companyId}
    `;
    return formatWorkItem(fetched[0]);
  },

  async listWorkCategories(token?: string | null): Promise<WorkCategory[]> {
    const user = await requireSession(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);
    const rows = await sql`
      SELECT * FROM work_categories
      WHERE company_id = ${companyId} AND archived_at IS NULL
      ORDER BY name ASC
    `;
    return rows.map((r) => ({
      id: r.id,
      company_id: r.company_id,
      name: r.name,
      normalized_name: r.normalized_name,
      color: r.color,
      archived_at: toIso(r.archived_at) || null,
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
    }));
  },

  async renameWorkCategory(id: number, name: string, token?: string | null): Promise<WorkCategory> {
    await requireAdminCategoryManagementPg(token ?? null);
    const user = await requireSession(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);

    const trimmed = (name ?? "").trim();
    if (!trimmed) throw new Error("El nombre de la categoría es obligatorio.");
    const normName = trimmed.toUpperCase();

    const dup = await sql`
      SELECT id FROM work_categories
      WHERE company_id = ${companyId} AND normalized_name = ${normName} AND id <> ${id}
    `;
    if (dup.length > 0) throw new Error("Ya existe una categoría con ese nombre.");

    const updated = await sql`
      UPDATE work_categories
      SET name = ${trimmed}, normalized_name = ${normName}, updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
      RETURNING *
    `;
    if (updated.length === 0) throw new Error("Categoría no encontrada.");

    const r = updated[0];
    return {
      id: r.id,
      company_id: r.company_id,
      name: r.name,
      normalized_name: r.normalized_name,
      color: r.color,
      archived_at: toIso(r.archived_at) || null,
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
    };
  },

  async mergeWorkCategory(sourceId: number, targetId: number, token?: string | null): Promise<WorkCategory> {
    await requireAdminCategoryManagementPg(token ?? null);
    if (sourceId === targetId) {
      throw new Error("La categoría de origen y destino no pueden ser la misma.");
    }
    const user = await requireSession(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);

    const check = await sql`
      SELECT id FROM work_categories
      WHERE id IN (${sourceId}, ${targetId}) AND company_id = ${companyId}
    `;
    if (check.length < 2) throw new Error("Categoría no encontrada.");

    await sql`
      UPDATE work_items
      SET category_id = ${targetId}, updated_at = NOW()
      WHERE company_id = ${companyId} AND category_id = ${sourceId}
    `;
    await sql`
      UPDATE work_categories
      SET archived_at = NOW(), updated_at = NOW()
      WHERE id = ${sourceId} AND company_id = ${companyId}
    `;

    const target = await sql`
      SELECT * FROM work_categories WHERE id = ${targetId} AND company_id = ${companyId}
    `;
    const r = target[0];
    return {
      id: r.id,
      company_id: r.company_id,
      name: r.name,
      normalized_name: r.normalized_name,
      color: r.color,
      archived_at: toIso(r.archived_at) || null,
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
    };
  },

  async archiveWorkCategory(id: number, token?: string | null): Promise<WorkCategory> {
    await requireAdminCategoryManagementPg(token ?? null);
    const user = await requireSession(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);

    const res = await sql`
      UPDATE work_categories
      SET archived_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
      RETURNING *
    `;
    if (res.length === 0) throw new Error("Categoría no encontrada.");

    const r = res[0];
    return {
      id: r.id,
      company_id: r.company_id,
      name: r.name,
      normalized_name: r.normalized_name,
      color: r.color,
      archived_at: toIso(r.archived_at) || null,
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
    };
  },

  async listWorkMembers(token?: string | null): Promise<WorkMember[]> {
    const user = await requireSession(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);
    const rows = await sql`
      SELECT u.id, u.display_name, cm.role
      FROM company_members cm
      JOIN users u ON cm.user_id = u.id
      WHERE cm.company_id = ${companyId} AND u.active = TRUE
      ORDER BY u.id ASC
    `;
    return rows.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      role: r.role,
    }));
  },

  async captureDashboardAlert(input: any, token?: string | null): Promise<WorkItem> {
    const user = await requireSession(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);

    const alertId = String(input?.alertId || input?.alert_id || input?.id || "");
    if (!alertId) throw new Error("ID de alerta obligatorio.");

    const existing = await sql`
      SELECT id FROM work_items
      WHERE company_id = ${companyId}
        AND source_type = 'dashboard_alert'
        AND source_key = ${alertId}
        AND status NOT IN ('done', 'archived')
      LIMIT 1
    `;
    if (existing.length > 0) {
      const fetched = await sql`
        SELECT
          wi.*,
          wc.name AS category_name,
          wc.normalized_name AS category_normalized_name,
          wc.color AS category_color,
          wc.archived_at AS category_archived_at,
          wc.created_at AS category_created_at,
          wc.updated_at AS category_updated_at,
          u.display_name AS assignee_name,
          u.avatar_data_url AS assignee_avatar_data_url
        FROM work_items wi
        LEFT JOIN work_categories wc ON wi.category_id = wc.id
        LEFT JOIN users u ON wi.assignee_id = u.id
        WHERE wi.id = ${existing[0].id} AND wi.company_id = ${companyId}
      `;
      return formatWorkItem(fetched[0]);
    }

    let catName = "General";
    if (alertId === "stock") catName = "Inventario";
    else if (alertId === "backup") catName = "Administración";
    else if (alertId === "no-sales" || alertId === "sales-down") catName = "Ventas";

    const title = input?.title || `Alerta: ${alertId}`;
    const description = input?.detail || input?.description || "";
    const source_href = input?.href || input?.source_href || null;

    return this.upsertWorkItem(
      {
        title,
        description,
        type: "task",
        status: "inbox",
        priority: "high",
        category_name: catName,
        source_type: "dashboard_alert",
        source_key: alertId,
        source_href,
      },
      token
    );
  },

  async upsertWorkCategory(input: { id?: number | null; name: string; color?: string }, token?: string | null): Promise<WorkCategory> {
    await requireAdminCategoryManagementPg(token ?? null);
    const user = await requireSession(token ?? null);
    const companyId = await resolveActiveCompanyId(token ?? null, user.id);

    const trimmed = (input.name ?? "").trim();
    if (!trimmed) throw new Error("El nombre de la categoría es obligatorio.");
    const normName = trimmed.toUpperCase();

    if (input.id) {
      const dup = await sql`
        SELECT id FROM work_categories
        WHERE company_id = ${companyId} AND normalized_name = ${normName} AND id <> ${input.id}
      `;
      if (dup.length > 0) throw new Error("Ya existe una categoría con ese nombre.");

      const updated = await sql`
        UPDATE work_categories
        SET name = ${trimmed}, normalized_name = ${normName}, color = ${input.color || '#3b82f6'}, updated_at = NOW()
        WHERE id = ${input.id} AND company_id = ${companyId}
        RETURNING *
      `;
      if (updated.length === 0) throw new Error("Categoría no encontrada.");
      const r = updated[0];
      return {
        id: r.id,
        company_id: r.company_id,
        name: r.name,
        normalized_name: r.normalized_name,
        color: r.color,
        archived_at: toIso(r.archived_at) || null,
        created_at: toIso(r.created_at),
        updated_at: toIso(r.updated_at),
      };
    }

    const dup = await sql`
      SELECT id FROM work_categories
      WHERE company_id = ${companyId} AND normalized_name = ${normName} AND archived_at IS NULL
    `;
    if (dup.length > 0) throw new Error("Ya existe una categoría con ese nombre.");

    const inserted = await sql`
      INSERT INTO work_categories (company_id, name, normalized_name, color)
      VALUES (${companyId}, ${trimmed}, ${normName}, ${input.color || '#3b82f6'})
      RETURNING *
    `;
    const r = inserted[0];
    return {
      id: r.id,
      company_id: r.company_id,
      name: r.name,
      normalized_name: r.normalized_name,
      color: r.color,
      archived_at: toIso(r.archived_at) || null,
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
    };
  },

  list_work_projects(status_filter?: string, token?: string | null) { return this.listWorkProjects(status_filter, token); },
  get_work_project(reference: number | string, token?: string | null) { return this.getWorkProject(reference, token); },
  upsert_work_project(input: WorkProjectInput, token?: string | null) { return this.upsertWorkProject(input, token); },
  archive_work_project(id: number, token?: string | null) { return this.archiveWorkProject(id, token); },
  delete_project_work_items(projectId: number, itemIds?: number[], token?: string | null) { return this.deleteProjectWorkItems(projectId, itemIds, token); },
  list_work_categories(token?: string | null) { return this.listWorkCategories(token); },
  upsert_work_category(input: any, token?: string | null) { return this.upsertWorkCategory(input, token); },
  merge_work_categories(sourceId: number, targetId: number, token?: string | null) { return this.mergeWorkCategory(sourceId, targetId, token); },
  archive_work_category(id: number, token?: string | null) { return this.archiveWorkCategory(id, token); },
  list_work_members(token?: string | null) { return this.listWorkMembers(token); },
  list_work_items(filters?: WorkItemFilters, token?: string | null) { return this.listWorkItems(filters, token); },
  upsert_work_item(input: WorkItemInput, token?: string | null) { return this.upsertWorkItem(input, token); },
  archive_work_item(id: number, token?: string | null) { return this.archiveWorkItem(id, token); },
  list_expense_documents(token?: string | null) { return this.listExpenseDocuments(token ?? null); },
  upsert_expense_document(input: any, token?: string | null) { return this.upsertExpenseDocument(input, token ?? null); },
  approve_expense_document(id: number, token?: string | null) { return this.approveExpenseDocument(id, token ?? null); },
  list_invoices(token?: string | null) { return this.listInvoices(token ?? null); },
  issue_invoice(input: InvoiceInput, token?: string | null) { return this.issueInvoice(input, token ?? null); },
  cancel_invoice(id: number, token?: string | null) { return this.cancelInvoice(id, token ?? null); },
  list_budgets(token?: string | null) { return this.listBudgets(token ?? null); },
  get_budget(id: number, token?: string | null) { return this.getBudget(id, token ?? null); },
  upsert_budget(input: BudgetInput, token?: string | null) { return this.upsertBudget(input, token ?? null); },
  update_budget_status(id: number, status: BudgetStatus, token?: string | null) { return this.updateBudgetStatus(id, status, token ?? null); },
  convert_budget_to_invoice(id: number, token?: string | null) { return this.convertBudgetToInvoice(id, token ?? null); },
  delete_budget(id: number, token?: string | null) { return this.deleteBudget(id, token ?? null); },
  list_invoice_payments(invoiceId: number, token?: string | null) { return this.listInvoicePayments(invoiceId, token ?? null); },
  add_invoice_payment(input: InvoicePaymentInput, token?: string | null) { return this.addInvoicePayment(input, token ?? null); },
  list_expense_payments(expenseId: number, token?: string | null) { return this.listExpensePayments(expenseId, token ?? null); },
  add_expense_payment(input: ExpensePaymentInput, token?: string | null) { return this.addExpensePayment(input, token ?? null); },
  list_verifactu_records(token?: string | null) { return this.listVerifactuRecords(token ?? null); },
  verify_verifactu_chain(token?: string | null) { return this.verifyVerifactuChain(token ?? null); },
  list_fiscal_profiles(token?: string | null) { return this.listFiscalProfiles(token ?? null); },
  upsert_fiscal_profile(input: any, token?: string | null) { return this.upsertFiscalProfile(input, token ?? null); },
  model303_draft(from: string, to: string, token?: string | null) { return this.model303Draft(from, to, token ?? null); },
  ingest_whatsapp_expense(deviceId: string, payload: any) { return this.ingestWhatsAppExpense(deviceId, payload); },
  process_whatsapp_expense_message(deviceId: string, payload: any) { return this.processWhatsAppExpenseMessage(deviceId, payload); },
  sync_whatsapp_expense(token?: string | null, kind?: ExpenseDocument["kind"]) { return this.syncWhatsAppExpense(token ?? null, kind); },
  capture_dashboard_alert(input: any, token?: string | null) { return this.captureDashboardAlert(input, token); },

  async list_warehouses(token?: string | null): Promise<Warehouse[]> {
    const user = await requireSession(token ?? null);
    if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);
    const rows = await sql`
      SELECT * FROM warehouses
      WHERE company_id = ${cid}
      ORDER BY is_default DESC, name ASC
    `;
    return rows.map((r) => ({
      id: r.id,
      company_id: r.company_id,
      code: r.code,
      name: r.name,
      is_default: !!r.is_default,
      active: !!r.active,
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
    }));
  },

  async list_stock_locations(warehouse_id?: number | null, token?: string | null): Promise<StockLocation[]> {
    const user = await requireSession(token ?? null);
    if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);
    const rows = warehouse_id
      ? await sql`
          SELECT * FROM stock_locations
          WHERE company_id = ${cid} AND warehouse_id = ${warehouse_id}
          ORDER BY is_default DESC, name ASC
        `
      : await sql`
          SELECT * FROM stock_locations
          WHERE company_id = ${cid}
          ORDER BY is_default DESC, name ASC
        `;
    return rows.map((r) => ({
      id: r.id,
      company_id: r.company_id,
      warehouse_id: r.warehouse_id,
      code: r.code,
      name: r.name,
      location_type: r.location_type || "warehouse",
      allow_negative_stock: !!r.allow_negative_stock,
      active: !!r.active,
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
    }));
  },

  async list_stock_balances(
    filters?: { product_id?: number; location_id?: number } | null,
    token?: string | null,
  ): Promise<StockBalance[]> {
    const user = await requireSession(token ?? null);
    if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);

    const productId = filters?.product_id ? Number(filters.product_id) : null;
    const locationId = filters?.location_id ? Number(filters.location_id) : null;

    const rows = await sql`
      SELECT sb.*, sl.name as location_name, sl.warehouse_id
      FROM stock_balances sb
      LEFT JOIN stock_locations sl ON sb.location_id = sl.id
      WHERE sb.company_id = ${cid}
        ${productId ? sql`AND sb.product_id = ${productId}` : sql``}
        ${locationId ? sql`AND sb.location_id = ${locationId}` : sql``}
      ORDER BY sb.product_id ASC, sb.location_id ASC
    `;

    return rows.map((r) => ({
      company_id: r.company_id,
      product_id: r.product_id,
      location_id: r.location_id,
      location_name: r.location_name || "",
      warehouse_id: r.warehouse_id,
      on_hand: r.on_hand ?? 0,
      reserved: r.reserved ?? 0,
      blocked: r.blocked ?? 0,
      incoming: r.incoming ?? 0,
      available: r.available ?? (r.on_hand ?? 0) - (r.reserved ?? 0) - (r.blocked ?? 0),
      updated_at: toIso(r.updated_at),
    }));
  },

  async list_inventory_movements(
    filters?: { product_id?: number; location_id?: number; limit?: number } | null,
    token?: string | null,
  ): Promise<InventoryMovement[]> {
    const user = await requireSession(token ?? null);
    if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);

    const productId = filters?.product_id ? Number(filters.product_id) : null;
    const locationId = filters?.location_id ? Number(filters.location_id) : null;
    const limitVal = filters?.limit && filters.limit > 0 ? Number(filters.limit) : 200;

    const rows = await sql`
      SELECT im.*,
        p.sku as product_sku,
        p.name as product_name,
        fl.name as from_location_name,
        tl.name as to_location_name,
        u.display_name as created_by_name
      FROM inventory_movements im
      LEFT JOIN products p ON im.product_id = p.id
      LEFT JOIN stock_locations fl ON im.from_location_id = fl.id
      LEFT JOIN stock_locations tl ON im.to_location_id = tl.id
      LEFT JOIN users u ON im.actor_id = u.id
      WHERE im.company_id = ${cid}
        ${productId ? sql`AND im.product_id = ${productId}` : sql``}
        ${locationId ? sql`AND (im.from_location_id = ${locationId} OR im.to_location_id = ${locationId})` : sql``}
      ORDER BY im.created_at DESC, im.id DESC
      LIMIT ${limitVal}
    `;

    return rows.map((r) => ({
      id: r.id,
      company_id: r.company_id,
      product_id: r.product_id,
      product_sku: r.product_sku || "",
      product_name: r.product_name || "",
      movement_type: r.movement_type,
      reason: r.reason_code || "",
      quantity: r.qty ?? 0,
      from_location_id: r.from_location_id,
      to_location_id: r.to_location_id,
      from_location_name: r.from_location_name || null,
      to_location_name: r.to_location_name || null,
      unit_cost_cents: r.cost_cents ?? 0,
      reference_type: r.ref_type || null,
      reference_id: r.ref_id,
      reversed_movement_id: r.reversed_movement_id,
      is_reversal: !!r.is_reversal,
      notes: r.notes || null,
      created_by: r.actor_id,
      created_by_name: r.created_by_name || null,
      created_at: toIso(r.created_at),
    }));
  },

  async create_inventory_movement(input: CreateInventoryMovementInput | any, token?: string | null): Promise<InventoryMovement> {
    const user = await requireSession(token ?? null);
    if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);

    const productId = Number(input.product_id);
    if (!productId) throw new Error("product_id es requerido");

    const qty = Number(input.quantity ?? input.qty);
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isFinite(qty)) {
      throw new Error("La cantidad debe ser un número entero mayor que 0");
    }

    const movementType = String(input.movement_type);
    if (!["in", "out", "transfer", "adjustment", "reversal", "initial_stock"].includes(movementType)) {
      throw new Error("Tipo de movimiento de inventario no válido");
    }
    const idempotencyKey = input.idempotency_key ? String(input.idempotency_key) : null;

    return await sql.begin(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx`
          SELECT im.*,
            p.sku as product_sku, p.name as product_name,
            fl.name as from_location_name, tl.name as to_location_name,
            u.display_name as created_by_name
          FROM inventory_movements im
          LEFT JOIN products p ON im.product_id = p.id
          LEFT JOIN stock_locations fl ON im.from_location_id = fl.id
          LEFT JOIN stock_locations tl ON im.to_location_id = tl.id
          LEFT JOIN users u ON im.actor_id = u.id
          WHERE im.company_id = ${cid} AND im.idempotency_key = ${idempotencyKey}
        `;
        if (existing.length > 0) {
          const r = existing[0];
          return {
            id: r.id,
            company_id: r.company_id,
            product_id: r.product_id,
            product_sku: r.product_sku || "",
            product_name: r.product_name || "",
            movement_type: r.movement_type,
            reason: r.reason_code || "",
            quantity: r.qty ?? 0,
            from_location_id: r.from_location_id,
            to_location_id: r.to_location_id,
            from_location_name: r.from_location_name || null,
            to_location_name: r.to_location_name || null,
            unit_cost_cents: r.cost_cents ?? 0,
            reference_type: r.ref_type || null,
            reference_id: r.ref_id,
            reversed_movement_id: r.reversed_movement_id,
            is_reversal: !!r.is_reversal,
            notes: r.notes || null,
            created_by: r.actor_id,
            created_by_name: r.created_by_name || null,
            created_at: toIso(r.created_at),
          };
        }
      }

      const prodRes = await tx`SELECT id, cost_cents FROM products WHERE id = ${productId} AND company_id = ${cid}`;
      if (prodRes.length === 0) throw new Error("Producto no encontrado en la empresa");

      let fromLocationId = input.from_location_id ? Number(input.from_location_id) : null;
      let toLocationId = input.to_location_id ? Number(input.to_location_id) : null;

      if (movementType === "in" || movementType === "initial_stock") {
        if (!toLocationId) {
          const defaultLoc = await tx`SELECT id FROM stock_locations WHERE company_id = ${cid} AND is_default = TRUE LIMIT 1`;
          toLocationId = defaultLoc[0]?.id ?? null;
        }
      } else if (movementType === "out") {
        if (!fromLocationId) {
          const defaultLoc = await tx`SELECT id FROM stock_locations WHERE company_id = ${cid} AND is_default = TRUE LIMIT 1`;
          fromLocationId = defaultLoc[0]?.id ?? null;
        }
      }

      const locationIds = [fromLocationId, toLocationId].filter((value): value is number => value != null);
      if (locationIds.length > 0) {
        const validLocations = await tx`
          SELECT id FROM stock_locations WHERE company_id=${cid} AND id = ANY(${locationIds}::int[])
        `;
        if (validLocations.length !== new Set(locationIds).size) throw new Error("La ubicación no pertenece a la empresa activa");
      }

      const reasonCode = String(input.reason ?? input.reason_code ?? "other");
      const costCents = input.unit_cost_cents != null ? Number(input.unit_cost_cents) : (input.cost_cents != null ? Number(input.cost_cents) : prodRes[0].cost_cents ?? 0);
      const notes = input.notes ? String(input.notes) : "";
      const refType = input.reference_type ?? input.ref_type ?? "";
      const refId = input.reference_id ?? input.ref_id ?? null;
      const isReversal = !!input.is_reversal;
      const reversedMovementId = input.reversed_movement_id ? Number(input.reversed_movement_id) : null;

      const insertedMovements = await tx`
        INSERT INTO inventory_movements (
          company_id, product_id, from_location_id, to_location_id, movement_type, qty, cost_cents,
          effective_at, created_at, actor_id, reason_code, notes, ref_type, ref_id, idempotency_key,
          reversed_movement_id, is_reversal
        ) VALUES (
          ${cid}, ${productId}, ${fromLocationId}, ${toLocationId}, ${movementType}, ${qty}, ${costCents},
          NOW(), NOW(), ${user.id}, ${reasonCode}, ${notes}, ${refType}, ${refId ? Number(refId) : null}, ${idempotencyKey},
          ${reversedMovementId}, ${isReversal}
        )
        RETURNING *
      `;
      const mov = insertedMovements[0];

      if (fromLocationId) {
        await tx`
          INSERT INTO stock_balances (company_id, product_id, location_id, on_hand, reserved, blocked, incoming, available, updated_at)
          VALUES (${cid}, ${productId}, ${fromLocationId}, 0, 0, 0, 0, 0, NOW())
          ON CONFLICT (company_id, product_id, location_id) DO NOTHING
        `;
        const updateFrom = await tx`
          UPDATE stock_balances
          SET on_hand = on_hand - ${qty}, available = available - ${qty}, updated_at = NOW()
          WHERE company_id = ${cid} AND product_id = ${productId} AND location_id = ${fromLocationId}
          RETURNING *
        `;
        const bal = updateFrom[0];

        const locRes = await tx`SELECT allow_negative_stock FROM stock_locations WHERE id = ${fromLocationId}`;
        const allowNeg = input.allow_negative_stock === true || !!locRes[0]?.allow_negative_stock;
        if (!allowNeg && (bal?.available < 0 || bal?.on_hand < 0)) {
          throw new Error(`Stock insuficiente en ubicación origen (disponible: ${bal?.available ?? 0})`);
        }
      }

      if (toLocationId) {
        await tx`
          INSERT INTO stock_balances (company_id, product_id, location_id, on_hand, reserved, blocked, incoming, available, updated_at)
          VALUES (${cid}, ${productId}, ${toLocationId}, ${qty}, 0, 0, 0, ${qty}, NOW())
          ON CONFLICT (company_id, product_id, location_id)
          DO UPDATE SET
            on_hand = stock_balances.on_hand + ${qty},
            available = stock_balances.available + ${qty},
            updated_at = NOW()
          RETURNING *
        `;
      }

      await tx`
        UPDATE products
        SET stock = COALESCE((
          SELECT SUM(on_hand)::int FROM stock_balances WHERE company_id = ${cid} AND product_id = ${productId}
        ), 0),
        updated_at = NOW()
        WHERE id = ${productId} AND company_id = ${cid}
      `;

      const [fromLoc, toLoc, prodInfo] = await Promise.all([
        fromLocationId ? tx`SELECT name FROM stock_locations WHERE id = ${fromLocationId}` : Promise.resolve([]),
        toLocationId ? tx`SELECT name FROM stock_locations WHERE id = ${toLocationId}` : Promise.resolve([]),
        tx`SELECT sku, name FROM products WHERE id = ${productId}`,
      ]);

      return {
        id: mov.id,
        company_id: mov.company_id,
        product_id: mov.product_id,
        product_sku: prodInfo[0]?.sku || "",
        product_name: prodInfo[0]?.name || "",
        movement_type: mov.movement_type,
        reason: mov.reason_code || "",
        quantity: mov.qty ?? 0,
        from_location_id: mov.from_location_id,
        to_location_id: mov.to_location_id,
        from_location_name: fromLoc[0]?.name || null,
        to_location_name: toLoc[0]?.name || null,
        unit_cost_cents: mov.cost_cents ?? 0,
        reference_type: mov.ref_type || null,
        reference_id: mov.ref_id,
        reversed_movement_id: mov.reversed_movement_id,
        is_reversal: !!mov.is_reversal,
        notes: mov.notes || null,
        created_by: mov.actor_id,
        created_by_name: user.display_name,
        created_at: toIso(mov.created_at),
      };
    });
  },

  async reverse_inventory_movement(
    movement_id: number,
    reason?: string,
    token?: string | null,
  ): Promise<InventoryMovement> {
    const user = await requireSession(token ?? null);
    if (!token) throw new Error("Sesión no iniciada");
    const cid = await resolveActiveCompanyId(token, user.id);

    const origRes = await sql`
      SELECT * FROM inventory_movements WHERE id = ${movement_id} AND company_id = ${cid}
    `;
    if (origRes.length === 0) throw new Error("Movimiento de inventario no encontrado");
    const orig = origRes[0];

    if (orig.is_reversal) {
      throw new Error("No se puede anular una reversión de movimiento");
    }

    const existingReversal = await sql`
      SELECT id FROM inventory_movements WHERE company_id = ${cid} AND reversed_movement_id = ${movement_id}
    `;
    if (existingReversal.length > 0) {
      const revMovements = await this.list_inventory_movements({ product_id: orig.product_id, limit: 100 }, token);
      const found = revMovements.find((m) => m.id === existingReversal[0].id);
      if (found) return found;
    }

    const compensatoryFrom = orig.to_location_id;
    const compensatoryTo = orig.from_location_id;

    let compType: string = "reversal";
    if (orig.movement_type === "in") compType = "out";
    else if (orig.movement_type === "out") compType = "in";
    else if (orig.movement_type === "transfer") compType = "transfer";

    const reversalInput = {
      company_id: cid,
      product_id: orig.product_id,
      movement_type: compType,
      quantity: orig.qty,
      from_location_id: compensatoryFrom,
      to_location_id: compensatoryTo,
      unit_cost_cents: orig.cost_cents,
      reason: reason || "movement_reversal",
      notes: `Reversión de movimiento #${orig.id}${orig.notes ? ` (${orig.notes})` : ""}`,
      reference_type: orig.ref_type,
      reference_id: orig.ref_id,
      idempotency_key: `reversal_${orig.id}`,
      reversed_movement_id: orig.id,
      is_reversal: true,
    };

    return await this.create_inventory_movement(reversalInput, token);
  },

  listWarehouses(token?: string | null) { return this.list_warehouses(token); },
  listStockLocations(warehouse_id?: number | null, token?: string | null) { return this.list_stock_locations(warehouse_id, token); },
  listStockBalances(filters?: { product_id?: number; location_id?: number } | null, token?: string | null) { return this.list_stock_balances(filters, token); },
  listInventoryMovements(filters?: { product_id?: number; location_id?: number; limit?: number } | null, token?: string | null) { return this.list_inventory_movements(filters, token); },
  createInventoryMovement(input: any, token?: string | null) { return this.create_inventory_movement(input, token); },
  reverseInventoryMovement(movement_id: number, reason?: string, token?: string | null) { return this.reverse_inventory_movement(movement_id, reason, token); },
};
