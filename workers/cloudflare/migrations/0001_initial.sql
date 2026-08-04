PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  legal_name TEXT NOT NULL,
  trade_name TEXT NOT NULL,
  nif TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'generic',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'cajero')),
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  temp_password_issued_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS company_members (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'cajero',
  PRIMARY KEY (company_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_company_id INTEGER NOT NULL REFERENCES companies(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  vat_rate INTEGER NOT NULL DEFAULT 21,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, sku)
);
CREATE INDEX IF NOT EXISTS products_company_active_idx ON products(company_id, active);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', nif TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS customers_company_idx ON customers(company_id);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

INSERT OR IGNORE INTO companies (id, code, legal_name, trade_name, nif, kind) VALUES (1, 'HEXA', 'Hexa CRM', 'Hexa', '', 'generic');
INSERT OR IGNORE INTO users (id, username, display_name, role, pin_hash) VALUES
  (1, 'admin', 'Administrador', 'admin', 'v1$cf6d6e1a3b1fafe00123456789abcdef$3502d2f9c0b9e219c0762ed848bb0ee015aa6f16c7b6bb41ec8c4a0eef86b19d'),
  (2, 'cajero', 'Cajero', 'cajero', 'v1$a1b2c3d4e5f60718293a4b5c6d7e8f90$d1c73424ffa16fb607f3dbbad5965268a4cc2b380d0e386380024ae752f6f886');
INSERT OR IGNORE INTO company_members(company_id, user_id, role) VALUES (1, 1, 'admin'), (1, 2, 'cajero');
INSERT OR IGNORE INTO settings(key, value) VALUES
  ('shop_name', 'Hexa'), ('ollama_model', ''), ('ollama_url', ''), ('default_vat', '21'), ('idle_timeout_minutes', '15');
