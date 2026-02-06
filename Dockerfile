# Use Bun on Alpine
FROM oven/bun:alpine

# Set working directory
WORKDIR /app

# Copy package files first for caching
COPY package.json bun.lock ./

# Install all dependencies (including devDeps)
RUN bun install

# Copy the rest of the project
COPY . .

# Build the project
RUN bun run build

# Expose Vite preview port
EXPOSE 4173

# Run the built project
CMD ["bun", "run", "preview", "--", "--host", "0.0.0.0"]
