import { describe, expect, it } from "vitest";
import { sha256HexSync } from "$lib/auth/pin";
import type { FiscalProfile, Invoice, VerifactuRecord } from "$lib/types";
import { createVerifactuRecord, verifyVerifactuChain } from "./records";

const invoice: Invoice = {
  id: 1, company_id: 1, sale_id: null, series: "F", number: "2026-00001", kind: "complete", status: "issued",
  issued_at: "2026-08-06T10:00:00.000Z", operation_date: "2026-08-06", due_at: null,
  seller_legal_name: "Hexa Nix SL", seller_nif: "89890001K", seller_trade_name: "Hexa",
  customer_id: null, customer_name: "Cliente", customer_nif: "", customer_email: "", lines: [],
  base_cents: 11110, vat_cents: 2333, irpf_rate: 0, irpf_cents: 0, total_cents: 13443, paid_cents: 0, payment_status: "pending",
  notes: "", created_by: 1, created_at: "2026-08-06T10:00:00.000Z", updated_at: "2026-08-06T10:00:00.000Z",
};

const profile: FiscalProfile = {
  company_id: 1, regime: "general", period: "quarterly", irpf_enabled: false, default_irpf_rate: 0, sii_enabled: false,
  verifactu_mode: "test", verifactu_producer_nif: "89890001K", verifactu_producer_name: "Hexa Nix SL", updated_at: "",
};

describe("VERI*FACTU records", () => {
  it("matches the AEAT SHA-256 example", () => {
    const input = "IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00";
    expect(sha256HexSync(input).toUpperCase()).toBe("3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60");
  });

  it("encadena altas y anulaciones, y prepara QR de pruebas", () => {
    const first = createVerifactuRecord({ invoice, profile, generatedAt: "2026-08-06T10:00:00+00:00" });
    expect(first?.status).toBe("queued");
    expect(first?.qr_url).toContain("prewww2.aeat.es");
    const records = [{ id: 1, ...first! }] as VerifactuRecord[];
    const cancelled = createVerifactuRecord({ invoice: { ...invoice, status: "cancelled" }, profile, recordType: "anulacion", previousHash: first?.hash, generatedAt: "2026-08-06T10:01:00+00:00" });
    records.push({ id: 2, ...cancelled! });
    expect(verifyVerifactuChain(records)).toEqual({ ok: true });
    records[1].previous_hash = "altered";
    expect(verifyVerifactuChain(records).ok).toBe(false);
  });
});
