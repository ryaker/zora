/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'zora-obsidian': '#0a0b0f',
        'zora-teal': '#1fd1b9',
        'zora-cyan': '#64e9ff',
        'zora-gold': '#ffb347',
        'zora-blue': '#8cdff0',
        'zora-ghost': '#2a3342',
        'zora-rail': '#161b26',
        'zora-white': '#eaf7ff',
      },
      fontFamily: {
        'tactical': ['IBM Plex Sans Condensed', 'sans-serif'],
        'data': ['IBM Plex Mono', 'monospace'],
      }
    },
  },
  plugins: [],
}
