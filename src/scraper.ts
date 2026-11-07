import { chromium } from 'patchright'
import type { Browser, Page } from 'patchright'

export interface ScrapeResult {
  name: string
  price: number | null
  store: string
  inStock: boolean
  screenshot: Buffer
}

export type Store = 'amazon' | 'bestbuy' | 'unknown'

type ScraperError = Error & { screenshot?: Buffer; screenshotError?: Error }

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
      const addToCart = page.locator(selector).first()
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

  // Wait for all loading markers to disappear, which signals that components
  // including AddToCart have fully hydrated.
  // Fall back gracefully if they never disappear (e.g. certain product types).
  try {
    await page.waitForFunction(
      () => {
        return !Array.from(document.querySelectorAll('svg title')).some(
          (title) => title.textContent?.trim() === 'Loading...'
        )
      },
      undefined,
      { timeout: 10000 }
    )
  } catch (error) {
    if ((error as Error).name !== 'TimeoutError') throw error
    console.warn('[Scraper] Best Buy loading indicators did not disappear for %s — proceeding anyway', url)
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

  const button = page.locator('aside div[data-component-name="AddToCart"] button[data-testid]:not([data-testid*="carousel"])').first()
  await button.waitFor({ state: 'attached', timeout: 15000 })

  const buttonText = (await button.textContent())?.toLowerCase().trim()
  const disabled = (await button.getAttribute('disabled')) !== null
  console.log('[Scraper] Best Buy add to cart button is%s and text is: "%s"', disabled ? '' : ' not', buttonText)
  if (!disabled) {
    // I'd rather get a false positive than a false negative here,
    // so we check for known "out of stock" text instead of looking for "in stock" text.
    inStock = ['see details', 'shop open-box', 'sold out', 'unavailable'].every((text) => buttonText !== text)
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

  const browser = await launchBrowser(process.env['HEADLESS']?.toLowerCase() === 'true')

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
