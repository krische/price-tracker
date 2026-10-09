const { PlaywrightBlocker } = require('@ghostery/adblocker-playwright')
const { chromium } = require('playwright-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')

chromium.use(StealthPlugin())

let blockerPromise

function getBlocker() {
  if (!blockerPromise) {
    blockerPromise = PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch).catch((error) => {
      blockerPromise = undefined
      throw error
    })
  }

  return blockerPromise
}

/**
 * Detect which store the URL belongs to
 */
function detectStore(url) {
  if (url.includes('amazon.com')) return 'amazon'
  if (url.includes('bestbuy.com')) return 'bestbuy'
  return 'unknown'
}

/**
 * Scrape Amazon product price and name
 */
async function scrapeAmazon(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

  let name = 'Unknown Product'
  let price = null
  let inStock = false

  try {
    name = await page.locator('#productTitle').first().textContent({ timeout: 5000 })
    name = name?.trim() || 'Unknown Product'
  } catch (error) {
    console.error(`Error scraping Amazon product name: ${error.message}`)
  }

  // Try multiple price selectors
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
      const priceLocator = page.locator(selector).first()
      const priceText = await priceLocator.textContent({ timeout: 3000 })
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
async function scrapeBestBuy(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

  let name = 'Unknown Product'
  let price = null
  let inStock = false

  try {
    name = await page.locator('div[data-component-name="ProductHeader"] h1').textContent({ timeout: 5000 })
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
async function scrapeProduct(url) {
  const store = detectStore(url)

  if (store === 'unknown') {
    throw new Error('Only Amazon and Best Buy URLs are supported')
  }

  const blocker = await getBlocker()
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      ...(store === 'bestbuy' ? ['--disable-http2'] : []),
    ],
  })

  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await blocker.enableBlockingInPage(page)

    let result
    if (store === 'amazon') {
      result = await scrapeAmazon(page, url)
    } else {
      result = await scrapeBestBuy(page, url)
    }

    result.screenshot = await page.screenshot({ type: 'png' })
    return result
  } finally {
    await browser.close()
  }
}

module.exports = { scrapeProduct, detectStore }
