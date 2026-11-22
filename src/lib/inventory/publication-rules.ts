import type { ProductInput, PublicationStatus, SalesPolicy, SupplierSourceStatus, SupplyStatus } from "../types";
import { isVatRate } from "../vat";

export interface ResolvedProductPublication {
  publication_status: PublicationStatus;
  sales_policy: SalesPolicy;
  supplier_source_status: SupplierSourceStatus;
  supply_status: SupplyStatus;
  supplier_last_verified_at: string | null;
  availability_eta: string | null;
}

/** Validate the numeric and identity fields before writing a catalogue item.
 * The database columns are integers, but older schemas did not have CHECKs;
 * keeping this at the API boundary prevents negative cents/stock and NaN
 * values from reaching either PostgreSQL or the browser store. */
export function validateProductFields(input: ProductInput, existing?: { stock?: number; min_stock?: number }): { valid: boolean; error?: string } {
  const sku = String(input.sku ?? "").trim();
  const name = String(input.name ?? "").trim();
  if (!sku) return { valid: false, error: "El SKU es obligatorio" };
  if (!name) return { valid: false, error: "El nombre del producto es obligatorio" };

  const values: Array<[string, unknown, number]> = [
    ["coste", input.cost_cents, 0],
    ["precio", input.price_cents, 0],
    ["stock", input.stock ?? existing?.stock ?? 0, 0],
    ["stock mínimo", input.min_stock ?? existing?.min_stock ?? 0, 0],
  ];
  for (const [label, raw, minimum] of values) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum) {
      return { valid: false, error: `El ${label} debe ser un número entero igual o mayor que ${minimum}` };
    }
  }
  if (!isVatRate(Number(input.vat_rate))) {
    return { valid: false, error: "El IVA debe ser 0%, 4%, 10% o 21%" };
  }
  return { valid: true };
}

export function validateProductPublicationInvariants(
  publicationStatus: PublicationStatus,
  salesPolicy: SalesPolicy,
  supplierSourceStatus: SupplierSourceStatus,
  supplierLastVerifiedAt: string | null | undefined,
  availabilityEta: string | null | undefined,
  stock: number,
  supplyStatus?: SupplyStatus,
): { valid: boolean; error?: string } {
  if (publicationStatus === "published") {
    if (salesPolicy === "not_sellable") {
      return { valid: false, error: "No se puede publicar un producto con política comercial 'No vendible'" };
    }
    const currentSupplyStatus = supplyStatus ?? "not_applicable";
    if (["ordered", "in_transit", "negotiating", "quality_hold"].includes(currentSupplyStatus)) {
      return { valid: false, error: `No se puede publicar un producto en estado de abastecimiento '${currentSupplyStatus}'` };
    }
    if (salesPolicy === "own_stock") {
      if (stock <= 0) {
        return { valid: false, error: "No se puede publicar un producto de stock propio sin existencias disponibles" };
      }
    }
    if (salesPolicy === "dropship") {
      if (supplierSourceStatus !== "approved") {
        return { valid: false, error: "No se puede publicar un producto dropshipping sin proveedor aprobado" };
      }
      if (!supplierLastVerifiedAt || supplierLastVerifiedAt.trim() === "") {
        return { valid: false, error: "No se puede publicar un producto dropshipping sin fecha de verificación del proveedor" };
      }
    }
    if (salesPolicy === "preorder" || salesPolicy === "make_to_order") {
      if (!availabilityEta || availabilityEta.trim() === "") {
        return { valid: false, error: "No se puede publicar un producto en preventa/bajo pedido sin ETA de disponibilidad" };
      }
    }
  }
  return { valid: true };
}

export function resolveDefaultsForNewProduct(input: ProductInput): ResolvedProductPublication {
  const publication_status: PublicationStatus = input.publication_status ?? "draft";
  const sales_policy: SalesPolicy = input.sales_policy ?? "not_sellable";

  let supplier_source_status: SupplierSourceStatus = input.supplier_source_status ?? "not_applicable";
  if (sales_policy === "dropship" && !input.supplier_source_status) {
    supplier_source_status = "negotiating";
  }

  let supply_status: SupplyStatus = input.supply_status ?? "not_applicable";
  if (sales_policy === "dropship" && !input.supply_status) {
    supply_status = "negotiating";
  }

  const supplier_last_verified_at = input.supplier_last_verified_at ? String(input.supplier_last_verified_at) : null;
  const availability_eta = input.availability_eta ? String(input.availability_eta) : null;

  return {
    publication_status,
    sales_policy,
    supplier_source_status,
    supply_status,
    supplier_last_verified_at,
    availability_eta,
  };
}
