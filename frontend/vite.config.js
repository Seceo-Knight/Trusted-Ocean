import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the dashboard runs on http://localhost:5173 and forwards /api calls
// to the backend on port 4100. In production the backend serves the built files itself.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4100' },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        // separate files for the big libraries so browsers cache them between releases
        manualChunks(id) {
          if (id.includes('maplibre-gl')) return 'map';
          if (id.includes('echarts') || id.includes('zrender')) return 'charts';
          if (id.includes('world-atlas') || id.includes('topojson')) return 'coastlines';
          if (id.includes('@mui') || id.includes('@emotion')) return 'ui';
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
  },
});
