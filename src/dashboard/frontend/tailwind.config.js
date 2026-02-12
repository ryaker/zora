/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'zora-obsidian': '#0a0a0a',
        'zora-amber': '#ff9d00',
        'zora-cyan': '#00f2ff',
        'zora-magenta': '#ff00ea',
        'zora-gray': '#1a1a1a',
      },
      fontFamily: {
        'tactical': ['IBM Plex Sans Condensed', 'sans-serif'],
        'data': ['IBM Plex Mono', 'monospace'],
      }
    },
  },
  plugins: [],
}
