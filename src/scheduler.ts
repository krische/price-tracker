import cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { getDb, prunePriceHistory } from './db.js'
import { createScraperSession } from './scraper.js'
import { sendInStockNotification, sendPriceDropNotification } from './notifications.js'

const THRESHOLD = parseFloat(process.env['PRICE_DROP_THRESHOLD'] || '5')
const SCRAPE_ERROR_MESSAGE_LIMIT = 500
const activeChecks: Set<Promise<void>> = new Set()
let scheduledTask: ScheduledTask | undefined
let startupTimeout: ReturnType<typeof setTimeout> | undefined

interface TrackedProduct {
  id: number
  url: string
  last_price: number | null
  in_stock: number
}

type ScraperError = Error & { screenshot?: Buffer; screenshotError?: Error }

/**
 * Check all tracked products for price changes
 */
async function runPriceCheck(): Promise<void> {
  const db = getDb()
  prunePriceHistory()
  const products = db.prepare('SELECT id, url, last_price, in_stock FROM products').all() as TrackedProduct[]

  console.log(`[Scheduler] Checking ${products.length} product(s)...`)

  if (products.length === 0) {
    console.log('[Scheduler] Check complete.')
    return
  }

  const scraper = await createScraperSession()
  try {
    for (const product of products) {
      try {
        console.log(`[Scheduler] Scraping: ${product.url}`)
        const result = await scraper.scrapeProduct(product.url)

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
        db.prepare('INSERT INTO price_history (product_id, price, in_stock, scrape_error) VALUES (?, ?, ?, 0)').run(
          product.id,
          newPrice,
          result.inStock ? 1 : 0
        )

        // Alert only on an out-of-stock to in-stock transition.
        if (Number(product.in_stock) === 0 && result.inStock) {
          console.log(`[Scheduler] Back in stock: ${result.name}`)
          await sendInStockNotification({
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
            await sendPriceDropNotification({
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
        const scraperErr = err as ScraperError
        if (scraperErr.screenshot) {
          try {
            db.prepare(`
            UPDATE products
            SET last_screenshot = ?, last_checked = CURRENT_TIMESTAMP
            WHERE id = ?
            `).run(scraperErr.screenshot.toString('base64'), product.id)
          } catch (saveError) {
            console.error(`[Scheduler] Failed to save error screenshot for ${product.url}:`, (saveError as Error).message)
          }
        }
        if (scraperErr.screenshotError) {
          console.error(`[Scheduler] Failed to capture error screenshot for ${product.url}:`, scraperErr.screenshotError.message)
        }
        console.error(`[Scheduler] Error checking ${product.url}:`, scraperErr.message)
        db.prepare('UPDATE products SET last_checked = CURRENT_TIMESTAMP WHERE id = ?').run(product.id)
        db.prepare(`
        INSERT INTO price_history (product_id, price, in_stock, scrape_error, scrape_error_message)
        VALUES (?, NULL, ?, 1, ?)
        `).run(
          product.id,
          product.in_stock,
          (err instanceof Error ? err.message : String(err)).slice(0, SCRAPE_ERROR_MESSAGE_LIMIT)
        )
      }
    }
  } finally {
    await scraper.close()
  }

  console.log('[Scheduler] Check complete.')
}

function checkAllPrices(): Promise<void> {
  const check = runPriceCheck()
  activeChecks.add(check)
  check.then(
    () => activeChecks.delete(check),
    () => activeChecks.delete(check),
  )
  return check
}

/**
 * Start the cron job
 */
function startScheduler(): void {
  const cronExpression = (process.env['CHECK_INTERVAL_EXPRESSION'] || '').trim() || '0 */6 * * *'
  const configuredIntervalJitter = parseInt(process.env['CHECK_INTERVAL_JITTER'] || '0')
  const intervalJitter = Number.isNaN(configuredIntervalJitter) || configuredIntervalJitter < 0 ? 0 : configuredIntervalJitter

  console.log(`[Scheduler] Starting price checks with cron expression: ${cronExpression}`)

  scheduledTask = cron.schedule(
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
  startupTimeout = setTimeout(() => checkAllPrices(), 5000)
}

async function stopScheduler(): Promise<void> {
  scheduledTask?.stop()
  scheduledTask = undefined
  clearTimeout(startupTimeout)
  startupTimeout = undefined
  const results = await Promise.allSettled(activeChecks)
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => (result as PromiseRejectedResult).reason)

  if (failures.length > 0) {
    throw new AggregateError(failures, 'One or more price checks failed during shutdown')
  }
}

export { startScheduler, stopScheduler, checkAllPrices }
