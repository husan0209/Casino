/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // Палитра заморожена: ТЗ ч.5.1 §2.4 (docs/tz-part-5.1-frontend-design.md).
      // Зелёный (money) — ТОЛЬКО деньги и успех; accent2 (#00D2FF) — теги сетей,
      // редкие акценты, НЕ деньги.
      // money #00E676 → #34C77B по решению владельца (2026-10-04): кислотный
      // зелёный резал глаза; подпись на такой плашке — тёмная, а не белая.
      colors: {
        bg: '#0F0F1A',
        surface: '#1A1A2E',
        surface2: '#16213E',
        line: '#2A2A4A',
        brand: { DEFAULT: '#6C63FF', light: '#8B7FFF', 600: '#5A51E6' },
        accent2: '#00D2FF',
        money: { DEFAULT: '#34C77B', dark: '#2BAF6B' },
        danger: '#FF3D71',
        warn: '#FFB300',
        muted: '#8888AA',
        // провайдер-цвета для карточек
        'provider-red': '#E53E3E',
        'provider-blue': '#3182CE',
        'provider-amber': '#D69E2E',
        'provider-teal': '#38B2AC',
        'provider-purple': '#805AD5',
      },
      fontFamily: { sans: ['var(--font-inter)', 'system-ui', 'sans-serif'] },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
}
