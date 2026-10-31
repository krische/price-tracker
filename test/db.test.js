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
  assert.ok(historyColumns.includes('scrape_error_message'))
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
  const historyError = db.prepare('SELECT scrape_error, scrape_error_message FROM price_history WHERE product_id = 1').get()
  const historyPrice = db.pragma('table_info(price_history)').find((column) => column.name === 'price')

  assert.deepEqual(product, { in_stock: 1, last_screenshot: null })
  assert.deepEqual(history, { price: 12.5, in_stock: 1 })
  assert.deepEqual(historyError, { scrape_error: 0, scrape_error_message: null })
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
  assert.ok(historyColumns.includes('scrape_error_message'))
  migratedDb.close()
})

// ─── Progressive pruning tests ────────────────────────────────────────────────

/**
 * Build a minimal test database with the current schema so we can exercise the
 * pruning logic directly without going through initializeDatabase (which only
 * calls prunePriceHistory on first open).
 */
function createPruningTestDb(databasePath) {
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
      scrape_error INTEGER NOT NULL DEFAULT 0,
      scrape_error_message TEXT,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `)
  database.prepare('INSERT INTO products (url) VALUES (?)').run('https://example.com/product')
  return database
}

function runPruning(databasePath) {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import('./src/db.js').then(({ getDb, prunePriceHistory }) => { getDb(); prunePriceHistory(); }).then(() => process.exit(0))",
  ], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_PATH: databasePath },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
}

test('keeps all rows from the last 24 hours (full resolution tier)', () => {
  const databasePath = path.join(createTemporaryDirectory(), 'tier0.db')
  const database = createPruningTestDb(databasePath)

  // Insert 5 identical rows within the last hour — all should be kept
  for (let i = 0; i < 5; i++) {
    database.prepare(`
      INSERT INTO price_history (product_id, price, in_stock, scrape_error, checked_at)
      VALUES (1, 10.0, 1, 0, datetime('now', '-${i * 10} minutes'))
    `).run()
  }
  database.close()

  runPruning(databasePath)

  const db = new Database(databasePath)
  const count = db.prepare('SELECT COUNT(*) as n FROM price_history').get().n
  db.close()

  assert.equal(count, 5)
})

test('thins redundant rows in the 1–7 day window to one per hour', () => {
  const databasePath = path.join(createTemporaryDirectory(), 'tier1.db')
  const database = createPruningTestDb(databasePath)

  // Insert 3 identical rows in the same UTC hour, 3 days ago → should collapse to 1.
  // Anchor at the start of an hour (e.g. HH:00) so +5m, +10m all stay in the same bucket.
  for (let i = 0; i < 3; i++) {
    database.prepare(`
      INSERT INTO price_history (product_id, price, in_stock, scrape_error, checked_at)
      VALUES (1, 10.0, 1, 0, datetime('now', '-3 days', 'start of day', '+${i * 5} minutes'))
    `).run()
  }
  // Insert a price-change row in the same hour → must be kept (different price)
  database.prepare(`
    INSERT INTO price_history (product_id, price, in_stock, scrape_error, checked_at)
    VALUES (1, 9.0, 1, 0, datetime('now', '-3 days', 'start of day', '+15 minutes'))
  `).run()
  database.close()

  runPruning(databasePath)

  const db = new Database(databasePath)
  const rows = db.prepare('SELECT price FROM price_history ORDER BY id').all()
  db.close()

  // 1 representative of the $10 cluster + 1 for the $9 price change
  assert.equal(rows.length, 2)
  assert.ok(rows.some(r => r.price === 10.0))
  assert.ok(rows.some(r => r.price === 9.0))
})

test('thins redundant rows in the 7–30 day window to one per day', () => {
  const databasePath = path.join(createTemporaryDirectory(), 'tier2.db')
  const database = createPruningTestDb(databasePath)

  // Insert 3 identical rows across the same calendar day, 10 days ago → collapse to 1
  for (let i = 0; i < 3; i++) {
    database.prepare(`
      INSERT INTO price_history (product_id, price, in_stock, scrape_error, checked_at)
      VALUES (1, 20.0, 1, 0, datetime('now', '-10 days', '+${i} hours'))
    `).run()
  }
  // Different price on the same day → kept separately
  database.prepare(`
    INSERT INTO price_history (product_id, price, in_stock, scrape_error, checked_at)
    VALUES (1, 18.0, 1, 0, datetime('now', '-10 days', '+5 hours'))
  `).run()
  database.close()

  runPruning(databasePath)

  const db = new Database(databasePath)
  const rows = db.prepare('SELECT price FROM price_history ORDER BY id').all()
  db.close()

  assert.equal(rows.length, 2)
  assert.ok(rows.some(r => r.price === 20.0))
  assert.ok(rows.some(r => r.price === 18.0))
})

test('drops redundant rows older than 30 days but retains change events', () => {
  const databasePath = path.join(createTemporaryDirectory(), 'tier3.db')
  const database = createPruningTestDb(databasePath)

  // 3 identical redundant rows older than 30 days → all dropped
  for (let i = 0; i < 3; i++) {
    database.prepare(`
      INSERT INTO price_history (product_id, price, in_stock, scrape_error, checked_at)
      VALUES (1, 50.0, 1, 0, datetime('now', '-31 days', '-${i} hours'))
    `).run()
  }
  // A different price at the same age → one representative survives
  database.prepare(`
    INSERT INTO price_history (product_id, price, in_stock, scrape_error, checked_at)
    VALUES (1, 45.0, 1, 0, datetime('now', '-35 days'))
  `).run()
  // A scrape error from 40 days ago → always kept
  database.prepare(`
    INSERT INTO price_history (product_id, price, in_stock, scrape_error, checked_at)
    VALUES (1, NULL, 1, 1, datetime('now', '-40 days'))
  `).run()
  database.close()

  runPruning(databasePath)

  const db = new Database(databasePath)
  const rows = db.prepare('SELECT price, scrape_error FROM price_history ORDER BY id').all()
  db.close()

  // $50 cluster collapses to 1, $45 cluster collapses to 1, scrape error kept
  assert.equal(rows.length, 3)
  assert.ok(rows.some(r => r.price === 50.0))
  assert.ok(rows.some(r => r.price === 45.0))
  assert.ok(rows.some(r => r.scrape_error === 1))
})

test('always retains scrape error rows regardless of age', () => {
  const databasePath = path.join(createTemporaryDirectory(), 'errors.db')
  const database = createPruningTestDb(databasePath)

  // Multiple identical scrape-error rows in every age tier — none should be pruned
  const ages = ['-2 hours', '-3 days', '-10 days', '-45 days']
  for (const age of ages) {
    database.prepare(`
      INSERT INTO price_history (product_id, price, in_stock, scrape_error, checked_at)
      VALUES (1, NULL, 1, 1, datetime('now', '${age}'))
    `).run()
  }
  database.close()

  runPruning(databasePath)

  const db = new Database(databasePath)
  const count = db.prepare('SELECT COUNT(*) as n FROM price_history WHERE scrape_error = 1').get().n
  db.close()

  assert.equal(count, ages.length)
})

test('retains availability-change rows even within the same time bucket', () => {
  const databasePath = path.join(createTemporaryDirectory(), 'availability.db')
  const database = createPruningTestDb(databasePath)

  // In-stock row 3 days ago
  database.prepare(`
    INSERT INTO price_history (product_id, price, in_stock, scrape_error, checked_at)
    VALUES (1, 30.0, 1, 0, datetime('now', '-3 days'))
  `).run()
  // Out-of-stock row in the same hour, 3 days ago
  database.prepare(`
    INSERT INTO price_history (product_id, price, in_stock, scrape_error, checked_at)
    VALUES (1, 30.0, 0, 0, datetime('now', '-3 days', '+15 minutes'))
  `).run()
  database.close()

  runPruning(databasePath)

  const db = new Database(databasePath)
  const rows = db.prepare('SELECT in_stock FROM price_history ORDER BY id').all()
  db.close()

  // Both rows have different in_stock values, so both survive
  assert.equal(rows.length, 2)
  assert.ok(rows.some(r => r.in_stock === 1))
  assert.ok(rows.some(r => r.in_stock === 0))
})
