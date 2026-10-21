FROM node:26.12.0-bookworm

LABEL org.opencontainers.image.source=https://github.com/krische/price-tracker
LABEL org.opencontainers.image.description="Price drop and stock tracker for Amazon and Best Buy — get email alerts when prices fall or items are back in stock."

WORKDIR /app

ENV DB_PATH=/data/prices.db \
  NODE_ENV=production \
  PORT=3000 \
  PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Dependencies
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 build-essential gosu \
	&& rm -rf /var/lib/apt/lists/*

# Application
COPY package*.json ./
RUN npm ci --omit=dev  --no-audit --no-fund

# Install Playwright and its dependencies
RUN mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" /data \
	&& chmod 1777 /data \
	&& npx playwright install --with-deps chromium \
	&& chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"

# Copy application files
COPY src ./src
COPY public ./public
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
