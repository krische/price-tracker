import { Page } from "patchright"
import { gotoProductPage } from "../scraper.js"
import type { ScrapeResult } from "../scraper.js"

/**
 * Scrape GameStop product price and name
 * @param page The Playwright page object to use for scraping
 * @param url The URL of the GameStop product page to scrape
 * @returns An object containing the product name, price, store name, and stock status (excluding the screenshot)
 */
export async function scrapeGameStop(page: Page, url: string): Promise<Omit<ScrapeResult, 'screenshot'>> {
  await gotoProductPage(1, page, url)

  let name = 'Unknown Product'
  let price: number | null = null
  let inStock = false

  try {
    name = await page.locator('h2.product-name').textContent({ timeout: 5000 }) ?? 'Unknown Product'
    name = name?.trim() || 'Unknown Product'
  } catch {}

  const priceSelectors = [
    '#primary-details-row span.actual-price',
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

  const buttons = page.locator('#primary-details-row  button.add-to-cart')
  try {
    await buttons.first().waitFor({ state: 'attached', timeout: 5000 })
    const buttonCount = await buttons.count()
    for (let index = 0; index < buttonCount; index++) {
      const button = buttons.nth(index)
      if (await button.isVisible() && (await button.getAttribute('disabled')) === null) {
        inStock = true
        break
      }
    }
  } catch {}

  return { name, price, store: "GameStop", inStock }
}
