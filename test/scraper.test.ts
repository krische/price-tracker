import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectStore, scrapeProduct } from '../src/scraper.js'

test('detects supported store URLs', () => {
  assert.equal(detectStore('https://www.amazon.com/dp/B000000000'), 'amazon')
  assert.equal(detectStore('https://www.bestbuy.com/site/example/123.p'), 'bestbuy')
})

test('returns unknown for unsupported store URLs', () => {
  assert.equal(detectStore('https://example.com/product'), 'unknown')
})

test('rejects unsupported URLs before starting a scrape', async () => {
  await assert.rejects(
    scrapeProduct('https://example.com/product'),
    { message: 'Only Amazon and Best Buy URLs are supported' }
  )
})
