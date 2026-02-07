# 포트 설정 가이드 (7300 / 7301)

**현재 설정**: 로컬 7300 / 외부 7301

---

## 🌐 접속 방법

### 로컬에서 (같은 컴퓨터)
```
http://localhost:7300/
```

### 외부에서 (공유기를 통해)
```
http://ssenalabs.iptime.org:7301/
```

---

## 📋 실행 방법

### 방법 1️⃣: start.sh 사용 (권장)

```bash
chmod +x start.sh
./start.sh

# 자동으로 포트 7301에서 시작됨
# ✅ http://localhost:7301
# ✅ http://ssenalabs.iptime.org:7301/
```

### 방법 2️⃣: npm 명령어

#### 로컬 개발 (포트 7300)
```bash
npm run dev
# http://localhost:7300/
```

#### 외부 접속 (포트 7301)
```bash
npm run dev:7301
# http://localhost:7301/
# http://ssenalabs.iptime.org:7301/
```

#### 프로덕션 (포트 7300)
```bash
npm run serve
# npm run build + npm run prod
# http://localhost:7300/
```

#### 프로덕션 (포트 7301)
```bash
npm run build && npm run prod:7301
# http://localhost:7301/
# http://ssenalabs.iptime.org:7301/
```

---

## 🔧 포트 설정 상세

### npm 스크립트 (package.json)

| 스크립트 | 포트 | 용도 |
|---------|------|------|
| `npm run dev` | 7300 | 로컬 개발 |
| `npm run dev:7301` | 7301 | 외부 테스트 |
| `npm run preview` | 7300 | 프로덕션 미리보기 |
| `npm run prod` | 7300 | 프로덕션 서버 |
| `npm run prod:7301` | 7301 | 프로덕션 (외부) |

### 환경 변수

```bash
# 포트 변경
PORT=7301 npm run start

# 또는
PORT=7301 node api-server.js
```

### vite.config.js

```javascript
server: {
    port: 7300,
    allowedHosts: ['ssenalabs.iptime.org', 'localhost', '127.0.0.1']
}
```

---

## 🚀 start.sh 분석

```bash
#!/bin/bash

# 의존성 설치
npm install (필요시)

# 포트 7301에서 실행
npx vite --port 7301 --host

# --host: 외부 접속 허용
# --port 7301: 포트 7301 사용
```

---

## 📱 접속 테스트

### 로컬
```bash
# 터미널에서
curl http://localhost:7301/

# 또는 브라우저
open http://localhost:7301/
```

### 원격 (외부 네트워크)
```
http://ssenalabs.iptime.org:7301/
```

---

## ⚙️ 공유기 포트 포워딩 설정

만약 포트를 통일하고 싶다면:

### 방법 A: 외부 포트를 7300으로 통일

**공유기 설정**:
```
외부 포트: 7300
내부 포트: 7300
로컬 IP: 192.168.x.x
```

**실행**:
```bash
./start.sh  # 수정 필요
npm run dev
```

**접속**:
```
http://localhost:7300/
http://ssenalabs.iptime.org:7300/  # 동일
```

### 방법 B: 외부 포트를 7301로 유지 (현재 설정)

**공유기 설정**:
```
외부 포트: 7301
내부 포트: 7301
로컬 IP: 192.168.x.x
```

**실행**:
```bash
./start.sh  # 또는 npm run dev:7301
```

**접속**:
```
http://localhost:7301/
http://ssenalabs.iptime.org:7301/
```

---

## 🔄 포트 변경하기

### 포트 7301 → 8080으로 변경

**방법 1: 일시적으로**
```bash
PORT=8080 npm run dev
```

**방법 2: start.sh 수정**
```bash
# start.sh 에서
npx vite --port 8080 --host
```

**방법 3: 공유기 포트 포워딩 변경**
```
외부 포트: 8080
내부 포트: 8080
```

---

## ✅ 현재 설정 확인

```bash
# 실행 중인 포트 확인
lsof -i :7300    # 7300 포트 사용 여부
lsof -i :7301    # 7301 포트 사용 여부

# 또는
netstat -an | grep 7300
netstat -an | grep 7301
```

---

## 📊 포트 사용 현황

| 포트 | 용도 | 상태 |
|------|------|------|
| 7300 | 개발 서버 | ✅ 설정됨 |
| 7301 | 외부 접속 | ✅ 설정됨 |
| 3000 | API 서버 | ⚠️ 미사용 |

---

## 🎯 권장 설정

### 개발 환경
```bash
npm run dev
# http://localhost:7300/
```

### 외부 테스트
```bash
npm run dev:7301
# http://localhost:7301/
# http://ssenalabs.iptime.org:7301/
```

### 프로덕션
```bash
npm run serve
# 또는
npm run build && npm run prod:7301
```

---

## 💡 팁

### 포트가 이미 사용 중일 때
```bash
# macOS에서 포트 종료
lsof -i :7301
kill -9 <PID>

# 또는 다른 포트 사용
PORT=7302 npm run dev
```

### EADDRINUSE 오류
```
Error: listen EADDRINUSE: address already in use :::7301

해결:
1. 기존 프로세스 종료
2. 또는 다른 포트 사용: PORT=7302 npm run dev
3. 또는 Vite 자동 재시도: vite --port 0 (자동 할당)
```

---

## 📞 빠른 참조

```bash
# 로컬 개발 (7300)
npm run dev

# 외부 테스트 (7301)
npm run dev:7301

# 시작 스크립트 (7301)
./start.sh

# 프로덕션 (7300)
npm run prod

# 프로덕션 (7301)
npm run prod:7301
```

---

**현재 설정**:
- ✅ 내부: 7300
- ✅ 외부: 7301
- ✅ start.sh: 7301

언제든지 포트를 변경할 수 있습니다! 🚀
