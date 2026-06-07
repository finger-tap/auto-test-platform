import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    watch: {
      // Midscene writes intermediate report output to <cwd>/midscene_run/
      // and report screenshots to data/midscene-reports/ on every case.
      // Without this ignore list, Vite picks up the writes and forces the
      // dev page to reload mid-execution, which is harmless for the case
      // itself but pollutes the log with [vite] page reload noise. We
      // also exclude the vite.config.ts.timestamp-*.mjs files that Vite
      // creates internally — tsx watch restarts on those otherwise.
      ignored: [
        '**/midscene_run/**',
        '**/midscene-reports/**',
        '**/vite.config.ts.timestamp-*.mjs',
      ],
    },
  },
});
