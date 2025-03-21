# Stage 1: Build
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Set NODE_ENV
ENV NODE_ENV=production \
    PORT=8000 \
    HOST=0.0.0.0 \
    WS_PING_INTERVAL=30000 \
    WS_PING_TIMEOUT=5000

# Install production dependencies only
COPY package*.json ./
RUN npm install --only=production

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist
COPY .env.production ./.env

# Add non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 8000

# Start the application
CMD ["npm", "start"] 