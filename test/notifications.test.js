import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sendInStockNotification, sendPriceDropNotification } from '../src/notifications.js'

const notificationVariables = ['ALERT_EMAIL', 'EMAIL_USER', 'EMAIL_PASS', 'PUSHOVER_API_TOKEN', 'PUSHOVER_USER_KEY']

function setNotificationEnvironment(t, values) {
  const previous = Object.fromEntries(notificationVariables.map((key) => [key, process.env[key]]))

  for (const key of notificationVariables) {
    if (values[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = values[key]
    }
  }

  t.after(() => {
    for (const key of notificationVariables) {
      if (previous[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previous[key]
      }
    }
  })
}

function mockPushover(t, response = { status: 1 }) {
  let request
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options }
    return {
      ok: true,
      status: 200,
      json: async () => response,
    }
  })
  return () => request
}

test('sends price-drop alerts to Pushover without requiring email configuration', async (t) => {
  setNotificationEnvironment(t, {
    PUSHOVER_API_TOKEN: 'app-token',
    PUSHOVER_USER_KEY: 'user-key',
  })
  const getRequest = mockPushover(t)
  t.mock.method(console, 'log', () => {})

  const sent = await sendPriceDropNotification({
    productName: 'Example product',
    url: 'https://example.com/product',
    oldPrice: 100,
    newPrice: 80,
    store: 'Example Store',
    percentDrop: 20,
    screenshot: Buffer.from('screenshot'),
  })

  assert.equal(sent, true)
  const { url, options } = getRequest()
  assert.equal(url, 'https://api.pushover.net/1/messages.json')
  assert.equal(options.method, 'POST')
  assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(options.body)), {
    token: 'app-token',
    user: 'user-key',
    title: 'Price Drop: Example product',
    message: 'Example Store: $100.00 → $80.00 (20.0% off)',
    priority: '1',
    url: 'https://example.com/product',
    url_title: 'View Product',
  })
})

test('sends back-in-stock alerts to Pushover', async (t) => {
  setNotificationEnvironment(t, {
    PUSHOVER_API_TOKEN: 'app-token',
    PUSHOVER_USER_KEY: 'user-key',
  })
  const getRequest = mockPushover(t)
  t.mock.method(console, 'log', () => {})

  const sent = await sendInStockNotification({
    productName: 'Example product',
    url: 'https://example.com/product',
    store: 'Example Store',
    screenshot: Buffer.from('screenshot'),
  })

  assert.equal(sent, true)
  const body = new URLSearchParams(getRequest().options.body)
  assert.equal(body.get('title'), 'Back in Stock: Example product')
  assert.equal(body.get('message'), 'Example product at Example Store is now available.')
  assert.equal(body.get('url'), 'https://example.com/product')
})

test('continues price tracking without configured notification methods', async (t) => {
  setNotificationEnvironment(t, {})
  t.mock.method(console, 'log', () => {})
  t.mock.method(globalThis, 'fetch', () => {
    assert.fail('fetch should not be called when Pushover is not configured')
  })

  const sent = await sendInStockNotification({
    productName: 'Example product',
    url: 'https://example.com/product',
    store: 'Example Store',
    screenshot: Buffer.from('screenshot'),
  })

  assert.equal(sent, false)
})

test('reports Pushover API failures without rejecting the alert', async (t) => {
  setNotificationEnvironment(t, {
    PUSHOVER_API_TOKEN: 'app-token',
    PUSHOVER_USER_KEY: 'user-key',
  })
  mockPushover(t, { status: 0, errors: ['invalid token'] })
  t.mock.method(console, 'error', () => {})

  const sent = await sendPriceDropNotification({
    productName: 'Example product',
    url: 'https://example.com/product',
    oldPrice: 100,
    newPrice: 80,
    store: 'Example Store',
    percentDrop: 20,
    screenshot: Buffer.from('screenshot'),
  })

  assert.equal(sent, false)
})
