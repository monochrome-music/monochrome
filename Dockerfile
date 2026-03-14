# Node Alpine -- multi-arch (amd64 + arm64)
FROM node:24.14-alpine AS builder

WORKDIR /app

# Install system dependencies required for Bun and Neutralino
RUN apk add --no-cache wget curl bash
RUN apk add --no-cache python3 make g++ && ln -sf python3 /usr/bin/python

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

# Add Bun to PATH so it can be used in subsequent steps
ENV PATH="/root/.bun/bin:${PATH}"

# Copy package files first for caching
COPY package.json package-lock.json ./

# Install dependencies (Node)
RUN bun install

# Copy the rest of the project
COPY . .

# Build the project (Bun is now available for "bun x neu build")
RUN bun run build

# Serve with nginx
FROM nginx:1.28.2-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose the nginx port
EXPOSE 4173

CMD ["nginx", "-g", "daemon off;"]
