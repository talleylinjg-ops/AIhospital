FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci

COPY . .
RUN npm run build --workspace client

ENV PORT=3001
ENV AIHOSPITAL_DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 3001

CMD ["node", "server/index.js"]
