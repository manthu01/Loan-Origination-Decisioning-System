import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        approve: '#15803d',
        refer: '#b45309',
        decline: '#b91c1c',
      },
    },
  },
  plugins: [],
};
export default config;
