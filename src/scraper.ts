import { chromium } from 'patchright'
import type { Browser, Page } from 'patchright'
import { scrapeAmazon } from './scrapers/amazon.js'
import { scrapeBestBuy } from './scrapers/bestbuy.js'
import { scrapeGameStop } from './scrapers/gamestop.js'
import { scrapePlaystation } from './scrapers/playstation.js'
import { scrapeSamsClub } from './scrapers/samsclub.js'

export interface ScrapeResult {
  name: string
  price: number | null
  store: string
  inStock: boolean
  screenshot: Buffer
}

export type Store = 'amazon' | 'bestbuy' | 'gamestop' | 'playstation' | 'samsclub' | 'unknown'

type ScraperError = Error & { screenshot?: Buffer; screenshotError?: Error }

export interface ScraperSession {
  scrapeProduct(url: string): Promise<ScrapeResult>
  close(): Promise<void>
}

async function launchBrowser(headless: boolean): Promise<Browser> {
  const options = {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-position=-2400,-2400',
    ],
    headless,
  }

  for (let attempt = 1; ; attempt++) {
    try {
      return await chromium.launch(options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const displayUnavailable = message.includes('Missing X server') || message.includes('without having a XServer')
      if (headless || !displayUnavailable || attempt >= 3) throw error

      console.warn(`[Scraper] Headed browser launch failed because no X server is available; retrying (${attempt}/2)`)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}

export async function gotoProductPage(attempts: number, page: Page, url: string): Promise<void> {
  for (let attempt = 1; attempt <= Math.floor(attempts); attempt++) {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20000 })
      await page.waitForFunction(
        () => Boolean(globalThis.document.body?.innerText.trim()),
        undefined,
        { timeout: 5000 }
      )
      break
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        if (attempt === Math.floor(attempts)) {
          throw error
        } else {
          console.warn('[Scraper] Page load failed for %s (attempt %d/%d): %s', url, attempt, Math.floor(attempts), error)
          await new Promise(resolve => setTimeout(resolve, 10000))
          continue
        }
      } else {
        throw error
      }
    }
  }
}

/**
 * Detect which store the URL belongs to
 */
export function detectStore(url: string): Store {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname === 'amazon.com' || hostname.endsWith('.amazon.com')) return 'amazon'
    if (hostname === 'bestbuy.com' || hostname.endsWith('.bestbuy.com')) return 'bestbuy'
    if (hostname === 'gamestop.com' || hostname.endsWith('.gamestop.com')) return 'gamestop'
    if (hostname === 'direct.playstation.com' || hostname.endsWith('.playstation.com')) return 'playstation'
    if (hostname === 'samsclub.com' || hostname.endsWith('.samsclub.com')) return 'samsclub'
  } catch {}
  return 'unknown'
}

/**
 * Scrape a product URL and return { name, price, store }
 */
async function scrapeProductWithBrowser(browser: Browser, url: string): Promise<ScrapeResult> {
  const store = detectStore(url)

  if (store === 'unknown') {
    throw new Error('Only Amazon, Best Buy, GameStop, PlayStation, and Sams Club URLs are supported')
  }

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1200 },
  })
  let page: Page | undefined
  try {
    page = await context.newPage()

    let result: Omit<ScrapeResult, 'screenshot'>
    if (store === 'amazon') {
      result = await scrapeAmazon(page, url)
    } else if (store === 'bestbuy') {
      result = await scrapeBestBuy(page, url)
    } else if (store === 'gamestop') {
      result = await scrapeGameStop(page, url)
    } else if (store === 'playstation') {
      result = await scrapePlaystation(page, url)
    } else {
      result = await scrapeSamsClub(page, url)
    }

    const screenshot = await page.screenshot({ type: 'png' })
    return { ...result, screenshot }
  } catch (error) {
    console.error('[Scraper] Failed to scrape %s product at %s:', store, url, error)
    const scraperError = error as ScraperError
    if (page) {
      try {
        scraperError.screenshot = await page.screenshot({ type: 'png' })
      } catch (screenshotError) {
        scraperError.screenshotError = screenshotError as Error
        console.error('[Scraper] Failed to capture error screenshot for %s:', url, screenshotError)
      }
    }
    throw scraperError
  } finally {
    await context.close()
  }
}

export async function createScraperSession(): Promise<ScraperSession> {
  const browser = await launchBrowser(process.env['HEADLESS']?.toLowerCase() === 'true')

  return {
    scrapeProduct: (url) => {
      if (detectStore(url) === 'unknown') {
        return Promise.reject(new Error('Only Amazon, Best Buy, and PlayStation URLs are supported'))
      }
      return scrapeProductWithBrowser(browser, url)
    },
    close: () => browser.close(),
  }
}

export async function scrapeProduct(url: string): Promise<ScrapeResult> {
  if (detectStore(url) === 'unknown') {
    throw new Error("Only Amazon, Best Buy, GameStop, PlayStation, and Sam's Club URLs are supported")
  }

  const session = await createScraperSession()
  try {
    return await session.scrapeProduct(url)
  } finally {
    await session.close()
  }
}
