FROM node:26.12.1-trixie

LABEL org.opencontainers.image.source=https://github.com/krische/price-tracker
LABEL org.opencontainers.image.description="Price drop and stock tracker for Amazon and Best Buy — get email alerts when prices fall or items are back in stock."

WORKDIR /app

ENV PORT=3000

# Dependencies
RUN apt-get update \
	&& apt-get install -y --no-install-recommends build-essential python3 xvfb \
	&& rm -rf /var/lib/apt/lists/*

# Application
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Install Patchright and its dependencies
RUN npx --yes patchright install --with-deps chromium

# Copy application files
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
COPY src ./src
COPY public ./public

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
