import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'prices.db')
const HISTORY_RETENTION_DAYS = 14

let db

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    initSchema()
    prunePriceHistory()
  }
  return db
}

function closeDb() {
  if (db) {
    db.close()
    db = undefined
  }
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
      scrape_error INTEGER NOT NULL DEFAULT 0,
      scrape_error_message TEXT,
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
          scrape_error INTEGER NOT NULL DEFAULT 0,
          scrape_error_message TEXT,
          checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );
        INSERT INTO price_history (id, product_id, price, in_stock, scrape_error, scrape_error_message, checked_at)
        SELECT id, product_id, price, ${copyStock}, 0, NULL, checked_at
        FROM price_history_legacy;
        DROP TABLE price_history_legacy;
      `)
    })()
  }

  if (!db.pragma('table_info(price_history)').some((column) => column.name === 'scrape_error')) {
    db.exec('ALTER TABLE price_history ADD COLUMN scrape_error INTEGER NOT NULL DEFAULT 0')
  }
  if (!db.pragma('table_info(price_history)').some((column) => column.name === 'scrape_error_message')) {
    db.exec('ALTER TABLE price_history ADD COLUMN scrape_error_message TEXT')
  }
}

function prunePriceHistory() {
  db.prepare(`
    DELETE FROM price_history
    WHERE checked_at < datetime('now', '-${HISTORY_RETENTION_DAYS} days')
  `).run()
}

export { getDb, closeDb, prunePriceHistory }
