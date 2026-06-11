/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'var(--color-bg)',
          subtle: 'var(--color-bg-subtle)',
        },
        fg: {
          DEFAULT: 'var(--color-fg)',
          subtle: 'var(--color-fg-subtle)',
          muted: 'var(--color-fg-muted)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
        },
        accent: {
          bg: 'var(--color-accent-bg)',
          fg: 'var(--color-accent-fg)',
          hover: 'var(--color-accent-hover)',
        },
      },
    },
  },
  plugins: [],
};
