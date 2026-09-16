/**
 * GAP-55 (е) (ТЗ ч.5 §22): «домены CDN провайдеров сразу в next.config».
 *
 * Реальные хосты брендов GitSlotPark станут известны только при подключении
 * (GAP-46), поэтому список берётся из env, а не из хардкода. Выворачивать
 * `hostname: '**'` нельзя: оптимизатор next/image начал бы ходить по
 * произвольным URL самой же платформой (SSRF-вектор + кеш мусора).
 * Разрешённые хосты — NEXT_PUBLIC_IMAGE_HOSTS через запятую.
 */
const hosts = (process.env['NEXT_PUBLIC_IMAGE_HOSTS'] ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter((host) => host.length > 0)

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: hosts.map((hostname) => ({
      protocol: 'https',
      hostname,
    })),
  },
}

module.exports = nextConfig
