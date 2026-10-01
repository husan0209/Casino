const path = require('node:path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // infra/docker/admin.prod.Dockerfile копирует .next/standalone и запускает apps/admin/server.js —
  // без standalone этого каталога не существует, и `docker compose build admin` падает на COPY.
  output: 'standalone',
  // Монорепо: трассировка от корня workspace, иначе standalone соберёт зависимости вне /app.
  outputFileTracingRoot: path.join(__dirname, '../../'),
}

module.exports = nextConfig
