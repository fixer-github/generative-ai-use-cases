/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    fontFamily: {
      body: ['"Noto Sans JP"', 'Sarabun'],
    },
    extend: {
      transitionProperty: {
        width: 'width',
        height: 'height',
      },
      screens: {
        print: { raw: 'print' },
        screen: { raw: 'screen' },
      },
      spacing: {
        128: '32rem',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('tailwind-scrollbar'),
    require('@tailwindcss/forms'),
  ],
};
