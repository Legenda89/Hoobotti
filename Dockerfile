# Stage 1: Build the application
FROM node:20-alpine AS builder

# Install build dependencies for node-gyp (required for zlib-sync)
RUN apk add --no-cache python3 make g++ py3-pip

# Set working directory
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy rest of the files except settings (we’ll mount that later)
COPY . .

# Build the production application
RUN npm run build:production

# Stage 2: Create the runtime image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy built files from builder stage
COPY --from=builder /app .

# Install only production dependencies
RUN npm install --production

# Ensure the settings directory exists and is writable
RUN mkdir -p /app/settings && chmod -R 777 /app/settings

# Create a volume mount point for settings
VOLUME ["/app/settings"]

# Expose port 5656 for Express server
EXPOSE 5656

# Start the application
CMD ["node", "--experimental-modules", "--max-old-space-size=8192", "build/hoobot.js"]
