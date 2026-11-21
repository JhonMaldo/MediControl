import { defineConfig } from 'vite';

const proxy = {
  '/api/vitalwatch/analyze': {
    target: process.env.N8N_ORIGIN || 'http://127.0.0.1:5678',
    rewrite: () => '/webhook/vitalwatch-analyze',
  },
  '/api/pronostico': {
    target: process.env.PRONOSTICO_API_ORIGIN || 'http://127.0.0.1:8092',
  },
};

export default defineConfig({
  server: { proxy },
  preview: { proxy },
});
