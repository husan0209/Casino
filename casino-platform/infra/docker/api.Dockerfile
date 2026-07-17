FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --filter @casino/api...
RUN pnpm --filter @casino/database generate || true
CMD ["pnpm","--filter","@casino/api","dev"]
