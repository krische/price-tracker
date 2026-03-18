require('dotenv').config()

const express = require('express')
const path = require('path')
const { getDb } = require('./db')
const { scrapeProduct } = require('./scraper')
const { startScheduler } = require('./scheduler')

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, '..', 'public')))

// ─── API Routes ───────────────────────────────────────────────────────────────

// GET all tracked products
app.get('/api/products', (req, res) => {
  const db = getDb()
  const products = db.prepare(`
    SELECT p.*, 
           COUNT(ph.id) as check_count,
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
    const result = await scrapeProduct(url)

    const stmt = db.prepare(`
      INSERT INTO products (url, name, store, last_price, lowest_price, alert_threshold)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const info = stmt.run(
      url,
      result.name,
      result.store,
      result.price,
      result.price,
      alertThreshold || parseFloat(process.env.PRICE_DROP_THRESHOLD || '5')
    )

    if (result.price) {
      db.prepare('INSERT INTO price_history (product_id, price) VALUES (?, ?)').run(
        info.lastInsertRowid,
        result.price
      )
    }

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid)
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

// GET price history for a product
app.get('/api/products/:id/history', (req, res) => {
  const db = getDb()
  const { id } = req.params

  const history = db.prepare(`
    SELECT price, checked_at 
    FROM price_history 
    WHERE product_id = ?
    ORDER BY checked_at ASC
  `).all(id)

  res.json(history)
})

// POST manually trigger a price check
app.post('/api/check', async (req, res) => {
  const { checkAllPrices } = require('./scheduler')
  try {
    res.json({ message: 'Price check started' })
    checkAllPrices()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ Price Tracker running at http://localhost:${PORT}`)
  startScheduler()
})
