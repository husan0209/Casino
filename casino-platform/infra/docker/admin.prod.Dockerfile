FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
ARG NEXT_PUBLIC_API_URL=https://casino.example.com/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# GAP-60: причина та же, что у web.prod.Dockerfile — образ не собирался ни разу
# (CI до 2026-10-01 собирал только api.prod). .npmrc — hoisted-линковка, иначе
# pnpm изолирует транзитивные зависимости; .eslintrc.js — корневой конфиг ESLint,
# без него `next lint` в составе `next build` парсит .ts как скрипт (31 ошибка
# «Parsing error: The keyword 'import' is reserved»).
COPY .npmrc .eslintrc.js ./
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/admin ./apps/admin
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @casino/admin build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/admin/.next/standalone ./
COPY --from=builder /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=builder /app/apps/admin/public ./apps/admin/public
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
