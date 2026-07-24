import { describe, expect, it, beforeEach } from "vitest";
import { browserApi } from "./browser-store";
import {
  validateProductPublicationInvariants,
  resolveDefaultsForNewProduct,
} from "../inventory/publication-rules";
import type { ProductInput } from "../types";

describe("Catalog & Supply Chain P0 - Unit & Integration Tests", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  describe("Publication & Policy Invariants Validator", () => {
    it("defaults new products to draft and not_sellable", () => {
      const input: ProductInput = {
        sku: "TEST-001",
        name: "Producto en borrador",
        cost_cents: 1000,
        price_cents: 2000,
        vat_rate: 21,
      };
      const defaults = resolveDefaultsForNewProduct(input);
      expect(defaults.publication_status).toBe("draft");
      expect(defaults.sales_policy).toBe("not_sellable");
      expect(defaults.supplier_source_status).toBe("not_applicable");
    });

    it("defaults dropship products to negotiating source status", () => {
      const input: ProductInput = {
        sku: "TEST-DS-01",
        name: "Producto Dropship",
        cost_cents: 1000,
        price_cents: 2000,
        vat_rate: 21,
        sales_policy: "dropship",
      };
      const defaults = resolveDefaultsForNewProduct(input);
      expect(defaults.publication_status).toBe("draft");
      expect(defaults.sales_policy).toBe("dropship");
      expect(defaults.supplier_source_status).toBe("negotiating");
    });

    it("rejects publishing products with not_sellable policy", () => {
      const res = validateProductPublicationInvariants(
        "published",
        "not_sellable",
        "not_applicable",
        null,
        null,
        10,
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain("No se puede publicar un producto con política comercial 'No vendible'");
    });

    it("rejects publishing own_stock products without stock", () => {
      const res = validateProductPublicationInvariants(
        "published",
        "own_stock",
        "not_applicable",
        null,
        null,
        0,
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain("No se puede publicar un producto de stock propio sin existencias disponibles");
    });

    it("rejects publishing dropship products without approved source or verification date", () => {
      const res1 = validateProductPublicationInvariants(
        "published",
        "dropship",
        "negotiating",
        "2026-07-24",
        null,
        0,
      );
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain("sin proveedor aprobado");

      const res2 = validateProductPublicationInvariants(
        "published",
        "dropship",
        "approved",
        null,
        null,
        0,
      );
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain("sin fecha de verificación");
    });

    it("rejects publishing preorder/make_to_order without availability ETA", () => {
      const res = validateProductPublicationInvariants(
        "published",
        "preorder",
        "not_applicable",
        null,
        null,
        0,
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain("sin ETA de disponibilidad");
    });

    it("rejects publishing products in ordered or in_transit supply status", () => {
      const res1 = validateProductPublicationInvariants(
        "published",
        "own_stock",
        "not_applicable",
        null,
        null,
        10,
        "ordered",
      );
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain("No se puede publicar un producto en estado de abastecimiento 'ordered'");

      const res2 = validateProductPublicationInvariants(
        "published",
        "own_stock",
        "not_applicable",
        null,
        null,
        10,
        "in_transit",
      );
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain("No se puede publicar un producto en estado de abastecimiento 'in_transit'");
    });

    it("accepts publishing when all invariants are satisfied", () => {
      const res = validateProductPublicationInvariants(
        "published",
        "own_stock",
        "not_applicable",
        null,
        null,
        15,
      );
      expect(res.valid).toBe(true);
    });
  });

  describe("Browser Store Integration", () => {
    let token: string;

    beforeEach(async () => {
      const loginRes = await browserApi.login("admin", "1234");
      token = loginRes.token;
    });

    it("creates new product as draft & not_sellable by default", () => {
      const created = browserApi.upsert_product({
        sku: "DRAFT-1",
        name: "Consola de prueba",
        cost_cents: 5000,
        price_cents: 10000,
        vat_rate: 21,
      }, token);

      expect(created.publication_status).toBe("draft");
      expect(created.sales_policy).toBe("not_sellable");
      expect(created.supply_status).toBe("not_applicable");

      // Should not show up in active/published list
      const activeProds = browserApi.list_products(true, token);
      expect(activeProds.some((p) => p.id === created.id)).toBe(false);

      // Should show up in full catalog list
      const allProds = browserApi.list_products(false, token);
      expect(allProds.some((p) => p.id === created.id)).toBe(true);
    });

    it("blocks sales of non-published or non-sellable products", () => {
      const prod = browserApi.upsert_product({
        sku: "UNSELL-1",
        name: "Juego no sellable",
        cost_cents: 500,
        price_cents: 1500,
        vat_rate: 21,
        stock: 5,
      }, token);

      expect(() => {
        browserApi.create_sale([{ product_id: prod.id, qty: 1 }], null, undefined, token);
      }).toThrow(/no está publicado o no es vendible/);
    });

    it("blocks sales and publication for ordered/in_transit products", () => {
      const prod = browserApi.upsert_product({
        sku: "ORDERED-1",
        name: "Producto en tránsito",
        cost_cents: 1000,
        price_cents: 2000,
        vat_rate: 21,
        stock: 10,
        sales_policy: "own_stock",
        supply_status: "in_transit",
      }, token);

      expect(prod.publication_status).toBe("draft");

      // Attempting to force publication should fail
      expect(() => {
        browserApi.upsert_product({
          id: prod.id,
          sku: "ORDERED-1",
          name: "Producto en tránsito",
          cost_cents: 1000,
          price_cents: 2000,
          vat_rate: 21,
          stock: 10,
          publication_status: "published",
          sales_policy: "own_stock",
          supply_status: "in_transit",
        }, token);
      }).toThrow(/No se puede publicar un producto en estado de abastecimiento 'in_transit'/);

      // Attempting sale should be blocked
      expect(() => {
        browserApi.create_sale([{ product_id: prod.id, qty: 1 }], null, undefined, token);
      }).toThrow(/estado de abastecimiento 'in_transit'/);
    });

    it("transitioning to received does NOT automatically publish product", () => {
      const prod = browserApi.upsert_product({
        sku: "RECV-1",
        name: "Producto recibido de proveedor",
        cost_cents: 1500,
        price_cents: 3000,
        vat_rate: 21,
        stock: 50,
        sales_policy: "own_stock",
        supply_status: "ordered",
      }, token);

      expect(prod.publication_status).toBe("draft");

      // Transition supply_status to received
      const updated = browserApi.upsert_product({
        id: prod.id,
        sku: "RECV-1",
        name: "Producto recibido de proveedor",
        cost_cents: 1500,
        price_cents: 3000,
        vat_rate: 21,
        stock: 50,
        sales_policy: "own_stock",
        supply_status: "received",
      }, token);

      // Must remain draft until explicit publication
      expect(updated.publication_status).toBe("draft");
      expect(updated.supply_status).toBe("received");
    });

    it("blocks direct TPV sales for dropship/preorder/make_to_order with explicit error", () => {
      // Create and publish a dropship product
      const prod = browserApi.upsert_product({
        sku: "DROPSHIP-1",
        name: "Edición Coleccionista Dropship",
        cost_cents: 3000,
        price_cents: 6000,
        vat_rate: 21,
        stock: 0,
        publication_status: "published",
        sales_policy: "dropship",
        supplier_source_status: "approved",
        supply_status: "not_applicable",
        supplier_last_verified_at: "2026-07-24",
      }, token);

      expect(() => {
        browserApi.create_sale([{ product_id: prod.id, qty: 1 }], null, undefined, token);
      }).toThrow(/La modalidad 'dropship' para 'Edición Coleccionista Dropship' no admite cobro directo en TPV local/);
    });

    it("allows sale of published own_stock product with available stock", () => {
      const prod = browserApi.upsert_product({
        sku: "OWN-1",
        name: "Mando Inalámbrico",
        cost_cents: 2000,
        price_cents: 4000,
        vat_rate: 21,
        stock: 10,
        publication_status: "published",
        sales_policy: "own_stock",
      }, token);

      const sale = browserApi.create_sale([{ product_id: prod.id, qty: 2 }], null, undefined, token);
      expect(sale.total_cents).toBe(8000);
    });
  });
});
