const nodemailer = require('nodemailer')

let transporter

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    })
  }
  return transporter
}

/**
 * Send a price drop alert email
 */
async function sendPriceDropAlert({ productName, url, oldPrice, newPrice, store, percentDrop }) {
  const to = process.env.ALERT_EMAIL
  if (!to || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('[Mailer] Email not configured — skipping alert')
    return false
  }

  const subject = `🔔 Price Drop Alert: ${productName} dropped ${percentDrop.toFixed(1)}%!`

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #2563eb;">🎉 Price Drop Detected!</h2>
      
      <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <h3 style="margin: 0 0 8px 0; color: #166534;">${productName}</h3>
        <p style="margin: 4px 0; color: #15803d; font-size: 14px;">Store: ${store}</p>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px; background: #fee2e2; color: #dc2626; text-align: center; border-radius: 4px 0 0 4px;">
            <div style="font-size: 12px;">Was</div>
            <div style="font-size: 24px; font-weight: bold;">$${oldPrice.toFixed(2)}</div>
          </td>
          <td style="padding: 8px; text-align: center; font-size: 24px;">→</td>
          <td style="padding: 8px; background: #dcfce7; color: #16a34a; text-align: center; border-radius: 0 4px 4px 0;">
            <div style="font-size: 12px;">Now</div>
            <div style="font-size: 24px; font-weight: bold;">$${newPrice.toFixed(2)}</div>
          </td>
        </tr>
      </table>

      <p style="color: #4b5563;">
        You're saving <strong style="color: #16a34a;">$${(oldPrice - newPrice).toFixed(2)} (${percentDrop.toFixed(1)}% off)</strong>
      </p>

      <a href="${url}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
        View Product →
      </a>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        Sent by Price Tracker • <a href="http://localhost:3000" style="color: #9ca3af;">Manage alerts</a>
      </p>
    </div>
  `

  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html,
    })
    console.log(`[Mailer] Alert sent for ${productName}`)
    return true
  } catch (err) {
    console.error('[Mailer] Failed to send email:', err.message)
    return false
  }
}

module.exports = { sendPriceDropAlert }
