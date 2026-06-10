import { defineConfig } from 'astro/config';
import tailwindcss from '@astrojs/tailwind';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  integrations: [tailwindcss()],
});
