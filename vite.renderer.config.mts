import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rendererRoot = path.resolve(__dirname, 'apps/desktop/src/renderer');
const rendererOutDir = path.resolve(__dirname, '.vite/renderer/main_window');

export default defineConfig({
  base: './',
  build: {
    outDir: rendererOutDir,
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@/lib/app-router': path.resolve(
        __dirname,
        'apps/desktop/src/renderer/app-router.ts'
      ),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  root: rendererRoot,
});
