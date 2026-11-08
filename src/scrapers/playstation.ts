import { Page } from "patchright"
import { gotoProductPage } from "../scraper.js"
import type { ScrapeResult } from "../scraper.js"

/**
 * Scrape PlayStation product price and name
 * @param page The Playwright page object to use for scraping
 * @param url The URL of the PlayStation product page to scrape
 * @returns An object containing the product name, price, store name, and stock status (excluding the screenshot)
 */
export async function scrapePlaystation(page: Page, url: string): Promise<Omit<ScrapeResult, 'screenshot'>> {
  await gotoProductPage(1, page, url)

  try {
    await page.locator('div.loader').waitFor({ state: 'hidden', timeout: 15000 })
  } catch (error) {
    if ((error as Error).name !== 'TimeoutError') throw error
    console.warn('[Scraper] PlayStation loader did not disappear for %s — proceeding anyway', url)
  }

  let name = 'Unknown Product'
  let price: number | null = null

  try {
    name = await page.locator('div.productHero-info h1').textContent({ timeout: 5000 }) ?? 'Unknown Product'
    name = name?.trim() || 'Unknown Product'
  } catch {}

  const priceSelectors = [
    'div.productHero-info div.price-text',
  ]
  for (const selector of priceSelectors) {
    try {
      const priceText = await page.locator(selector).first().textContent({ timeout: 3000 })
      if (priceText) {
        const parsed = parseFloat(priceText.replace(/[^0-9.]/g, ''))
        if (!isNaN(parsed) && parsed > 0) {
          price = parsed / 100 // cents are in a different element and just get appended to the text content
          break
        }
      }
    } catch {}
  }

  const button = page.locator('div.productHero-info div.button-placeholder button.add-to-cart').first()
  await button.waitFor({ state: 'attached', timeout: 15000 })
  const inStock = await button.isVisible()

  return { name, price, store: 'PlayStation', inStock }
}
