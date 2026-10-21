FROM node:26.12.0-bookworm-slim AS build

WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 build-essential \
	&& rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

RUN npx playwright install chromium

FROM node:26.12.0-bookworm-slim

LABEL org.opencontainers.image.source=https://github.com/krische/price-tracker
LABEL org.opencontainers.image.description="Price drop and stock tracker for Amazon and Best Buy — get email alerts when prices fall or items are back in stock."

WORKDIR /app

ENV PORT=3000 \
	DB_PATH=/data/prices.db \
	PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /ms-playwright /ms-playwright
COPY --from=build /app/package.json ./package.json

RUN npx playwright install-deps chromium \
	&& rm -rf /var/lib/apt/lists/* \
	&& mkdir /data \
	&& chown node:node /data

COPY src ./src
COPY public ./public

USER node

EXPOSE 3000

CMD ["npm", "start"]
