import { Page } from "patchright"
import { gotoProductPage } from "../scraper.js"
import type { ScrapeResult } from "../scraper.js"

/**
 * Scrape Sams Club product price and name
 * @param page The Playwright page object to use for scraping
 * @param url The URL of the Sams Club product page to scrape
 * @returns An object containing the product name, price, store name, and stock status (excluding the screenshot)
 */
export async function scrapeSamsClub(page: Page, url: string): Promise<Omit<ScrapeResult, 'screenshot'>> {
  await gotoProductPage(1, page, url)

  let name = 'Unknown Product'
  let price: number | null = null
  let inStock = false

  try {
    name = await page.locator('#main-title').textContent({ timeout: 5000 }) ?? 'Unknown Product'
    name = name?.trim() || 'Unknown Product'
  } catch {}

  const priceSelectors = [
    'span[data-seo-id="hero-price"]',
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

  const button = page.locator('div[data-seo-id="add-to-cart-section"] button[data-dca-verb="addToCart"]').first()
  try {
    await button.waitFor({ state: 'attached', timeout: 5000 })
    inStock = await button.isVisible()
  } catch {}

  return { name, price, store: "Sam's Club", inStock }
}
