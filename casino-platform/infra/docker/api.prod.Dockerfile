FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
# .npmrc (node-linker=hoisted) обязателен: без него pnpm изолирует @types/node
# в apps/api/node_modules, и билд shared-config/database падает без node-типов
# (TS2503 'NodeJS' / TS2580 'process') — локально и в CI hoisting это скрывал.
COPY .npmrc ./
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/api ./apps/api
# Prisma определяет бинарный таргет по выводу `openssl version`, а в node:20-alpine
# этой утилиты нет → генератор молча берёт legacy openssl-1.1.x и качает
# libquery_engine-linux-musl.so, который на Alpine 3.19+ не грузится
# («Error loading shared library libssl.so.1.1»). Ставим openssl ДО generate, чтобы
# автоопределение работало и binaryTargets в схеме оставались не нужными.
RUN apk add --no-cache openssl
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @casino/database generate
# Workspace-пакеты → dist (main: dist/index.js) ДО сборки api: tsconfig.build.json резолвит @casino/* на dist
RUN pnpm --filter @casino/shared-types --filter @casino/shared-utils --filter @casino/shared-config --filter @casino/database build
RUN pnpm --filter @casino/api build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/node_modules ./node_modules
# Рантайм тоже определяет таргет по `openssl version` (см. комментарий в builder).
RUN apk add --no-cache openssl
# node-linker=hoisted кладёт ссылки воркспейс-пакетов в apps/api/node_modules, а отсюда
# копируются только dist и package.json → на старте MODULE_NOT_FOUND '@casino/shared-config'.
# Локально и в CI не видно: CI образ собирает, но не запускает. Восстанавливаем ссылки.
RUN mkdir -p /app/node_modules/@casino \
  && for pkg_json in /app/packages/*/package.json; do \
       name="$(node -e 'console.log(require(process.argv[1]).name)' "$pkg_json")"; \
       case "$name" in @casino/*) ln -sfn /app/packages/"${name#@casino/}" /app/node_modules/@casino/"${name#@casino/}" ;; esac; \
     done \
  && node -e 'for (const m of ["shared-config","shared-utils","shared-types","database"]) require.resolve("@casino/"+m, { paths: ["/app/apps/api/dist"] })'
RUN mkdir -p /app/uploads /app/logs && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
