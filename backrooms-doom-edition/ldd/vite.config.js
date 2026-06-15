import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Plain Vite + React. '@' resolves to /src.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
