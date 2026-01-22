import { defineConfig } from 'vite'

export default defineConfig({
    build: {
        rollupOptions: {
            external: [],
        },
    },
    optimizeDeps: {
        exclude: ['sql.js']
    },
    server: {
        port: 7300
    },
    preview: {
        port: 7300
    }
})
