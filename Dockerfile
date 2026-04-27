FROM node:20-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm ci --production 2>/dev/null || npm install --production

# Copy application code
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/

# Data directory will be mounted as volume
RUN mkdir -p /app/src/data

EXPOSE 3456

ENV NODE_ENV=production

CMD ["node", "server.js"]
