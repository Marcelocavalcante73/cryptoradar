# CryptoRadar: mesma imagem em qualquer hospedagem (Render, Cloud Run, Railway, Fly.io, VPS)
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
# A maioria das hospedagens define PORT; o app usa 3000 se não houver
ENV PORT=3000
EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
