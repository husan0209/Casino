FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
ARG NEXT_PUBLIC_API_URL=https://casino.example.com/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# NEXT_PUBLIC_* инлайнятся в бандл во время `next build` и в standalone-рантайме
# уже не читаются — значит каждый публичный ключ обязан дойти сюда build-аргом.
# Без GOOGLE_CLIENT_ID кнопка входа в Google не рисуется (LoginSheet рендерит её
# только при непустом значении), без TURNSTILE_SITE_KEY молча отключается капча,
# без IMAGE_HOSTS next/image отбраковывает аватары с чужих хостов.
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_IMAGE_HOSTS=
ENV NEXT_PUBLIC_IMAGE_HOSTS=$NEXT_PUBLIC_IMAGE_HOSTS
# GAP-60: без этих двух файлов сборка этого образа падала ВСЕГДА (её просто не
# гонял ни один CI до 2026-10-01 — docker-build собирал только api.prod).
#   .npmrc — node-linker=hoisted. Без него pnpm изолирует транзитивные зависимости
#     (decimal.js из @casino/shared-utils) и `next build` падает на
#     «Cannot find module 'decimal.js'» — тот же класс, что api.prod ловил на node-типах.
#   .eslintrc.js — корневой конфиг ESLint (parser: '@typescript-eslint/parser',
#     sourceType: module). apps/web/.eslintrc.js его НЕ расширяет, а наследует
#     обходом вверх; без него `next lint` (шаг `next build`) парсит .ts как скрипт
#     и даёт 129 × «Parsing error: The keyword 'import' is reserved».
COPY .npmrc .eslintrc.js ./
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
# Пакеты → dist ДО сборки web (тот же порядок, что в api.prod.Dockerfile).
# Сегодня `next build` резолвит @casino/shared-* в ИСХОДНИКИ: apps/web/tsconfig.json
# объявляет paths → packages/*/src, поэтому TS6305 («Output file ... has not been
# built from source file») в этом образе не возникает. Но это зависимость от одной
# строки в tsconfig: package.json у пакетов объявляет main/types = ./dist/*, и если
# paths пропадут (или резолвер уйдёт на node-разрешение), сборка получит либо TS6305,
# либо пустой dist. Отдельный build-stage для этого не нужен — слои и так общие, —
# а явный build стоит секунды и снимает класс молчаливых поломок.
RUN pnpm --filter @casino/shared-types --filter @casino/shared-utils build
RUN pnpm --filter @casino/web build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
