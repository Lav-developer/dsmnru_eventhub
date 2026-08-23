/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f4f8',
          100: '#dbe5f0',
          200: '#bdcfe3',
          300: '#91b1d2',
          400: '#5f8cb9',
          500: '#3d6fa1',
          600: '#2e5786',
          700: '#26466f',
          800: '#223c5e',
          900: '#1e3350',
          950: '#142136',
        }
      }
    },
  },
  plugins: [],
}
