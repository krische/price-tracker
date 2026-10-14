import cron from 'node-cron'
import { getDb } from './db.js'
import { scrapeProduct } from './scraper.js'
import { sendPriceDropAlert, sendInStockAlert } from './mailer.js'

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
          screenshot: result.screenshot,
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
            screenshot: result.screenshot,
          })
        }
      }

      // Small delay between scrapes
      await new Promise(r => setTimeout(r, 2000))
    } catch (err) {
      if (err.screenshot) {
        try {
          db.prepare(`
            UPDATE products
            SET last_screenshot = ?, last_checked = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(err.screenshot.toString('base64'), product.id)
        } catch (saveError) {
          console.error(`[Scheduler] Failed to save error screenshot for ${product.url}:`, saveError.message)
        }
      }
      if (err.screenshotError) {
        console.error(`[Scheduler] Failed to capture error screenshot for ${product.url}:`, err.screenshotError.message)
      }
      console.error(`[Scheduler] Error checking ${product.url}:`, err.message)
    }
  }

  console.log('[Scheduler] Check complete.')
}

/**
 * Start the cron job
 */
function startScheduler() {
  const cronExpression = (process.env.CHECK_INTERVAL_EXPRESSION || '').trim() || '0 */6 * * *'
  const configuredIntervalJitter = parseInt(process.env.CHECK_INTERVAL_JITTER || '0')
  const intervalJitter = Number.isNaN(configuredIntervalJitter) || configuredIntervalJitter < 0 ? 0 : configuredIntervalJitter

  console.log(`[Scheduler] Starting price checks with cron expression: ${cronExpression}`)

  cron.schedule(
    cronExpression,
    () => {
      console.log(`[Scheduler] Running scheduled price check at ${new Date().toISOString()}`)
      checkAllPrices().catch(err => console.error('[Scheduler] Error:', err))
    },
    {
      maxRandomDelay: intervalJitter * 1000, // Random jitter in milliseconds
    }
  )

  // Run once on startup after a short delay
  setTimeout(() => checkAllPrices(), 5000)
}

export { startScheduler, checkAllPrices }
