# Stage 1: Build dependencies (compiles native addons like better-sqlite3)
FROM node:26.13.0-trixie AS builder

WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends build-essential python3 \
	&& rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
	&& npm prune --omit=dev

# Stage 2: Final runtime image
FROM node:26.13.0-trixie

LABEL org.opencontainers.image.source=https://github.com/krische/price-tracker
LABEL org.opencontainers.image.description="Price drop and stock tracker for Amazon and Best Buy — get email alerts when prices fall or items are back in stock."

WORKDIR /app

ENV PORT=3000
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV HEADLESS=false

# Install system utilities and Patchright Chromium early to ensure layer caching
RUN apt-get update \
	&& apt-get install -y --no-install-recommends xvfb \
	&& npx --yes patchright@1.64.2 install --with-deps chromium \
	&& rm -rf /var/lib/apt/lists/*

# Copy entrypoint script with executable permissions
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.sh

# Copy dependencies and package manifest from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Copy static frontend assets
COPY public ./public

# Copy compiled application code (changes most frequently, near the bottom)
COPY --from=builder /app/dist ./dist

# Application version passed during build (does not bust dependency layers)
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/src/server.js"]
