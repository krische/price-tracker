const assert = require('node:assert/strict')
const { test } = require('node:test')
const { detectStore } = require('../src/scraper')

test('detects supported store URLs', () => {
  assert.equal(detectStore('https://www.amazon.com/dp/B000000000'), 'amazon')
  assert.equal(detectStore('https://www.bestbuy.com/site/example/123.p'), 'bestbuy')
})

test('returns unknown for unsupported store URLs', () => {
  assert.equal(detectStore('https://example.com/product'), 'unknown')
})
