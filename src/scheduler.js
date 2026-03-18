const cron = require('node-cron')
const { getDb } = require('./db')
const { scrapeProduct } = require('./scraper')
const { sendPriceDropAlert } = require('./mailer')

const THRESHOLD = parseFloat(process.env.PRICE_DROP_THRESHOLD || '5')

/**
 * Check all tracked products for price changes
 */
async function checkAllPrices() {
  const db = getDb()
  const products = db.prepare('SELECT * FROM products').all()

  console.log(`[Scheduler] Checking ${products.length} product(s)...`)

  for (const product of products) {
    try {
      console.log(`[Scheduler] Scraping: ${product.url}`)
      const result = await scrapeProduct(product.url)

      if (!result.price) {
        console.log(`[Scheduler] Could not get price for ${product.url}`)
        continue
      }

      const newPrice = result.price
      const oldPrice = product.last_price

      // Update last checked and price
      db.prepare(`
        UPDATE products 
        SET last_price = ?, last_checked = CURRENT_TIMESTAMP, name = ?,
            lowest_price = CASE WHEN ? < lowest_price OR lowest_price IS NULL THEN ? ELSE lowest_price END
        WHERE id = ?
      `).run(newPrice, result.name, newPrice, newPrice, product.id)

      // Record price history
      db.prepare('INSERT INTO price_history (product_id, price) VALUES (?, ?)').run(
        product.id,
        newPrice
      )

      // Check for price drop alert
      if (oldPrice && newPrice < oldPrice) {
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
  const cronExpression = `0 */${intervalHours} * * *`

  console.log(`[Scheduler] Starting price checks every ${intervalHours} hours (cron: ${cronExpression})`)

  cron.schedule(cronExpression, () => {
    console.log(`[Scheduler] Running scheduled price check at ${new Date().toISOString()}`)
    checkAllPrices().catch(err => console.error('[Scheduler] Error:', err))
  })

  // Run once on startup after a short delay
  setTimeout(() => checkAllPrices(), 5000)
}

module.exports = { startScheduler, checkAllPrices }
