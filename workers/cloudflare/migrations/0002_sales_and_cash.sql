CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  number TEXT NOT NULL UNIQUE,
  sold_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subtotal_cents INTEGER NOT NULL,
  vat_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed'
);
CREATE INDEX IF NOT EXISTS sales_company_sold_idx ON sales(company_id, sold_at DESC);

CREATE TABLE IF NOT EXISTS sale_lines (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty INTEGER NOT NULL CHECK(qty > 0),
  returned_qty INTEGER NOT NULL DEFAULT 0 CHECK(returned_qty >= 0),
  unit_price_cents INTEGER NOT NULL,
  vat_rate INTEGER NOT NULL,
  line_base_cents INTEGER NOT NULL,
  line_vat_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sale_lines_sale_idx ON sale_lines(sale_id);

CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('income','expense','adjustment')),
  amount_cents INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'otros',
  description TEXT NOT NULL DEFAULT '',
  sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS cash_company_occurred_idx ON cash_movements(company_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ref_type TEXT,
  ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
