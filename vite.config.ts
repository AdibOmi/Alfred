import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist/renderer',
    sourcemap: true,
  },
  plugins: [react()],
}));
