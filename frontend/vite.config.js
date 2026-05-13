import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Map CRA-style env var to Vite env so VotingApp.jsx works unchanged
  define: {
    // Set to empty so VotingApp.jsx falls back to window.location.host dynamically
    'process.env.REACT_APP_API_URL': JSON.stringify(
      process.env.VITE_API_URL || ''
    )
  },
  build: {
    outDir: 'build',          // match what Apache serves from
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
}));
