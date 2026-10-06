FROM node:24.21.0-bookworm

WORKDIR /app

ENV PORT=3000

RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 build-essential \
	&& rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev \
	&& npx playwright install --with-deps chromium

COPY src ./src
COPY public ./public

EXPOSE 3000

CMD ["npm", "start"]
