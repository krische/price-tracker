import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const temporaryDirectories = []

after(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-tracker-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function initializeDatabase(databasePath) {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import('./src/db.js').then(({ getDb }) => getDb().close())",
  ], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_PATH: databasePath },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
}

test('creates the database at DB_PATH and initializes the current schema', () => {
  const databasePath = path.join(createTemporaryDirectory(), 'nested', 'tracker.db')

  initializeDatabase(databasePath)

  assert.ok(fs.existsSync(databasePath))
  const db = new Database(databasePath)
  const productColumns = db.pragma('table_info(products)').map((column) => column.name)
  const historyColumns = db.pragma('table_info(price_history)').map((column) => column.name)

  assert.ok(productColumns.includes('last_screenshot'))
  assert.ok(productColumns.includes('in_stock'))
  assert.ok(historyColumns.includes('in_stock'))
  assert.ok(historyColumns.includes('scrape_error'))
  db.close()
})

test('migrates legacy price history while preserving existing rows', () => {
  const databasePath = path.join(createTemporaryDirectory(), 'legacy.db')
  const legacyDb = new Database(databasePath)
  legacyDb.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      name TEXT,
      store TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_checked DATETIME,
      last_price REAL,
      lowest_price REAL,
      alert_threshold REAL DEFAULT 5.0
    );
    CREATE TABLE price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      price REAL NOT NULL,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `)
  legacyDb.prepare('INSERT INTO products (url, name) VALUES (?, ?)').run(
    'https://example.com/product',
    'Existing product',
  )
  legacyDb.prepare('INSERT INTO price_history (product_id, price) VALUES (?, ?)').run(1, 12.5)
  legacyDb.close()

  initializeDatabase(databasePath)

  const db = new Database(databasePath)
  const product = db.prepare('SELECT in_stock, last_screenshot FROM products WHERE id = 1').get()
  const history = db.prepare('SELECT price, in_stock FROM price_history WHERE product_id = 1').get()
  const historyError = db.prepare('SELECT scrape_error FROM price_history WHERE product_id = 1').get()
  const historyPrice = db.pragma('table_info(price_history)').find((column) => column.name === 'price')

  assert.deepEqual(product, { in_stock: 1, last_screenshot: null })
  assert.deepEqual(history, { price: 12.5, in_stock: 1 })
  assert.deepEqual(historyError, { scrape_error: 0 })
  assert.equal(historyPrice.notnull, 0)
  db.close()
})

test('adds scrape error tracking to an existing current history schema', () => {
  const databasePath = path.join(createTemporaryDirectory(), 'current.db')
  const database = new Database(databasePath)
  database.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT UNIQUE NOT NULL);
    CREATE TABLE price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      price REAL,
      in_stock INTEGER NOT NULL DEFAULT 1,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  database.close()

  initializeDatabase(databasePath)

  const migratedDb = new Database(databasePath)
  const historyColumns = migratedDb.pragma('table_info(price_history)').map((column) => column.name)
  assert.ok(historyColumns.includes('scrape_error'))
  migratedDb.close()
})

test('removes price history older than two weeks', () => {
  const databasePath = path.join(createTemporaryDirectory(), 'retention.db')
  const database = new Database(databasePath)
  database.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL
    );
    CREATE TABLE price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      price REAL,
      in_stock INTEGER NOT NULL DEFAULT 1,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  database.prepare('INSERT INTO products (url) VALUES (?)').run('https://example.com/product')
  database.prepare(`
    INSERT INTO price_history (product_id, price, checked_at)
    VALUES (1, ?, datetime('now', '-15 days'))
  `).run(10)
  database.prepare(`
    INSERT INTO price_history (product_id, price, checked_at)
    VALUES (1, ?, datetime('now', '-13 days'))
  `).run(12)
  database.close()

  initializeDatabase(databasePath)

  const retainedDb = new Database(databasePath)
  const retainedHistory = retainedDb.prepare('SELECT price FROM price_history ORDER BY price').all()
  retainedDb.close()

  assert.deepEqual(retainedHistory, [{ price: 12 }])
})
