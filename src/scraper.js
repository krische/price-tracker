const { chromium } = require('playwright')

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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

  let name = 'Unknown Product'
  let price = null

  try {
    name = await page.locator('#productTitle').textContent({ timeout: 5000 })
    name = name?.trim() || 'Unknown Product'
  } catch {}

  // Try multiple price selectors
  const priceSelectors = [
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

  return { name, price, store: 'Amazon' }
}

/**
 * Scrape Best Buy product price and name
 */
async function scrapeBestBuy(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

  let name = 'Unknown Product'
  let price = null

  try {
    name = await page.locator('.sku-title h1').textContent({ timeout: 5000 })
    name = name?.trim() || 'Unknown Product'
  } catch {}

  const priceSelectors = [
    '.priceView-customer-price span[aria-hidden="true"]',
    '.priceView-hero-price span[aria-hidden="true"]',
    '.pricing-price__regular-price',
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

  return { name, price, store: 'Best Buy' }
}

/**
 * Scrape a product URL and return { name, price, store }
 */
async function scrapeProduct(url) {
  const store = detectStore(url)

  if (store === 'unknown') {
    throw new Error('Only Amazon and Best Buy URLs are supported')
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    })
    const page = await context.newPage()

    let result
    if (store === 'amazon') {
      result = await scrapeAmazon(page, url)
    } else {
      result = await scrapeBestBuy(page, url)
    }

    return result
  } finally {
    await browser.close()
  }
}

module.exports = { scrapeProduct, detectStore }
