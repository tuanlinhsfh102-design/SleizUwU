import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@sleiz/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@sleiz/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
      '@sleiz/subtitle': path.resolve(__dirname, '../../packages/subtitle/src/index.ts'),
    },
  },
  server: {
    port: 3000,
    strictPort: true, // sandbox gateway expects exactly :3000
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:8787',
        changeOrigin: true,
      },
      '/uploads': {
        target: process.env.VITE_API_URL || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'framework-vendor': ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', '@tanstack/react-virtual'],
          'chart-vendor': ['recharts'],
          'icons-vendor': ['lucide-react'],
        },
      },
    },
  },
});
