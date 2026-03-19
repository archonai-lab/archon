FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Production ---
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output + runtime files
COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle
COPY drizzle.config.ts ./
COPY agents ./agents
COPY methodologies ./methodologies

# drizzle-kit needs to be available for migrations
RUN npm install drizzle-kit

CMD sh -c "npx drizzle-kit migrate && node dist/index.js"
