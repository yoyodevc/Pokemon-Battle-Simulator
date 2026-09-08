import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    // LocalTunnel assigns a new subdomain over time. The leading dot allows
    // only LocalTunnel subdomains instead of disabling Vite host protection.
    allowedHosts: ['.loca.lt'],
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: ['.loca.lt'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
