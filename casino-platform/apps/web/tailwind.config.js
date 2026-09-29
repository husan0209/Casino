/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {
    // Палитра заморожена: ТЗ ч.5.1 §2.4 (docs/tz-part-5.1-frontend-design.md).
    // Зелёный (money) — ТОЛЬКО деньги и успех; accent2 (#00D2FF) — теги сетей,
    // редкие акценты, НЕ деньги.
    colors: {
      bg: '#0F0F1A',
      surface: '#1A1A2E',
      surface2: '#16213E',
      line: '#2A2A4A',
      brand: { DEFAULT: '#6C63FF', 600: '#5A51E6' },
      accent2: '#00D2FF',
      money: '#00C853',
      danger: '#FF3D71',
      warn: '#FFB300',
      muted: '#8888AA',
    },
    fontFamily: { sans: ['var(--font-inter)', 'system-ui', 'sans-serif'] },
    borderRadius: { xl2: '1.25rem' },
  }},
  plugins: []
}
