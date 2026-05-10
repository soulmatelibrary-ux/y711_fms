import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 7301,
        host: true,
        proxy: {
            '/api': {
                target: 'http://localhost:7300',
                changeOrigin: true
            }
        },
        allowedHosts: ['localhost', '127.0.0.1', 'ssenalabs.iptime.org', '.iptime.org', '*']
    },
    preview: {
        port: 7301,
        host: true,
        proxy: {
            '/api': {
                target: 'http://localhost:7300',
                changeOrigin: true
            }
        }
    },
    build: {
        outDir: 'dist'
    }
});
