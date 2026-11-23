import { defineConfig } from 'vite';

const proxy = {
  '/api/inasistencia': {
    target: process.env.CITAS_API_ORIGIN || 'http://127.0.0.1:8091',
  },
  '/api/vitalwatch/analyze': {
    target: process.env.N8N_ORIGIN || 'http://127.0.0.1:5678',
    rewrite: () => '/webhook/vitalwatch-analyze',
  },
};

export default defineConfig({
  server: { proxy },
  preview: { proxy },
});
