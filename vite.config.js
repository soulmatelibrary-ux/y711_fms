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
        port: 7300,
        host: true,
        // 모든 네트워크 인터페이스에서 수신
        middlewareMode: false,
        // CORS 및 외부 접속 허용
        allowedHosts: [
            'localhost',
            '127.0.0.1',
            'ssenalabs.iptime.org',
            '.iptime.org',
            '*'  // 모든 호스트 허용 (개발 환경용)
        ]
    },
    preview: {
        port: 7300,
        host: true,
        allowedHosts: [
            'localhost',
            '127.0.0.1',
            'ssenalabs.iptime.org',
            '.iptime.org',
            '*'
        ]
    }
})
