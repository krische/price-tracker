import { Page } from "patchright"
import { gotoProductPage } from "../scraper.js"
import type { ScrapeResult } from "../scraper.js"

/**
 * Scrape Best Buy product price and name
 * @param page The Playwright page object to use for scraping
 * @param url The URL of the Best Buy product page to scrape
 * @returns An object containing the product name, price, store name, and stock status (excluding the screenshot)
 */
export async function scrapeBestBuy(page: Page, url: string): Promise<Omit<ScrapeResult, 'screenshot'>> {
  await gotoProductPage(2, page, url)

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
  console.log('[Scraper] Best Buy add to cart button is %s and text is: "%s"', disabled ? 'disabled' : 'enabled', buttonText)
  if (!disabled) {
    // I'd rather get a false positive than a false negative here,
    // so we check for known "out of stock" text instead of looking for "in stock" text.
    inStock = ['see details', 'shop open-box', 'sold out', 'unavailable'].every((text) => buttonText !== text)
  }

  return { name, price, store: 'Best Buy', inStock }
}
