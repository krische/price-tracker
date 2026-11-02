import { chromium } from 'patchright'
import type { Page } from 'patchright'

export interface ScrapeResult {
  name: string
  price: number | null
  store: string
  inStock: boolean
  screenshot: Buffer
}

export type Store = 'amazon' | 'bestbuy' | 'unknown'

type ScraperError = Error & { screenshot?: Buffer; screenshotError?: Error }

async function gotoProductPage(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 })

  try {
    await page.waitForFunction(
      () => Boolean(globalThis.document.body?.innerText.trim()),
      undefined,
      { timeout: 5000 }
    )
  } catch (error) {
    if ((error as Error).name !== 'TimeoutError') throw error

    const title = await page.title()
    throw new Error(
      `Page rendered no visible text at ${page.url()} (title: ${title || 'empty'})`,
      { cause: error }
    )
  }
}

/**
 * Detect which store the URL belongs to
 */
function detectStore(url: string): Store {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname === 'amazon.com' || hostname.endsWith('.amazon.com')) return 'amazon'
    if (hostname === 'bestbuy.com' || hostname.endsWith('.bestbuy.com')) return 'bestbuy'
  } catch {}
  return 'unknown'
}

/**
 * Scrape Amazon product price and name
 */
async function scrapeAmazon(page: Page, url: string): Promise<Omit<ScrapeResult, 'screenshot'>> {
  await gotoProductPage(page, url)

  let name = 'Unknown Product'
  let price: number | null = null
  let inStock = false

  try {
    name = await page.locator('#productTitle').first().textContent() ?? 'Unknown Product'
    name = name?.trim() || 'Unknown Product'
  } catch {}

  const priceSelectors = [
    '.a-price.apex-basisprice-value .a-offscreen',
    '.priceToPay .a-price-whole',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.a-price.aok-align-center .a-offscreen',
    '#corePrice_feature_div .a-price-whole',
  ]
  for (const selector of priceSelectors) {
    try {
      const priceText = await page.locator(selector).first().textContent({ timeout: 3000 })
      if (priceText) {
        const parsed = parseFloat(priceText.replace(/[^0-9.]/g, ''))
        if (!isNaN(parsed) && parsed > 0) {
          price = parsed
          break
        }
      }
    } catch {}
  }

  const inStockSelectors = [
    'input#add-to-cart-button',
    'a#add-to-cart-button',
  ]
  for (const selector of inStockSelectors) {
    try {
      const addToCart = await page.locator(selector).first()
      if (await addToCart.count()) {
        inStock = true
        break
      }
    } catch {}
  }

  return { name, price, store: 'Amazon', inStock }
}

/**
 * Scrape Best Buy product price and name
 */
async function scrapeBestBuy(page: Page, url: string): Promise<Omit<ScrapeResult, 'screenshot'>> {
  await gotoProductPage(page, url)

  await page.addStyleTag({
    content: `
      html, body {
        width: 100% !important;
        max-width: 100vw !important;
        overflow-x: hidden !important;
      }
    `,
  })

  // Wait for the dynamic product components to appear, which signals that
  // components including AddToCart have fully hydrated.
  // Fall back gracefully if it never appears (e.g. certain product types).
  try {
    await Promise.all([
      page.waitForSelector('[data-component-name="WarrantySelector"]', { timeout: 10000 }),
      page.waitForSelector('[data-component-name="PriceOfferContainer"]', { timeout: 10000 }),
    ])
  } catch (error) {
    if ((error as Error).name !== 'TimeoutError') throw error
    console.warn('[Scraper] WarrantySelector did not appear for %s — proceeding anyway', url)
  }

  let name = 'Unknown Product'
  let price: number | null = null
  let inStock = false

  try {
    name = await page.locator('div[data-component-name="ProductHeader"] h1').textContent({ timeout: 5000 }) ?? 'Unknown Product'
    name = name?.trim() || 'Unknown Product'
  } catch {}

  const priceSelectors = [
    'div[data-testid="price-block-customer-price"] .sr-only',
  ]
  for (const selector of priceSelectors) {
    try {
      const priceText = await page.locator(selector).first().textContent({ timeout: 3000 })
      if (priceText) {
        const parsed = parseFloat(priceText.replace(/[^0-9.]/g, ''))
        if (!isNaN(parsed) && parsed > 0) {
          price = parsed
          break
        }
      }
    } catch {}
  }

  const inStockSelectors = [
    'div[data-component-name="AddToCart"] button'
  ]
  for (const selector of inStockSelectors) {
    try {
      const button = page.locator(selector).first()
      if (await button.count()) {
        inStock = (await button.getAttribute('disabled')) === null
        break
      }
    } catch {}
  }

  return { name, price, store: 'Best Buy', inStock }
}

/**
 * Scrape a product URL and return { name, price, store }
 */
async function scrapeProduct(url: string): Promise<ScrapeResult> {
  const store = detectStore(url)

  if (store === 'unknown') {
    throw new Error('Only Amazon and Best Buy URLs are supported')
  }

  const browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-position=-2400,-2400',
    ],
    headless: process.env['HEADLESS']?.toLowerCase() === 'true',
  })

  let page: Page | undefined
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1200 },
    })
    page = await context.newPage()

    let result: Omit<ScrapeResult, 'screenshot'>
    if (store === 'amazon') {
      result = await scrapeAmazon(page, url)
    } else {
      result = await scrapeBestBuy(page, url)
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
    await browser.close()
  }
}

export { scrapeProduct, detectStore }
