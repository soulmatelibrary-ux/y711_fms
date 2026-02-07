# Y711 FMS 프로덕션 배포 가이드

**포트**: 7300
**환경**: Node.js + Express
**빌드**: Vite (프로덕션 최적화)

---

## 🚀 빠른 시작

### 방법 1: 프로덕션 서버 실행 (권장)

```bash
# 1. 프로덕션 빌드 생성 + 서버 실행
npm run serve

# 또는 분리해서 실행
npm run build        # 빌드 생성
npm run prod         # 포트 7300에서 서버 실행
```

**확인**:
```
http://localhost:7300/
```

### 방법 2: 개발 서버 (개발 중)

```bash
# Vite 개발 서버 (HMR 포함)
npm run dev

# 확인
http://localhost:7300/
```

### 방법 3: 프로덕션 빌드 미리보기

```bash
# 프로덕션 빌드 생성 후 미리보기
npm run preview

# 확인
http://localhost:7300/
```

---

## 📁 프로덕션 구조

```
y711_fms/
├── dist/                    # 프로덕션 빌드 산출물
│   ├── index.html          # 메인 페이지
│   ├── login.html          # 로그인 페이지
│   └── assets/             # JS, CSS 번들
├── public/                 # 정적 파일
├── src/                    # 소스 코드
├── api-server.js          # Express 서버 (포트 7300)
├── package.json           # npm 스크립트
├── .env                   # 환경 변수 (포트 7300)
└── vite.config.js         # Vite 설정
```

---

## 🔧 npm 스크립트

| 명령어 | 목적 | 포트 |
|--------|------|------|
| `npm run dev` | 개발 서버 (HMR) | 7300 |
| `npm run build` | 프로덕션 빌드 생성 | - |
| `npm run preview` | 빌드된 파일 미리보기 | 7300 |
| `npm run serve` | 빌드 + 서버 실행 | 7300 |
| `npm run prod` | 프로덕션 서버 실행 | 7300 |
| `npm start` | API 서버 실행 | 7300 (.env PORT) |

---

## 🌍 포트 7300 설정

### Express 서버 (api-server.js)

```javascript
const PORT = process.env.PORT || 7300;

app.listen(PORT, () => {
    console.log(`✈️  Y711 FMS API 서버 실행 중: http://localhost:${PORT}`);
});
```

### Vite 설정 (vite.config.js)

```javascript
server: {
    port: 7300,
    allowedHosts: ['localhost', '127.0.0.1']
},
preview: {
    port: 7300
}
```

### 환경 변수 (.env)

```
PORT=7300
FRONTEND_URL=http://localhost:7300
NODE_ENV=development
```

---

## 📊 배포 흐름

### 개발 중

```bash
npm run dev
# → Vite 개발 서버 실행
# → 포트 7300에서 HMR(핫 모듈 리로딩) 활성화
# → 코드 변경 시 자동 새로고침
```

### 배포 전

```bash
npm run build
# → dist/ 폴더에 최적화된 파일 생성
# → 프로덕션용 번들 생성 (minified, chunked)
# → 파일 크기 확인
```

### 배포 후

```bash
npm run serve
# 또는
npm run prod
# → Express 서버 실행
# → dist/ 폴더의 정적 파일 서빙
# → API 엔드포인트 제공
# → 포트 7300에서 서비스
```

---

## 🔐 프로덕션 환경 설정

### .env.production 생성 (선택사항)

```bash
# .env.production
PORT=7300
NODE_ENV=production
FRONTEND_URL=https://your-domain.com
ENABLE_HTTPS=true
SSL_KEY_PATH=/path/to/key.pem
SSL_CERT_PATH=/path/to/cert.pem
```

### 환경 변수 로드

```bash
# .env 파일 로드 (dotenv 사용)
node -r dotenv/config api-server.js
```

---

## 📈 성능 최적화

### 프로덕션 빌드 분석

```bash
# 번들 크기 확인
npm run build
# 출력:
# dist/index.html                 49.65 kB │ gzip:  8.97 kB
# dist/assets/style-*.css         35.20 kB │ gzip:  6.89 kB
# dist/assets/main-*.js           46.20 kB │ gzip: 15.79 kB
```

### 최적화 팁

- ✅ Vite는 자동으로 코드 분할
- ✅ CSS, JS 자동 minification
- ✅ 동적 import 지원
- ✅ 이미지 자동 최적화

---

## 🐳 Docker 배포 (선택사항)

### Dockerfile 예제

```dockerfile
FROM node:18-alpine

WORKDIR /app

# 의존성 설치
COPY package*.json ./
RUN npm ci --only=production

# 빌드
COPY . .
RUN npm run build

# 포트 노출
EXPOSE 7300

# 서버 실행
CMD ["npm", "run", "prod"]
```

### Docker 실행

```bash
# 이미지 빌드
docker build -t y711-fms:latest .

# 컨테이너 실행
docker run -p 7300:7300 y711-fms:latest
```

---

## ✅ 배포 체크리스트

배포 전 확인 사항:

- [ ] `npm run build` 성공 (0 errors)
- [ ] `dist/` 폴더 파일 생성 확인
- [ ] `.env` 파일에서 PORT=7300 확인
- [ ] `npm run serve` 또는 `npm run prod` 실행
- [ ] `http://localhost:7300` 접속 확인
- [ ] 로그인 페이지 표시 확인
- [ ] 주요 기능 테스트 완료
- [ ] 브라우저 콘솔 에러 확인
- [ ] 프로덕션 환경 변수 설정 (필요시)

---

## 🚨 문제 해결

### 포트 7300이 이미 사용 중

```bash
# 포트 변경
PORT=8080 npm run prod

# 또는 프로세스 종료
lsof -i :7300
kill -9 <PID>
```

### 빌드 실패

```bash
# 의존성 재설치
rm -rf node_modules package-lock.json
npm install

# 빌드 재시도
npm run build
```

### 정적 파일 404 에러

```javascript
// api-server.js에 SPA 라우팅 확인
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});
```

---

## 📊 서버 모니터링

### 로그 확인

```bash
# 서버 출력 보기
npm run prod

# 예상 출력:
# ✈️  Y711 FMS API 서버 실행 중: http://localhost:7300
# 📊 DB 연결 테스트: http://localhost:7300/api/db/test
```

### 상태 확인

```bash
# 서버 상태 확인
curl http://localhost:7300/

# API 상태 확인
curl http://localhost:7300/api/flights?airports=RKSS,RKTU&date=2026-02-07
```

---

## 🔄 CI/CD 통합 (선택사항)

### GitHub Actions 예제

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'

      - run: npm install
      - run: npm run build
      - run: npm run prod &
```

---

## 📞 지원

### 포트 관련 문제

- **개발**: `npm run dev` → 포트 7300 (Vite)
- **프로덕션**: `npm run serve` → 포트 7300 (Express)
- **미리보기**: `npm run preview` → 포트 7300 (Vite)

### 포트 변경하기

```bash
# 임시 변경
PORT=8080 npm run prod

# 영구 변경
# .env 파일에서 PORT=7300 변경
```

---

**배포 준비 완료**: ✅ 언제든지 `npm run serve`로 시작할 수 있습니다!
