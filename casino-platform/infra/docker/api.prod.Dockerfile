FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/api ./apps/api
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
RUN mkdir -p /app/uploads /app/logs && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
