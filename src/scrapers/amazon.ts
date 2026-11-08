import { Page } from "patchright"
import { gotoProductPage } from "../scraper.js"
import type { ScrapeResult } from "../scraper.js"

/**
 * Scrape Amazon product price and name
 * @param page The Playwright page object to use for scraping
 * @param url The URL of the Amazon product page to scrape
 * @returns An object containing the product name, price, store name, and stock status (excluding the screenshot)
 */
export async function scrapeAmazon(page: Page, url: string): Promise<Omit<ScrapeResult, 'screenshot'>> {
  await gotoProductPage(1, page, url)

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
