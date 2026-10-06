const cron = require('node-cron')
const { getDb } = require('./db')
const { scrapeProduct } = require('./scraper')
const { sendPriceDropAlert, sendInStockAlert } = require('./mailer')

const THRESHOLD = parseFloat(process.env.PRICE_DROP_THRESHOLD || '5')

/**
 * Check all tracked products for price changes
 */
async function checkAllPrices() {
  const db = getDb()
  const products = db.prepare('SELECT id, url, last_price, in_stock FROM products').all()

  console.log(`[Scheduler] Checking ${products.length} product(s)...`)

  for (const product of products) {
    try {
      console.log(`[Scheduler] Scraping: ${product.url}`)
      const result = await scrapeProduct(product.url)

      const newPrice = result.price
      const oldPrice = product.last_price

      // Update availability even when the current price cannot be read.
      db.prepare(`
        UPDATE products 
        SET last_price = COALESCE(?, last_price), last_checked = CURRENT_TIMESTAMP, name = ?,
            in_stock = ?,
            last_screenshot = ?,
            lowest_price = CASE
              WHEN ? IS NOT NULL AND (? < lowest_price OR lowest_price IS NULL) THEN ?
              ELSE lowest_price
            END
        WHERE id = ?
      `).run(
        newPrice,
        result.name,
        result.inStock ? 1 : 0,
        result.screenshot.toString('base64'),
        newPrice,
        newPrice,
        newPrice,
        product.id
      )

      // Keep availability checks in history even when no price was available.
      db.prepare('INSERT INTO price_history (product_id, price, in_stock) VALUES (?, ?, ?)').run(
        product.id,
        newPrice,
        result.inStock ? 1 : 0
      )

      // Alert only on an out-of-stock to in-stock transition.
      if (Number(product.in_stock) === 0 && result.inStock) {
        console.log(`[Scheduler] Back in stock: ${result.name}`)
        await sendInStockAlert({
          productName: result.name,
          url: product.url,
          store: result.store,
        })
      }

      // Check for price drop alert
      if (oldPrice && newPrice && newPrice < oldPrice) {
        const percentDrop = ((oldPrice - newPrice) / oldPrice) * 100

        if (percentDrop >= THRESHOLD) {
          console.log(`[Scheduler] Price drop detected! ${oldPrice} → ${newPrice} (${percentDrop.toFixed(1)}%)`)
          await sendPriceDropAlert({
            productName: result.name,
            url: product.url,
            oldPrice,
            newPrice,
            store: result.store,
            percentDrop,
          })
        }
      }

      // Small delay between scrapes
      await new Promise(r => setTimeout(r, 2000))
    } catch (err) {
      console.error(`[Scheduler] Error checking ${product.url}:`, err.message)
    }
  }

  console.log('[Scheduler] Check complete.')
}

/**
 * Start the cron job
 */
function startScheduler() {
  const intervalHours = parseInt(process.env.CHECK_INTERVAL_HOURS || '6')
  const minute = Math.floor(Math.random() * 60) // Random minute to avoid hitting the same time every run
  const cronExpression = `${minute} */${intervalHours} * * *`

  console.log(`[Scheduler] Starting price checks every ${intervalHours} hours (cron: ${cronExpression})`)

  cron.schedule(cronExpression, () => {
    console.log(`[Scheduler] Running scheduled price check at ${new Date().toISOString()}`)
    checkAllPrices().catch(err => console.error('[Scheduler] Error:', err))
  })

  // Run once on startup after a short delay
  setTimeout(() => checkAllPrices(), 5000)
}

module.exports = { startScheduler, checkAllPrices }
