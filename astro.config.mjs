import { defineConfig } from 'astro/config';
import tailwindcss from '@astrojs/tailwind';
import node from '@astrojs/node';

export default defineConfig({
  site: process.env.SITE_URL ?? 'http://localhost:3000',
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  integrations: [tailwindcss()],
});
