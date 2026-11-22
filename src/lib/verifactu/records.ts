import { sha256HexSync } from "$lib/auth/pin";
import type { FiscalProfile, Invoice, VerifactuMode, VerifactuRecord, VerifactuRecordStatus, VerifactuRecordType } from "$lib/types";

const TEST_QR_BASE = "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR";
const PRODUCTION_QR_BASE = "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR";

export type VerifactuRecordDraft = Omit<VerifactuRecord, "id">;

function dateForAeat(value: string): string {
  const date = value.slice(0, 10);
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}-${month}-${year}` : date;
}

function dateTimeForAeat(value: string): string {
  return value.endsWith("Z") ? `${value.slice(0, -1)}+00:00` : value;
}

function euros(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

function invoiceType(invoice: Invoice): string {
  if (invoice.kind === "rectifying") return "R1";
  return invoice.kind === "simplified" ? "F2" : "F1";
}

function invoiceReference(invoice: Invoice): string {
  return `${invoice.series}-${invoice.number}`.slice(0, 60);
}

export function buildVerifactuQrUrl(input: { mode: Exclude<VerifactuMode, "disabled">; issuerNif: string; invoice: Invoice }): string {
  const url = new URL(input.mode === "test" ? TEST_QR_BASE : PRODUCTION_QR_BASE);
  url.searchParams.set("nif", input.issuerNif.trim().toUpperCase());
  url.searchParams.set("numserie", invoiceReference(input.invoice));
  url.searchParams.set("fecha", dateForAeat(input.invoice.issued_at));
  url.searchParams.set("importe", euros(input.invoice.total_cents));
  return url.toString();
}

export function buildVerifactuHashInput(input: {
  recordType: VerifactuRecordType;
  issuerNif: string;
  invoice: Invoice;
  previousHash: string;
  generatedAt: string;
}): string {
  const fields = input.recordType === "alta"
    ? [
        ["IDEmisorFactura", input.issuerNif],
        ["NumSerieFactura", invoiceReference(input.invoice)],
        ["FechaExpedicionFactura", dateForAeat(input.invoice.issued_at)],
        ["TipoFactura", invoiceType(input.invoice)],
        ["CuotaTotal", euros(input.invoice.vat_cents)],
        ["ImporteTotal", euros(input.invoice.total_cents)],
        ["Huella", input.previousHash],
        ["FechaHoraHusoGenRegistro", dateTimeForAeat(input.generatedAt)],
      ]
    : [
        ["IDEmisorFacturaAnulada", input.issuerNif],
        ["NumSerieFacturaAnulada", invoiceReference(input.invoice)],
        ["FechaExpedicionFacturaAnulada", dateForAeat(input.invoice.issued_at)],
        ["Huella", input.previousHash],
        ["FechaHoraHusoGenRegistro", dateTimeForAeat(input.generatedAt)],
      ];
  return fields.map(([name, value]) => `${name}=${String(value).trim()}`).join("&");
}

export function createVerifactuRecord(input: {
  invoice: Invoice;
  profile: FiscalProfile;
  recordType?: VerifactuRecordType;
  previousHash?: string;
  generatedAt?: string;
  status?: VerifactuRecordStatus;
}): VerifactuRecordDraft | null {
  const mode = input.profile.verifactu_mode ?? "disabled";
  if (mode === "disabled") return null;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const recordType = input.recordType ?? "alta";
  const issuerNif = (input.profile.verifactu_producer_nif || input.invoice.seller_nif || "").trim().toUpperCase();
  if (!issuerNif) throw new Error("Configura el NIF emisor antes de activar VERI*FACTU");
  const previousHash = input.previousHash ?? "";
  const hashInput = buildVerifactuHashInput({ recordType, issuerNif, invoice: input.invoice, previousHash, generatedAt });
  const hash = sha256HexSync(hashInput).toUpperCase();
  const payload = {
    record_type: recordType,
    IDEmisorFactura: issuerNif,
    NumSerieFactura: invoiceReference(input.invoice),
    FechaExpedicionFactura: dateForAeat(input.invoice.issued_at),
    TipoFactura: invoiceType(input.invoice),
    CuotaTotal: euros(input.invoice.vat_cents),
    ImporteTotal: euros(input.invoice.total_cents),
    HuellaAnterior: previousHash,
    FechaHoraHusoGenRegistro: dateTimeForAeat(generatedAt),
    hash_input: hashInput,
    hash,
  };
  return {
    company_id: input.invoice.company_id,
    invoice_id: input.invoice.id,
    record_type: recordType,
    issuer_nif: issuerNif,
    issuer_name: input.profile.verifactu_producer_name || input.invoice.seller_legal_name || "",
    invoice_series: input.invoice.series,
    invoice_number: input.invoice.number,
    invoice_date: input.invoice.issued_at,
    invoice_type: invoiceType(input.invoice),
    vat_cents: input.invoice.vat_cents,
    total_cents: input.invoice.total_cents,
    previous_hash: previousHash,
    hash,
    generated_at: generatedAt,
    mode,
    status: input.status ?? (mode === "test" ? "queued" : "generated"),
    qr_url: buildVerifactuQrUrl({ mode, issuerNif, invoice: input.invoice }),
    payload_json: JSON.stringify(payload),
    error: null,
  };
}

export function verifyVerifactuChain(records: VerifactuRecord[]): { ok: boolean; error?: string } {
  const sorted = [...records].sort((a, b) => a.id - b.id);
  let previousHash = "";
  for (const record of sorted) {
    if (record.previous_hash !== previousHash) return { ok: false, error: `Encadenamiento roto en el registro ${record.id}` };
    let payload: { hash_input?: string };
    try { payload = JSON.parse(record.payload_json) as { hash_input?: string }; } catch { return { ok: false, error: `Contenido inválido en el registro ${record.id}` }; }
    if (!payload.hash_input || sha256HexSync(payload.hash_input).toUpperCase() !== record.hash) return { ok: false, error: `Huella inválida en el registro ${record.id}` };
    previousHash = record.hash;
  }
  return { ok: true };
}

export const verifactuQrBases = { test: TEST_QR_BASE, production: PRODUCTION_QR_BASE } as const;
