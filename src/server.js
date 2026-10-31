import 'dotenv/config'

import express from 'express'
import rateLimit from 'express-rate-limit'
import path from 'node:path'
import packageJson from '../package.json' with { type: 'json' }
import { fileURLToPath } from 'node:url'
import { createAuth } from './auth.js'
import { closeDb, getDb } from './db.js'
import { scrapeProduct } from './scraper.js'
import { startScheduler, stopScheduler, checkAllPrices } from './scheduler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const version = process.env.APP_VERSION || packageJson.version

const app = express()
const PORT = process.env.PORT || 3000
app.set('trust proxy', 1)
const auth = createAuth({
  username: process.env.AUTH_USERNAME,
  password: process.env.AUTH_PASSWORD,
})
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
	standardHeaders: 'draft-8', // draft-6: `RateLimit-*` headers; draft-7 & draft-8: combined `RateLimit` header
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
	ipv6Subnet: 56, // Set to 60 or 64 to be less aggressive, or 52 or 48 to be more aggressive
})

app.use(limiter)
app.use(express.json())
app.use(express.static(path.join(__dirname, '..', 'public')))

// ─── API Routes ───────────────────────────────────────────────────────────────

// POST log in with the configured account
app.post('/api/login', auth.login)

// GET application version
app.get('/api/version', (req, res) => {
  res.json({ version })
})

app.use('/api', auth.requireAuth)

// POST log out
app.post('/api/logout', auth.logout)

// GET all tracked products
app.get('/api/products', (req, res) => {
  const db = getDb()
  const products = db.prepare(`
    SELECT p.id, p.url, p.name, p.store, p.added_at, p.last_checked,
           p.last_price, p.lowest_price, p.alert_threshold, p.in_stock,
           (p.last_screenshot IS NOT NULL) as has_screenshot,
           COUNT(ph.id) as check_count,
           COUNT(ph.price) as price_check_count,
           SUM(ph.scrape_error) as scrape_error_count,
           MIN(ph.price) as min_price,
           MAX(ph.price) as max_price
    FROM products p
    LEFT JOIN price_history ph ON ph.product_id = p.id
    GROUP BY p.id
    ORDER BY p.added_at DESC
  `).all()
  res.json(products)
})

// POST add a new product
app.post('/api/products', async (req, res) => {
  const { url, alertThreshold } = req.body

  if (!url) {
    return res.status(400).json({ error: 'URL is required' })
  }

  try {
    const db = getDb()

    // Check if already tracked
    const existing = db.prepare('SELECT id FROM products WHERE url = ?').get(url)
    if (existing) {
      return res.status(409).json({ error: 'Product is already being tracked' })
    }

    // Scrape initial data
    console.log(`[Product Add] Scraping: ${url}`)
    const result = await scrapeProduct(url)

    const product = db.transaction(() => {
      const stmt = db.prepare(`
        INSERT INTO products (url, name, store, last_price, lowest_price, alert_threshold, in_stock, last_screenshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const info = stmt.run(
        url,
        result.name,
        result.store,
        result.price,
        result.price,
        alertThreshold || parseFloat(process.env.PRICE_DROP_THRESHOLD || '5'),
        result.inStock ? 1 : 0,
        result.screenshot.toString('base64')
      )

      db.prepare('INSERT INTO price_history (product_id, price, in_stock) VALUES (?, ?, ?)').run(
        info.lastInsertRowid,
        result.price,
        result.inStock ? 1 : 0
      )
      return db.prepare(`
        SELECT id, url, name, store, added_at, last_checked, last_price,
               lowest_price, alert_threshold, in_stock
        FROM products
        WHERE id = ?
      `).get(info.lastInsertRowid)
    })()

    res.status(201).json(product)
  } catch (err) {
    console.error('Add product error:', err)
    res.status(500).json({ error: err.message || 'Failed to add product' })
  }
})

// DELETE remove a product
app.delete('/api/products/:id', (req, res) => {
  const db = getDb()
  const { id } = req.params

  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(id)
  if (!product) return res.status(404).json({ error: 'Product not found' })

  db.prepare('DELETE FROM products WHERE id = ?').run(id)
  res.json({ success: true })
})

// GET the latest screenshot captured for a product
app.get('/api/products/:id/screenshot', (req, res, next) => {
  const db = getDb()
  const { id } = req.params

  const product = db.prepare('SELECT last_screenshot FROM products WHERE id = ?').get(id)
  if (!product) return res.status(404).json({ error: 'Product not found' })

  if (!product.last_screenshot) {
    return res.status(404).json({ error: 'No screenshot available for this product' })
  }

  try {
    res
      .type('png')
      .set('Cache-Control', 'no-store')
      .send(Buffer.from(product.last_screenshot, 'base64'))
  } catch (error) {
    next(error)
  }
})

// GET price history for a product
app.get('/api/products/:id/history', (req, res) => {
  const db = getDb()
  const { id } = req.params

  const history = db.prepare(`
    SELECT price, in_stock, scrape_error, scrape_error_message, checked_at
    FROM price_history
    WHERE product_id = ?
    ORDER BY checked_at ASC
  `).all(id)

  res.json(history)
})

// POST manually trigger a price check
app.post('/api/check', async (req, res) => {
  try {
    res.json({ message: 'Price check started' })
    checkAllPrices()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Start Server ─────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`✅ Price Tracker running at http://localhost:${PORT}`)
  startScheduler()
})

function shutdown(signal) {
  console.log(`[Server] ${signal} received, shutting down...`)
  server.close(async (error) => {
    if (error) {
      console.error('[Server] Failed to close HTTP server:', error)
      process.exitCode = 1
    }

    let shutdownFailed = false
    try {
      await stopScheduler()
    } catch (shutdownError) {
      console.error('[Server] Error during shutdown:', shutdownError)
      process.exitCode = 1
      shutdownFailed = true
    }

    try {
      closeDb()
    } catch (closeError) {
      console.error('[Server] Failed to close database:', closeError)
      process.exitCode = 1
      shutdownFailed = true
    }

    if (!shutdownFailed && !error) {
      console.log('[Server] Shutdown complete.')
    }
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
