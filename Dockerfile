FROM node:26.10.0-bookworm

LABEL org.opencontainers.image.source=https://github.com/krische/price-tracker
LABEL org.opencontainers.image.description="Price drop and stock tracker for Amazon and Best Buy — get email alerts when prices fall or items are back in stock."

WORKDIR /app

ENV PORT=3000

# Dependencies
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 build-essential \
	&& rm -rf /var/lib/apt/lists/*

# Application
COPY package*.json ./
RUN npm ci --omit=dev

# Install Playwright and its dependencies
RUN npx playwright install --with-deps chromium

# Copy application files
COPY src ./src
COPY public ./public

EXPOSE 3000

CMD ["npm", "start"]
