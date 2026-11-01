/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace'],
        crt: ['"VT323"', 'monospace'],
        mono: ['"Space Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
