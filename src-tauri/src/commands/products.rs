use crate::commands::auth::require_session;
use crate::db::{now_iso, valid_vat, Db};
use crate::models::{Product, ProductInput};
use rusqlite::params;
use tauri::State;

const PRODUCT_COLS: &str = "id, sku, name, description, COALESCE(category,''), stock, min_stock, cost_cents, price_cents, vat_rate, COALESCE(supplier_name,''), COALESCE(supplier_contact,''), COALESCE(supplier_email,''), COALESCE(supplier_phone,''), COALESCE(fulfillment_mode,'own_stock'), COALESCE(stock_location,'Almacén principal'), COALESCE(condition_code,'used'), COALESCE(publication_status,'published'), COALESCE(sales_policy,'own_stock'), COALESCE(supplier_source_status,'not_applicable'), supplier_last_verified_at, availability_eta, active, created_at, updated_at";

fn map_product(row: &rusqlite::Row<'_>) -> rusqlite::Result<Product> {
    Ok(Product {
        id: row.get(0)?,
        sku: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        category: row.get(4)?,
        stock: row.get(5)?,
        min_stock: row.get(6)?,
        cost_cents: row.get(7)?,
        price_cents: row.get(8)?,
        vat_rate: row.get(9)?,
        supplier_name: row.get(10)?,
        supplier_contact: row.get(11)?,
        supplier_email: row.get(12)?,
        supplier_phone: row.get(13)?,
        fulfillment_mode: row.get(14)?,
        stock_location: row.get(15)?,
        condition_code: row.get(16)?,
        publication_status: row.get(17)?,
        sales_policy: row.get(18)?,
        supplier_source_status: row.get(19)?,
        supplier_last_verified_at: row.get(20)?,
        availability_eta: row.get(21)?,
        active: row.get::<_, i64>(22)? == 1,
        created_at: row.get(23)?,
        updated_at: row.get(24)?,
    })
}

