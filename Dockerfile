FROM node:20-alpine

WORKDIR /app

# Skip Chromium download — puppeteer is only used by the scraper, not the server
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
