# Fly.io, Railway, 개인 서버 등 도커가 되는 곳이면 어디든
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
