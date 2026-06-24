import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5001/bubble-net-82966/us-central1/api', // Maps to local firebase emulator or production functions
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
