# Node Alpine -- multi-arch (amd64 + arm64)
FROM oven/bun:1.3.11-alpine AS builder

WORKDIR /app

# Install system dependencies required for Bun
RUN apk add --no-cache wget curl bash

# Accept build arguments for environment variables
ARG AUTH_ENABLED
ARG AUTH_URL
ARG AUTH_EMAIL_ENABLED
ARG AUTH_GOOGLE_ENABLED

# Promote ARGs to ENV so `bun run build` (vite-plugin-auth-gate) can read them.
# A bare ARG is NOT visible to the build step's process.env, so the client
# config would never be injected -- this ENV line is what makes it take effect.
ENV AUTH_ENABLED=$AUTH_ENABLED \
    AUTH_URL=$AUTH_URL \
    AUTH_EMAIL_ENABLED=$AUTH_EMAIL_ENABLED \
    AUTH_GOOGLE_ENABLED=$AUTH_GOOGLE_ENABLED

# Copy package files first for caching
COPY package.json bun.lock ./

# Install dependencies (Node)
RUN bun install

# Copy the rest of the project
COPY . .

# Build the project
RUN bun run build

# Serve with nginx
FROM nginx:1.28.2-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose the nginx port
EXPOSE 4173

CMD ["nginx", "-g", "daemon off;"]
