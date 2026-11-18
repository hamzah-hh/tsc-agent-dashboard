import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {apiServerPlugin} from './vite-api-plugin';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiServerPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          // Libraries that rarely change get their own files, so a normal deploy (new app code) leaves them
          // cached in the browser. The app's own code then stays small.
          codeSplitting: {
            groups: [
              { name: 'vendor-react', test: /node_modules[\/](react|react-dom|scheduler)[\/]/, priority: 30 },
              { name: 'vendor-firebase', test: /node_modules[\/](firebase|@firebase|idb)[\/]/, priority: 20 },
              { name: 'vendor-icons', test: /node_modules[\/]lucide-react[\/]/, priority: 10 },
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
