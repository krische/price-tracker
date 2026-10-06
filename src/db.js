const Database = require('better-sqlite3')
const fs = require('fs')
const path = require('path')

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'prices.db')

let db

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    initSchema()
  }
  return db
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      name TEXT,
      store TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_checked DATETIME,
      last_price REAL,
      lowest_price REAL,
      alert_threshold REAL DEFAULT 5.0,
      in_stock INTEGER NOT NULL DEFAULT 1,
      last_screenshot TEXT
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      price REAL,
      in_stock INTEGER NOT NULL DEFAULT 1,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `)

  const productColumns = db.pragma('table_info(products)')
  if (!productColumns.some((column) => column.name === 'in_stock')) {
    db.exec('ALTER TABLE products ADD COLUMN in_stock INTEGER NOT NULL DEFAULT 1')
  }
  if (!productColumns.some((column) => column.name === 'last_screenshot')) {
    db.exec('ALTER TABLE products ADD COLUMN last_screenshot TEXT')
  }

  const historyColumns = db.pragma('table_info(price_history)')
  const historyPrice = historyColumns.find((column) => column.name === 'price')
  const hasHistoryStock = historyColumns.some((column) => column.name === 'in_stock')

  if (historyPrice.notnull || !hasHistoryStock) {
    const copyStock = hasHistoryStock ? 'COALESCE(in_stock, 1)' : '1'
    db.transaction(() => {
      db.exec(`
        ALTER TABLE price_history RENAME TO price_history_legacy;
        CREATE TABLE price_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          price REAL,
          in_stock INTEGER NOT NULL DEFAULT 1,
          checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );
        INSERT INTO price_history (id, product_id, price, in_stock, checked_at)
        SELECT id, product_id, price, ${copyStock}, checked_at
        FROM price_history_legacy;
        DROP TABLE price_history_legacy;
      `)
    })()
  }
}

module.exports = { getDb }
