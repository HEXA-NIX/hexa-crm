import type { ProductInput, PublicationStatus, SalesPolicy, SupplierSourceStatus } from "../types";

export interface ResolvedProductPublication {
  publication_status: PublicationStatus;
  sales_policy: SalesPolicy;
  supplier_source_status: SupplierSourceStatus;
  supplier_last_verified_at: string | null;
  availability_eta: string | null;
}

export function validateProductPublicationInvariants(
  publicationStatus: PublicationStatus,
  salesPolicy: SalesPolicy,
  supplierSourceStatus: SupplierSourceStatus,
  supplierLastVerifiedAt: string | null | undefined,
  availabilityEta: string | null | undefined,
  stock: number,
): { valid: boolean; error?: string } {
  if (publicationStatus === "published") {
    if (salesPolicy === "not_sellable") {
      return { valid: false, error: "No se puede publicar un producto con política comercial 'No vendible'" };
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

  const supplier_last_verified_at = input.supplier_last_verified_at ? String(input.supplier_last_verified_at) : null;
  const availability_eta = input.availability_eta ? String(input.availability_eta) : null;

  return {
    publication_status,
    sales_policy,
    supplier_source_status,
    supplier_last_verified_at,
    availability_eta,
  };
}
