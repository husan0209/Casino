/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {
    colors: { bg:'#0b0b12', surface:'#141420', surface2:'#1c1c2b', brand:{DEFAULT:'#ff3b7a',600:'#e02d68'}, neon:'#00ffc8', muted:'#8b8ba7' },
    borderRadius: { xl2:'1.25rem' }
  }},
  plugins: []
}
