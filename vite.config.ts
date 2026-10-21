import { defineConfig } from 'vite';

// A new id every build: the page compares it with version.json to spot a newer deploy.
const build = Date.now().toString(36);

// Relative base so the build runs from any sub-path (GitHub Pages serves /<repo>/).
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(build) },
  plugins: [{
    name: 'version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build }) });
    },
  }],
});
