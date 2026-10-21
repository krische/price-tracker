# 📉 Price Tracker

A price drop tracker for **Amazon** and **Best Buy** with optional email and Pushover alerts when prices fall below your threshold or an item comes back in stock. Built with Node.js, Playwright, SQLite, and Chart.js.

![Node.js](https://img.shields.io/badge/Node.js-22+-green?logo=node.js)
![Express](https://img.shields.io/badge/Express-5.x-lightgrey?logo=express)
![SQLite](https://img.shields.io/badge/SQLite-3-blue?logo=sqlite)
![Playwright](https://img.shields.io/badge/Playwright-1.x-red?logo=playwright)

## ✨ Features

- **🔗 Add any Amazon or Best Buy URL** — just paste and track
- **🕷️ Playwright scraper** — headless browser scraping for accurate prices
- **⏰ Scheduled checks** — cron job runs every 6 hours (configurable)
- **💾 SQLite storage** — full price history stored locally
- **📦 Stock tracking** — current availability and availability history for each product
- **📈 Price and availability history charts** — Chart.js graphs for each product
- **🖼️ Latest scrape screenshot** — base64 screenshot in SQLite, viewable from each product; scheduled scrape failures also save a screenshot when available
- **📧 Optional email alerts** — Nodemailer alerts with the latest product screenshot embedded when prices drop by X% or products come back in stock
- **📱 Optional Pushover alerts** — notifications for price drops and restocked products
- **📊 Dashboard** — clean web UI to manage all tracked products

## 🛠 Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js + Express |
| Scraping | Playwright (headless Chromium) |
| Database | SQLite (better-sqlite3) |
| Email notifications (optional) | Nodemailer |
| Push notifications (optional) | Pushover API |
| Scheduling | node-cron |
| Charts | Chart.js (CDN) |
| Frontend | Vanilla HTML/CSS/JS |

## 🚀 Getting Started

### Prerequisites

- Node.js 22+
- A Gmail account for email alerts (optional)
- A Pushover account and application API token for push alerts (optional)

### Installation

```bash
# Clone the repo
git clone https://github.com/krische/price-tracker.git
cd price-tracker

# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Set up environment variables
cp .env.example .env
# Edit .env with credentials for any notification methods you want to enable
```

### Environment Variables

```bash
# .env
AUTH_USERNAME=your_username
AUTH_PASSWORD=use_a_long_unique_password
# Optional email notifications (configure all three to enable)
EMAIL_USER=your_gmail@gmail.com
EMAIL_PASS=your_app_password     # Gmail App Password (not your regular password)
ALERT_EMAIL=you@example.com

# Optional Pushover notifications (configure both to enable)
PUSHOVER_API_TOKEN=your_application_api_token
PUSHOVER_USER_KEY=your_user_or_group_key
CHECK_INTERVAL_EXPRESSION="0 */6 * * *"
CHECK_INTERVAL_JITTER=0
PRICE_DROP_THRESHOLD=5           # Alert when price drops by this %
PORT=3000
DB_PATH=./prices.db              # SQLite database file path (optional)
```

`AUTH_USERNAME` and `AUTH_PASSWORD` are required to start the application. They configure the single login account used to access the dashboard and API. The login session is stored in an HttpOnly, SameSite cookie and expires after seven days; restarting the app also ends active sessions. In production the cookie is marked Secure.

Notifications are optional and independent: configure all three email variables to enable email alerts, both Pushover variables to enable push alerts, or configure both methods. Pushover credentials are available from your [Pushover application settings](https://pushover.net/apps/build). If neither method is configured, price tracking continues without sending notifications.

Set `CHECK_INTERVAL_EXPRESSION` to a cron expression to choose the check schedule. For example, `"*/15 * * * *"` checks every 15 minutes; the default `"0 */6 * * *"` checks every six hours.

`DB_PATH` defaults to `prices.db` in the project root. Relative paths are resolved from the current working directory, and missing parent directories are created automatically.

> **Gmail Setup:** Enable 2FA → Generate App Password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)

### Run

```bash
# Production
npm start

# Development (auto-restart)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Run Tests

```bash
npm test
```

## 📖 Usage

1. Paste an Amazon or Best Buy product URL in the text field
2. Set your alert threshold (e.g., `5` = alert when price drops 5%)
3. Click **"Track Price"** — the app scrapes the current price
4. The scheduler checks all products every 6 hours automatically
5. If configured, you'll receive an email and/or Pushover alert when a price drop is detected or an out-of-stock product becomes available again

## 📁 Project Structure

```
price-tracker/
├── src/
│   ├── server.js        # Express server + API routes
│   ├── scraper.js       # Playwright scraper (Amazon + Best Buy)
│   ├── scheduler.js     # node-cron job + price check logic
│   ├── mailer.js        # Nodemailer email alerts
│   ├── notifications.js # Optional email and Pushover alert dispatch
│   └── db.js            # SQLite database setup
├── public/
│   ├── index.html       # Frontend dashboard (Chart.js)
│   └── favicon.png      # Product tracking favicon
├── .env.example
└── package.json
```

## 🔧 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/login` | Log in with the configured username and password |
| POST | `/api/logout` | End the current login session |
| GET | `/api/products` | List tracked products, including current stock status |
| POST | `/api/products` | Add a new product URL |
| DELETE | `/api/products/:id` | Remove a product |
| GET | `/api/products/:id/history` | Get price and stock history |
| GET | `/api/products/:id/screenshot` | Get the latest screenshot captured for a product |
| POST | `/api/check` | Manually trigger price check |

All API endpoints except `/api/login` and `/api/version` require a valid login session.

## ⚠️ Legal Notice

Web scraping may violate the Terms of Service of some websites. Use this tool responsibly and only for personal use.

## 📄 License

MIT
