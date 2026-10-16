/** @type {import('tailwindcss').Config} */

// Marketplace palette: signal green for money and actions, cool slate neutrals for structure,
// amber for secondary emphasis. Token names stay the same so storefront and admin re-skin together.
const market = {
  primary: {
    50: '#E9F9EE',
    100: '#D2F1DC',
    200: '#A6E3B9',
    300: '#6FD093',
    400: '#2FB966',
    500: '#00A82D',
    600: '#009226',
    700: '#00731E',
    800: '#00581A',
  },
  secondary: {
    100: '#EEF0FA',
    200: '#DDE1EF',
    300: '#BCC3D6',
    400: '#8A93A2',
    500: '#5A6472',
  },
  tertiary: {
    100: '#FFF3D6',
    200: '#FFE4A8',
    300: '#FFCF6E',
    500: '#F5A524',
    600: '#C97F14',
  },
  error: {
    100: '#FDE3E1',
    300: '#F6A9A3',
    500: '#D92D20',
    600: '#B42318',
  },
  surface: {
    50: '#FFFFFF',
    100: '#F4F5F9',
    200: '#E8EAF1',
    300: '#DCE0EA',
  },
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      colors: {
        primary: market.primary,
        secondary: market.secondary,
        tertiary: market.tertiary,
        error: market.error,
        surface: market.surface,
        ink: { DEFAULT: '#1A1C21', soft: '#4B5563', mute: '#8A93A2' },
      },
      fontFamily: {
        display: ['Roboto', 'system-ui', '"Segoe UI"', 'sans-serif'],
        sans: ['Roboto', 'system-ui', '"Segoe UI"', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(20, 24, 33, 0.08), 0 1px 2px rgba(20, 24, 33, 0.06)',
        raised: '0 4px 16px rgba(20, 24, 33, 0.12)',
        bar: '0 -1px 0 rgba(20, 24, 33, 0.10)',
      },
      letterSpacing: { display: '0', body: '0.00625em' },
      spacing: { gutter: '1rem', band: '4.5rem' },
      aspectRatio: { product: '1 / 1', banner: '16 / 7' },
    },
  },
  plugins: [],
};
