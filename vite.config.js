import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                login: resolve(__dirname, 'login.html')
            }
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
