import { sendInStockAlert as sendEmailInStockAlert, sendPriceDropAlert as sendEmailPriceDropAlert } from './mailer.js'

const PUSHOVER_API_URL = 'https://api.pushover.net/1/messages.json'

async function sendPushoverAlert({ title, message, url }) {
  const token = process.env.PUSHOVER_API_TOKEN
  const user = process.env.PUSHOVER_USER_KEY

  try {
    const response = await fetch(PUSHOVER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token,
        user,
        title,
        message,
        priority: '1',
        url,
        url_title: 'View Product',
      }),
    })
    const result = await response.json()

    if (!response.ok || result.status !== 1) {
      throw new Error(result.errors?.join(', ') || `HTTP ${response.status}`)
    }

    console.log(`[Pushover] Alert sent: ${title}`)
    return true
  } catch (err) {
    console.error('[Pushover] Failed to send alert:', err.message)
    return false
  }
}

function reportIncompleteConfiguration() {
  if ((process.env.ALERT_EMAIL || process.env.EMAIL_USER || process.env.EMAIL_PASS)
    && !(process.env.ALERT_EMAIL && process.env.EMAIL_USER && process.env.EMAIL_PASS)) {
    console.error('[Notifications] Email notifications require ALERT_EMAIL, EMAIL_USER, and EMAIL_PASS')
  }
  if ((process.env.PUSHOVER_API_TOKEN || process.env.PUSHOVER_USER_KEY)
    && !(process.env.PUSHOVER_API_TOKEN && process.env.PUSHOVER_USER_KEY)) {
    console.error('[Notifications] Pushover notifications require PUSHOVER_API_TOKEN and PUSHOVER_USER_KEY')
  }
}

async function dispatchNotifications(alert, emailSender) {
  const emailConfigured = Boolean(process.env.ALERT_EMAIL && process.env.EMAIL_USER && process.env.EMAIL_PASS)
  const pushoverConfigured = Boolean(process.env.PUSHOVER_API_TOKEN && process.env.PUSHOVER_USER_KEY)

  reportIncompleteConfiguration()

  const senders = []
  if (emailConfigured) senders.push(emailSender(alert))
  if (pushoverConfigured) senders.push(sendPushoverAlert(alert))

  if (!senders.length) {
    console.log('[Notifications] No notification methods configured — skipping alert')
    return false
  }

  const results = await Promise.all(senders)
  return results.some(Boolean)
}

async function sendPriceDropNotification({ productName, url, oldPrice, newPrice, store, percentDrop, screenshot }) {
  const title = `Price Drop: ${productName}`
  const message = `${store}: $${oldPrice.toFixed(2)} → $${newPrice.toFixed(2)} (${percentDrop.toFixed(1)}% off)`

  return dispatchNotifications({
    productName,
    url,
    oldPrice,
    newPrice,
    store,
    percentDrop,
    screenshot,
    title,
    message,
  }, sendEmailPriceDropAlert)
}

async function sendInStockNotification({ productName, url, store, screenshot }) {
  return dispatchNotifications({
    productName,
    url,
    store,
    screenshot,
    title: `Back in Stock: ${productName}`,
    message: `${productName} at ${store} is now available.`,
  }, sendEmailInStockAlert)
}

export { sendInStockNotification, sendPriceDropNotification }
