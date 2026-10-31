import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'prices.db')
/**
 * Progressive history pruning tiers.
 *
 * Rows that represent a change in price, availability, or a scrape error are
 * always kept regardless of age. "Redundant" rows (same price + stock, no
 * error) are thinned out according to these tiers:
 *
 *   0 – 1  day  : keep everything (full resolution)
 *   1 – 7  days : keep at most one row per hour
 *   7 – 30 days : keep at most one row per day
 *  30+    days  : drop all redundant rows
 */
const PRUNE_TIERS = [
  { minDays: 1, maxDays: 7,  granularity: 'hour' },
  { minDays: 7, maxDays: 30, granularity: 'day'  },
  { minDays: 30,             granularity: null    }, // drop all redundant rows
]

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

/**
 * Progressively prune redundant price history rows.
 *
 * A row is considered "important" (never pruned) when any of the following are
 * true:
 *   - scrape_error = 1
 *   - its price differs from the previous row for the same product
 *   - its in_stock value differs from the previous row for the same product
 *
 * All other rows are thinned out per the PRUNE_TIERS defined above.
 */
function prunePriceHistory() {
  db.transaction(() => {
    for (const tier of PRUNE_TIERS) {
      const olderThan = `datetime('now', '-${tier.minDays} days')`
      const newerThan = tier.maxDays !== undefined
        ? `datetime('now', '-${tier.maxDays} days')`
        : null

      // Build the age window condition
      const ageCondition = newerThan
        ? `checked_at < ${olderThan} AND checked_at >= ${newerThan}`
        : `checked_at < ${olderThan}`

      if (tier.granularity === null) {
        // Drop all redundant rows beyond the maximum age
        db.prepare(`
          DELETE FROM price_history
          WHERE ${ageCondition}
            AND scrape_error = 0
            AND id NOT IN (
              SELECT MIN(id)
              FROM price_history
              WHERE ${ageCondition}
                AND scrape_error = 0
              GROUP BY product_id, price, in_stock
            )
        `).run()
      } else {
        // Thin redundant rows to one representative per time bucket.
        // For each (product, bucket) we keep the row with the lowest id;
        // all others in that bucket with the same price+stock and no error
        // are removed.
        const bucketExpr = tier.granularity === 'hour'
          ? `strftime('%Y-%m-%d %H', checked_at)`
          : `strftime('%Y-%m-%d',    checked_at)`

        db.prepare(`
          DELETE FROM price_history
          WHERE ${ageCondition}
            AND scrape_error = 0
            AND id NOT IN (
              -- Always keep the single cheapest-id row per (product, bucket, price, stock)
              SELECT MIN(id)
              FROM price_history
              WHERE ${ageCondition}
                AND scrape_error = 0
              GROUP BY product_id, ${bucketExpr}, price, in_stock
            )
        `).run()
      }
    }
  })()
}

export { getDb, closeDb, prunePriceHistory }
