# 📉 Price Tracker

A price drop tracker for **Amazon** and **Best Buy** with automatic email alerts when prices fall below your threshold or the product becomes available. Built with Node.js, Playwright, SQLite, and Chart.js.

![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)
![Express](https://img.shields.io/badge/Express-4.x-lightgrey?logo=express)
![SQLite](https://img.shields.io/badge/SQLite-3-blue?logo=sqlite)
![Playwright](https://img.shields.io/badge/Playwright-1.x-red?logo=playwright)

## ✨ Features

- **🔗 Add any Amazon or Best Buy URL** — just paste and track
- **🕷️ Playwright scraper** — headless browser scraping for accurate prices
- **⏰ Scheduled checks** — cron job runs every 6 hours (configurable)
- **💾 SQLite storage** — full price history stored locally
- **📦 Stock tracking** — current availability and availability history for each product
- **📈 Price and availability history charts** — Chart.js graphs for each product
- **🖼️ Latest scrape screenshot** — view screenshot of last scrape attempt
- **📧 Email alerts** — Nodemailer alerts when prices drop by X% or products come back in stock
- **📊 Dashboard** — clean web UI to manage all tracked products

## 🛠 Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js + Express |
| Scraping | Playwright (headless Chromium) |
| Database | SQLite (better-sqlite3) |
| Email | Nodemailer |
| Scheduling | node-cron |
| Charts | Chart.js (CDN) |
| Frontend | Vanilla HTML/CSS/JS |

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Gmail account (for email alerts)

### Installation

```bash
# Clone the repo
git clone https://github.com/mistacarta/price-tracker.git
cd price-tracker

# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Set up environment variables
cp .env.example .env
# Edit .env with your email credentials
```

### Environment Variables

```bash
# .env
EMAIL_USER=your_gmail@gmail.com
EMAIL_PASS=your_app_password     # Gmail App Password (not your regular password)
ALERT_EMAIL=you@example.com
CHECK_INTERVAL_MINUTES=-1
CHECK_INTERVAL_HOURS=6
PRICE_DROP_THRESHOLD=5           # Alert when price drops by this %
PORT=3000
DB_PATH=./prices.db              # SQLite database file path (optional)
```

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
5. You'll receive an email alert when a price drop is detected or an out-of-stock product becomes available again

## 📁 Project Structure

```
price-tracker/
├── src/
│   ├── server.js        # Express server + API routes
│   ├── scraper.js       # Playwright scraper (Amazon + Best Buy)
│   ├── scheduler.js     # node-cron job + price check logic
│   ├── mailer.js        # Nodemailer email alerts
│   └── db.js            # SQLite database setup
├── public/
│   └── index.html       # Frontend dashboard (Chart.js)
├── .env.example
├── .releaserc.json
├── Dockerfile
├── eslint.config.js
├── package-lock.json
└── package.json
├── README.md
```

## 🔧 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List tracked products, including current stock status |
| POST | `/api/products` | Add a new product URL |
| DELETE | `/api/products/:id` | Remove a product |
| GET | `/api/products/:id/history` | Get price and stock history |
| GET | `/api/products/:id/screenshot` | Get the latest screenshot captured for a product |
| POST | `/api/check` | Manually trigger price check |

## ⚠️ Legal Notice

Web scraping may violate the Terms of Service of some websites. Use this tool responsibly and only for personal use.

## 📄 License

MIT
