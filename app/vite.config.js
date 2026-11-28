import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// On Windows, Vite 7 cannot build a page with an inline <style> in index.html (the logo loader's) when the terminal's folder starts
// with a lowercase drive letter ("c:\..."; VS Code terminals often do). Giving it the folder with a capital letter avoids that.
const root = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase());

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
