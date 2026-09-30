# Imagem do painel para o Docker Swarm (decisão 27). Gerada pelo GitHub a cada merge na main.
# Nenhuma variável com valor aqui: tudo vem da stack no Portainer.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ARG VERSAO=dev
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 PAINEL_VERSAO=$VERSAO
RUN addgroup -S painel && adduser -S painel -G painel
COPY --from=build --chown=painel:painel /app/.next/standalone ./
COPY --from=build --chown=painel:painel /app/.next/static ./.next/static
USER painel
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/saude >/dev/null || exit 1
CMD ["node", "server.js"]
