import { defineConfig } from 'vite';

// Relative base so the build runs from any sub-path (GitHub Pages serves /<repo>/).
export default defineConfig({ base: './' });
