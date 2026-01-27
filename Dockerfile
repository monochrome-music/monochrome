# Use Bun canary on Alpine
FROM oven/bun:canary-alpine

# Set working directory
WORKDIR /app

# Copy package files first for caching
COPY package.json bun.lockb ./

# Install all dependencies (including devDeps)
RUN bun install

# Copy the rest of the project
COPY . .

# Build the project
RUN bun run build

# Remove devDependencies to shrink image
RUN bun prune --prod

# Expose Vite preview port
EXPOSE 4173

# Run the built project
CMD ["bun", "run", "preview"]
