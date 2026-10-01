# Receptor do WhatsApp (decisão 28): serviço próprio, separado do painel. Se o painel cair, a Sara continua.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORTA=3010 SPOOL_DIR=/dados
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
RUN addgroup -S receptor && adduser -S receptor -G receptor && mkdir -p /dados && chown receptor:receptor /dados
USER receptor
EXPOSE 3010
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3010/whatsapp/vivo >/dev/null || exit 1
CMD ["node", "src/index.js"]
