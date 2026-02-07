# 접속 문제 해결 가이드

**포트**: 7301 (외부 접속용)
**상태**: 접속 안 될 때 사용

---

## 🔍 단계별 진단

### **1단계: 서버 상태 확인**

```bash
# 진단 스크립트 실행
./diagnose.sh
```

**결과 확인**:
```
✅ 포트 7301 사용 중 → 서버가 실행 중
❌ 포트 7301 사용 가능 → 서버를 시작해야 함
```

### **2단계: 서버 시작**

```bash
# 방법 1: start.sh 사용 (권장)
./start.sh

# 방법 2: 직접 실행
npm run build
PORT=7301 node api-server.js
```

**확인사항**:
```
✅ "Y711 FMS API 서버 실행 중"이 보이면 성공
✅ http://localhost:7301/ 접속 가능 확인
```

### **3단계: 로컬 접속 테스트**

```bash
# 로컬에서 서버 응답 확인
curl http://localhost:7301/

# 또는 브라우저에서
open http://localhost:7301/
```

**예상 결과**:
```
✅ 로그인 페이지가 표시됨
❌ "Connection refused" → 서버가 실행 중이 아님
```

---

## 🌐 외부 접속 문제

### **문제 1: localhost는 되는데 외부 주소는 안 됨**

**원인**: 공유기 포트 포워딩이 설정되지 않음

**해결**:

1️⃣ **공유기 관리자 페이지 접속**
```
http://192.168.0.1  또는  http://192.168.1.1
```

2️⃣ **포트 포워딩 설정**
```
외부 포트:  7301
내부 포트:  7301
내부 IP:    192.168.x.x (현재 컴퓨터의 IP)
프로토콜:   TCP
```

3️⃣ **설정 저장 후 재시작**

4️⃣ **외부에서 테스트**
```
http://ssenalabs.iptime.org:7301/
```

---

### **문제 2: "포트 이미 사용 중" 오류**

```
Error: listen EADDRINUSE: address already in use :::7301
```

**해결 방법**:

```bash
# 방법 1: 기존 프로세스 종료
lsof -i :7301          # 어떤 프로세스가 점유 중인지 확인
kill -9 <PID>          # 프로세스 종료

# 방법 2: 다른 포트 사용
PORT=7302 node api-server.js

# 방법 3: 전체 프로세스 정리
pkill -f "node api-server"
pkill -f "vite"
```

---

### **문제 3: "연결이 거부되었습니다"**

```
Error: Connection refused
```

**확인 체크리스트**:

- [ ] 서버가 실행 중인가?
  ```bash
  lsof -i :7301
  # 결과가 없으면 서버 미실행 상태
  ```

- [ ] 올바른 포트를 사용 중인가?
  ```bash
  # 확인
  netstat -an | grep 7301
  ```

- [ ] 방화벽이 포트를 차단하지 않았는가?
  ```bash
  # macOS 방화벽 확인
  sudo pfctl -s state | grep 7301
  ```

- [ ] 외부 접속 허용이 설정되었는가?
  ```bash
  # vite.config.js에 host: true 확인
  # api-server.js에 HOST = '0.0.0.0' 확인
  ```

---

### **문제 4: 접속은 되지만 페이지가 안 열림**

**원인**: dist/ 폴더가 없음 (빌드 필요)

**해결**:

```bash
# 빌드 파일 생성
npm run build

# 또는
./start.sh  # 자동으로 빌드 포함
```

**확인**:
```bash
ls -la dist/
# index.html, login.html이 있어야 함
```

---

## 🛠️ 고급 진단

### **네트워크 연결 확인**

```bash
# 1. 인터넷 연결 확인
ping 8.8.8.8

# 2. 로컬 IP 확인
ifconfig | grep "inet " | grep -v 127.0.0.1

# 3. 포트 수신 확인
netstat -an | grep LISTEN | grep 7301

# 4. DNS 확인
nslookup ssenalabs.iptime.org

# 5. 원격 접속 테스트
curl -v http://ssenalabs.iptime.org:7301/
```

---

## 📋 체크리스트

### 로컬 접속 불가

- [ ] 서버 실행: `./start.sh` 또는 `npm run dev:7301`
- [ ] 포트 확인: `lsof -i :7301`
- [ ] 방화벽 확인: System Preferences → Security & Privacy
- [ ] 빌드 완료: `npm run build`
- [ ] URL 확인: `http://localhost:7301/`

### 외부 접속 불가

- [ ] 공유기 포트 포워딩 설정
  - 외부 포트: 7301
  - 내부 포트: 7301
  - IP: 192.168.x.x

- [ ] 서버 HOST 설정
  - api-server.js: `HOST = '0.0.0.0'` ✅

- [ ] Vite 설정
  - vite.config.js: `host: true` ✅

- [ ] CORS 설정
  - app.use(cors()) ✅

- [ ] 방화벽 설정
  - 외부 접속 허용 확인

---

## 📊 디버그 정보 수집

문제 보고할 때 다음 정보를 포함하세요:

```bash
# 1. 로그 캡처
./start.sh 2>&1 | tee server.log

# 2. 네트워크 정보
./diagnose.sh > diagnostic_report.txt

# 3. 프로세스 상태
lsof -i :7301 > port_status.txt

# 4. 공유기 설정 스크린샷
# (포트 포워딩 설정 화면)
```

---

## 🚀 빠른 해결 흐름

```
┌─────────────────────────────────────┐
│ 1. 진단 스크립트 실행               │
│    ./diagnose.sh                    │
└────────────┬────────────────────────┘
             │
    ┌────────▼─────────┐
    │ 포트 7301 사용?  │
    └────┬─────────┬───┘
         │         │
    YES  │         │  NO
        ▼         ▼
      ✅         ./start.sh
    외부접속?     │
     ↙  ↘       ▼
  YES  NO   로컬 접속 확인
   ↓   ↓     http://localhost:7301
  ✅  공유기
      포트포워딩
      설정
```

---

## 📞 문제 별 빠른 참조

| 문제 | 명령어 |
|------|--------|
| 서버 시작 | `./start.sh` |
| 포트 확인 | `lsof -i :7301` |
| 포트 종료 | `kill -9 <PID>` |
| 빌드 | `npm run build` |
| 진단 | `./diagnose.sh` |
| 다른 포트 사용 | `PORT=8080 node api-server.js` |

---

## ⚠️ 일반적인 실수

❌ **포트 포워딩 없이 외부 접속 시도**
- ✅ 공유기에서 포트 포워딩 설정 필요

❌ **localhost:7300으로 접속 시도**
- ✅ 7301 포트 사용 필요 (또는 `npm run dev`로 7300 사용)

❌ **dist/ 폴더 없음**
- ✅ `npm run build` 실행해서 빌드 파일 생성

❌ **서버는 실행되지만 페이지가 안 보임**
- ✅ 네트워크 탭에서 index.html 로딩 확인
- ✅ 브라우저 캐시 삭제 (Cmd+Shift+Delete)

---

## 🎯 최종 확인

```bash
# 1. 서버 시작
./start.sh

# 2. 로컬 접속 확인 (터미널에서)
curl http://localhost:7301/

# 3. 브라우저로 접속
# 로컬: http://localhost:7301/
# 외부: http://ssenalabs.iptime.org:7301/

# 4. 로그인 페이지가 표시되면 성공!
```

---

**여전히 문제가 있다면**:
1. `./diagnose.sh` 결과 확인
2. `server.log` 파일 확인
3. 공유기 포트 포워딩 설정 재확인

🔧 추가 지원이 필요하면 diagnostic_report.txt 파일을 확인하세요!
