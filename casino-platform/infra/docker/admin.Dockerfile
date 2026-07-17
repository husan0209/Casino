FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/admin ./apps/admin
RUN pnpm install --filter @casino/admin...
CMD ["pnpm","--filter","@casino/admin","dev"]
