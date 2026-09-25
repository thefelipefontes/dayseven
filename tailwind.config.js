/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Neutral greys in four roles, replacing Tailwind's default cool (blue-tinted) grays
      // so class greys and the hex greys in inline styles are one family:
      // 300 body-muted · 400 secondary · 500 tertiary · 600 disabled/empty.
      colors: {
        gray: { 300: '#cccccc', 400: '#aaaaaa', 500: '#777777', 600: '#555555' },
      },
    },
  },
  plugins: [],
}
