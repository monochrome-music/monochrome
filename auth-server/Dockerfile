FROM node:22-bookworm-slim AS build
WORKDIR /app
# build-essential + python3 let better-sqlite3 compile if no prebuild is available
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY package.json auth.js index.js ./
EXPOSE 8080
CMD ["node", "index.js"]