#[tauri::command]
pub fn list_products(
    db: State<'_, Db>,
    active_only: Option<bool>,
    token: Option<String>,
) -> Result<Vec<Product>, String> {
    let conn = db.lock();
    require_session(&conn, &token)?;
    let only = active_only.unwrap_or(true);
    let sql = if only {
        format!("SELECT {PRODUCT_COLS} FROM products WHERE active = 1 AND COALESCE(publication_status, 'published') = 'published' AND COALESCE(sales_policy, 'own_stock') != 'not_sellable' ORDER BY name COLLATE NOCASE")
    } else {
        format!("SELECT {PRODUCT_COLS} FROM products ORDER BY name COLLATE NOCASE")
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_product)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn upsert_product(
    db: State<'_, Db>,
    input: ProductInput,
    token: Option<String>,
) -> Result<Product, String> {
    if !valid_vat(input.vat_rate) {
        return Err("Tipo de IVA no válido".into());
    }
    let conn = db.lock();
    require_session(&conn, &token)?;
    let now = now_iso();
    let desc = input.description.unwrap_or_default();
    let category = input.category.unwrap_or_default();
    let supplier_name = input.supplier_name.unwrap_or_default();
    let supplier_contact = input.supplier_contact.unwrap_or_default();
    let supplier_email = input.supplier_email.unwrap_or_default();
    let supplier_phone = input.supplier_phone.unwrap_or_default();
    let fulfillment_mode = input.fulfillment_mode.unwrap_or_else(|| "own_stock".into());
    let stock_location = input.stock_location.unwrap_or_else(|| "Almacén principal".into());
    let condition_code = input.condition_code.unwrap_or_else(|| "used".into());
    let active = input.active.unwrap_or(true) as i64;

    let is_update = input.id.is_some();
    let (prev_pub, prev_pol, prev_src, prev_ver, prev_eta, prev_stock) = if let Some(id) = input.id {
        let row: Result<(String, String, String, Option<String>, Option<String>, i64), _> = conn.query_row(
            "SELECT COALESCE(publication_status, 'published'), COALESCE(sales_policy, 'own_stock'), COALESCE(supplier_source_status, 'not_applicable'), supplier_last_verified_at, availability_eta, stock FROM products WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        );
        match row {
            Ok(tuple) => (Some(tuple.0), Some(tuple.1), Some(tuple.2), tuple.3, tuple.4, tuple.5),
            Err(_) => return Err("Producto no encontrado".into()),
        }
    } else {
        (None, None, None, None, None, 0)
    };

    let pub_status = input.publication_status.or(prev_pub).unwrap_or_else(|| if is_update { "published".into() } else { "draft".into() });
    let sales_policy = input.sales_policy.or(prev_pol).unwrap_or_else(|| if is_update { "own_stock".into() } else { "not_sellable".into() });
    let supplier_source_status = input.supplier_source_status.or(prev_src).unwrap_or_else(|| if sales_policy == "dropship" { "negotiating".into() } else { "not_applicable".into() });
    let supplier_last_verified_at = input.supplier_last_verified_at.or(prev_ver);
    let availability_eta = input.availability_eta.or(prev_eta);
    let stock = input.stock.unwrap_or(if is_update { prev_stock } else { 0 });

    if pub_status == "published" {
        if sales_policy == "not_sellable" {
            return Err("No se puede publicar un producto con política comercial 'No vendible'".into());
        }
        if sales_policy == "own_stock" && stock <= 0 {
            return Err("No se puede publicar un producto de stock propio sin existencias disponibles".into());
        }
        if sales_policy == "dropship" {
            if supplier_source_status != "approved" {
                return Err("No se puede publicar un producto dropshipping sin proveedor aprobado".into());
            }
            if supplier_last_verified_at.as_deref().unwrap_or("").trim().is_empty() {
                return Err("No se puede publicar un producto dropshipping sin fecha de verificación del proveedor".into());
            }
        }
        if sales_policy == "preorder" || sales_policy == "make_to_order" {
            if availability_eta.as_deref().unwrap_or("").trim().is_empty() {
                return Err("No se puede publicar un producto en preventa/bajo pedido sin ETA de disponibilidad".into());
            }
        }
    }

    if let Some(id) = input.id {
        conn.execute(
            "UPDATE products SET sku=?1, name=?2, description=?3, category=?4, stock=COALESCE(?5, stock), min_stock=COALESCE(?6, min_stock),
             cost_cents=?7, price_cents=?8, vat_rate=?9, supplier_name=?10, supplier_contact=?11, supplier_email=?12, supplier_phone=?13, fulfillment_mode=?14, stock_location=?15, condition_code=?16, publication_status=?17, sales_policy=?18, supplier_source_status=?19, supplier_last_verified_at=?20, availability_eta=?21, active=?22, updated_at=?23 WHERE id=?24",
            params![
                input.sku,
                input.name,
                desc,
                category,
                input.stock,
                input.min_stock,
                input.cost_cents,
                input.price_cents,
                input.vat_rate,
                supplier_name,
                supplier_contact,
                supplier_email,
                supplier_phone,
                fulfillment_mode,
                stock_location,
                condition_code,
                pub_status,
                sales_policy,
                supplier_source_status,
                supplier_last_verified_at,
                availability_eta,
                active,
                now,
                id
            ],
        )
        .map_err(|e| e.to_string())?;
        conn.query_row(
            &format!("SELECT {PRODUCT_COLS} FROM products WHERE id=?1"),
            params![id],
            map_product,
        )
        .map_err(|e| e.to_string())
    } else {
        conn.execute(
            "INSERT INTO products (sku, name, description, category, stock, min_stock, cost_cents, price_cents, vat_rate, supplier_name, supplier_contact, supplier_email, supplier_phone, fulfillment_mode, stock_location, condition_code, publication_status, sales_policy, supplier_source_status, supplier_last_verified_at, availability_eta, active, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?23)",
            params![
                input.sku,
                input.name,
                desc,
                category,
                stock,
                input.min_stock.unwrap_or(0),
                input.cost_cents,
                input.price_cents,
                input.vat_rate,
                supplier_name,
                supplier_contact,
                supplier_email,
                supplier_phone,
                fulfillment_mode,
                stock_location,
                condition_code,
                pub_status,
                sales_policy,
                supplier_source_status,
                supplier_last_verified_at,
                availability_eta,
                active,
                now
            ],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            &format!("SELECT {PRODUCT_COLS} FROM products WHERE id=?1"),
            params![id],
            map_product,
        )
        .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn adjust_stock(
    db: State<'_, Db>,
    product_id: i64,
    delta: i64,
    reason: String,
    token: Option<String>,
) -> Result<Product, String> {
    let conn = db.lock();
    require_session(&conn, &token)?;
    let now = now_iso();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE products SET stock = stock + ?1, updated_at = ?2 WHERE id = ?3",
        params![delta, now, product_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO stock_movements (product_id, delta, reason, created_at) VALUES (?1,?2,?3,?4)",
        params![product_id, delta, reason, now],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    conn.query_row(
        &format!("SELECT {PRODUCT_COLS} FROM products WHERE id=?1"),
        params![product_id],
        map_product,
    )
    .map_err(|e| e.to_string())
}
