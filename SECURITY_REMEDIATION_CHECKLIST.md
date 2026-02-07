# Y711 FMS Security Remediation Checklist

## 🔴 CRITICAL PRIORITY (Must Complete Before Production Deployment)

### Authentication & Credentials Management

- [x] **Remove Hardcoded Default Credentials** ✅ COMPLETED 2026-02-07
  - [x] Delete password from source code comments (auth.js:7-8)
  - [x] Remove DEFAULT_USER.defaultPassword constant
  - [x] Store default password in .env file
  - [x] Implement environment variable loading in auth.js
  - [x] Test that login works with env variable password (DevPass123!)
  - [x] Document password in secure location (.env file)
  - **Files**: `public/auth.js`, `.env`, `.env.example`
  - **Commit**: e7c576f

- [x] **Implement Secure Session Management** ✅ COMPLETED 2026-02-07
  - [x] Add session timeout: 30 minutes of inactivity
  - [x] Implement session.expiresAt = now + 30min in completeLogin()
  - [x] Add startSessionTimeoutCheck() function
  - [x] Call setupActivityTracking() on every page
  - [x] Implement auto-logout on session expiration
  - [x] Store session expiration time in localStorage
  - [x] Test: Session expires after 30min inactivity
  - [x] Test: Auto-logout when expiration reached
  - **Files**: `public/auth.js`, `index.html`, `src/main.js`
  - **Commit**: a703277

- [ ] **Remove localStorage for Password Storage**
  - [ ] Move password hash to backend session storage
  - [ ] Implement /api/auth/verify endpoint (backend)
  - [ ] Remove localStorage.setItem('y711_password_hash')
  - [ ] Implement backend password verification instead
  - [ ] Test: Password change still works
  - [ ] Test: Login validation happens on server
  - **Files**: `public/auth.js`, `api-server.js`

### API Security

- [ ] **Add Authentication to All API Endpoints**
  - [ ] Create JWT token generation function
  - [ ] Create authenticateToken middleware
  - [ ] Add authenticateToken to GET /api/flights
  - [ ] Add authenticateToken to POST /api/ctot
  - [ ] Add authenticateToken to GET /api/airports
  - [ ] Add authenticateToken to GET /api/db/test
  - [ ] Test: API returns 401 without token
  - [ ] Test: API returns 401 with invalid token
  - [ ] Test: API works with valid token
  - **Files**: `api-server.js`

- [ ] **Implement JWT Token System**
  - [ ] Install jsonwebtoken package: `npm install jsonwebtoken`
  - [ ] Create JWT_SECRET in .env file
  - [ ] Create generateToken(userId) function
  - [ ] Create verifyToken(token) function
  - [ ] Add /api/auth/login endpoint
  - [ ] Add /api/auth/logout endpoint
  - [ ] Add /api/auth/refresh endpoint (for token refresh)
  - [ ] Test: Token generation works
  - [ ] Test: Token verification works
  - [ ] Test: Token expiration works (1 hour default)
  - **Files**: `api-server.js`

- [ ] **Restrict CORS Origins**
  - [ ] Change `cors()` to `cors({ origin: process.env.FRONTEND_URL })`
  - [ ] Add FRONTEND_URL to .env file
  - [ ] Set FRONTEND_URL = 'http://localhost:5173' (dev) / 'https://your-domain.com' (prod)
  - [ ] Test: Requests from allowed origin succeed
  - [ ] Test: Requests from other origins fail (403 Forbidden)
  - **Files**: `api-server.js`

- [ ] **Sanitize Error Messages**
  - [ ] Remove error.message from API responses
  - [ ] Replace with generic error: "Internal server error"
  - [ ] Log full error details to server logs only
  - [ ] Test: Error response doesn't contain SQL/system info
  - [ ] Update all error handlers in api-server.js
  - **Files**: `api-server.js`

### Data Protection

- [ ] **Enable HTTPS/TLS**
  - [ ] Install SSL certificate (Let's Encrypt recommended)
  - [ ] Configure HTTPS in Express:
    ```javascript
    const https = require('https');
    const fs = require('fs');
    const options = {
      key: fs.readFileSync('path/to/key.pem'),
      cert: fs.readFileSync('path/to/cert.pem')
    };
    https.createServer(options, app).listen(443);
    ```
  - [ ] Redirect HTTP to HTTPS
  - [ ] Test: HTTPS works on port 443
  - [ ] Test: HTTP redirects to HTTPS
  - [ ] Verify SSL certificate validity
  - **Files**: `api-server.js`

- [ ] **Input Validation & SQL Injection Prevention**
  - [ ] Review all user inputs in api-server.js
  - [ ] Verify all queries use parameterized statements
  - [ ] Add input validation for airports parameter
  - [ ] Add input validation for date parameter (YYYY-MM-DD format)
  - [ ] Test: SQL injection attempts are blocked
  - [ ] Test: Valid inputs work correctly
  - **Files**: `api-server.js`

### Audit Logging

- [ ] **Implement Comprehensive Audit Logging**
  - [ ] Create auditLog.info() function
  - [ ] Create auditLog.error() function
  - [ ] Create auditLog.warn() function
  - [ ] Log all API calls: timestamp, user, endpoint, parameters
  - [ ] Log all CTOT modifications: old value, new value, user
  - [ ] Log all login attempts: success/failure, username, IP address
  - [ ] Log all password changes: username, timestamp
  - [ ] Store logs in database table: AUDIT_LOGS
  - [ ] Test: Audit logs are recorded for all operations
  - **Files**: `api-server.js`, database schema

- [ ] **Create Audit Log Database Table**
  - [ ] CREATE TABLE AUDIT_LOGS with columns:
    ```sql
    id (PRIMARY KEY, UUID)
    user_id (FOREIGN KEY to USERS)
    action (VARCHAR: LOGIN, LOGOUT, CTOT_CHANGE, PASSWORD_CHANGE)
    resource (VARCHAR: flights, ctot, users)
    old_value (JSON - for modifications)
    new_value (JSON - for modifications)
    timestamp (TIMESTAMP with timezone)
    ip_address (VARCHAR)
    user_agent (VARCHAR)
    ```
  - [ ] Create index on user_id, timestamp, action
  - [ ] Test: Audit table stores records correctly
  - [ ] Test: Query audit logs by user/date works
  - **Files**: Database migration script

---

## 🟠 HIGH PRIORITY (Complete Within 1 Week)

### User Management

- [ ] **Implement Multi-User Account System**
  - [ ] Create USERS table:
    ```sql
    id (PRIMARY KEY, UUID)
    username (UNIQUE, VARCHAR)
    email (UNIQUE, VARCHAR)
    password_hash (VARCHAR - SHA-256 or bcrypt)
    role (ENUM: admin, operator, supervisor)
    is_active (BOOLEAN, default true)
    created_at (TIMESTAMP)
    updated_at (TIMESTAMP)
    last_login (TIMESTAMP)
    ```
  - [ ] Create migration script for table
  - [ ] Implement createUser(username, email, password, role)
  - [ ] Implement updateUser(userId, fields)
  - [ ] Implement deleteUser(userId) - soft delete
  - [ ] Implement getUserByUsername(username)
  - [ ] Test: User creation works
  - [ ] Test: User update works
  - [ ] Test: User deletion works
  - **Files**: Database migration, api-server.js

- [ ] **Implement Role-Based Access Control (RBAC)**
  - [ ] Define roles:
    - admin: All permissions
    - supervisor: View logs, approve CTOT, view flights
    - operator: Propose CTOT, view assigned flights
  - [ ] Create middleware: authorizeRole(requiredRole)
  - [ ] Add role check to each endpoint
  - [ ] GET /api/flights: operator, supervisor, admin
  - [ ] POST /api/ctot: operator, admin (with approval workflow)
  - [ ] GET /api/audit-logs: supervisor, admin
  - [ ] Admin APIs: admin only
  - [ ] Test: Unauthorized roles get 403 Forbidden
  - [ ] Test: Authorized roles get 200 OK
  - **Files**: `api-server.js`

- [ ] **Implement Password Management System**
  - [ ] Use bcrypt for password hashing: `npm install bcrypt`
  - [ ] Hash password on user creation: `bcrypt.hash(password, 10)`
  - [ ] Hash password on password change
  - [ ] Compare password on login: `bcrypt.compare(password, hash)`
  - [ ] Require password change on first login
  - [ ] Implement password reset via email
  - [ ] Implement password history (prevent reuse of last 5 passwords)
  - [ ] Test: Passwords are hashed, not stored in plaintext
  - [ ] Test: Password comparison works correctly
  - **Files**: `api-server.js`

### Database Security

- [ ] **Implement Database Encryption at Rest**
  - [ ] Enable Oracle Database encryption:
    ```sql
    ALTER SYSTEM SET db_recovery_file_dest='your_location' SCOPE=BOTH;
    ALTER DATABASE ARCHIVELOG;
    EXEC DBMS_REDACT.ENABLE_POLICY(policy_name => 'REDACT_SENSITIVE');
    ```
  - [ ] Or use filesystem encryption (BitLocker, LUKS)
  - [ ] Test: Data is encrypted on disk
  - [ ] Document encryption setup
  - **Files**: Database configuration

- [ ] **Implement Database Credentials Management**
  - [ ] Remove credentials from api-server.js
  - [ ] Store credentials in .env file
  - [ ] Load .env file with dotenv package: `npm install dotenv`
  - [ ] Use environment variables: process.env.ORACLE_USER
  - [ ] Create separate .env.example (without actual values)
  - [ ] Add .env to .gitignore
  - [ ] Test: Connection works with env variables
  - [ ] Test: .env file is not committed to git
  - **Files**: `.env`, `.env.example`, `api-server.js`

- [ ] **Create Database Backup Strategy**
  - [ ] Implement daily automated backups
  - [ ] Store backups in separate location (AWS S3, network drive)
  - [ ] Test: Backup can be restored
  - [ ] Create backup retention policy (30 days)
  - [ ] Document backup procedure
  - [ ] Create disaster recovery plan
  - **Files**: Backup scripts, documentation

### API Rate Limiting

- [ ] **Implement Rate Limiting**
  - [ ] Install express-rate-limit: `npm install express-rate-limit`
  - [ ] Create rate limiter: 100 requests per minute per IP
  - [ ] Apply to all API endpoints
  - [ ] Different limits for different endpoints:
    - GET /api/flights: 60 req/min
    - POST /api/ctot: 30 req/min
    - /api/auth/login: 5 req/min
  - [ ] Store rate limit data in Redis (if available) or memory
  - [ ] Test: Exceeding limit returns 429 Too Many Requests
  - [ ] Test: Legitimate requests succeed
  - **Files**: `api-server.js`

### Monitoring & Alerts

- [ ] **Implement Error Logging**
  - [ ] Install Winston logger: `npm install winston`
  - [ ] Create logger with file transport
  - [ ] Log level: error, warn, info, debug
  - [ ] Log to separate files: error.log, app.log
  - [ ] Rotate logs daily (winston-daily-rotate-file)
  - [ ] Test: Errors are logged to file
  - **Files**: `api-server.js`

- [ ] **Implement Security Event Alerting**
  - [ ] Alert on: Failed login attempts (>3 in 5min)
  - [ ] Alert on: CTOT modifications
  - [ ] Alert on: API errors
  - [ ] Alert on: Rate limit exceeded
  - [ ] Send alerts to admin email
  - [ ] Implement Slack webhook for alerts (optional)
  - [ ] Test: Alerts are sent correctly
  - **Files**: `api-server.js`

---

## 🟡 MEDIUM PRIORITY (Complete Within 1 Month)

### Advanced Authentication

- [ ] **Implement Two-Factor Authentication (2FA)**
  - [ ] Install speakeasy: `npm install speakeasy qrcode`
  - [ ] Generate 2FA secret on user account creation
  - [ ] Display QR code for Google Authenticator/Authy
  - [ ] Verify 2FA code on login
  - [ ] Allow backup codes for recovery
  - [ ] Test: 2FA generation works
  - [ ] Test: 2FA verification works
  - [ ] Test: Recovery codes work
  - **Files**: `api-server.js`

- [ ] **Implement Session Management Dashboard**
  - [ ] Create /api/sessions endpoint to list active sessions
  - [ ] Allow users to revoke specific sessions
  - [ ] Allow admins to revoke user sessions
  - [ ] Track session: IP address, user agent, last activity
  - [ ] Test: Sessions can be viewed
  - [ ] Test: Sessions can be revoked
  - **Files**: `api-server.js`, `index.html` (admin dashboard)

### Data Protection

- [ ] **Implement Data Masking in Logs**
  - [ ] Mask sensitive data in audit logs:
    - Callsigns: Show first 2 chars only (AAL***)
    - Timestamps: Show date only (2026-02-07, not 23:45:30)
    - User names: Show user ID only, not email
  - [ ] Create maskSensitiveData() function
  - [ ] Apply to all audit logs
  - [ ] Test: Logs don't contain sensitive details
  - **Files**: `api-server.js`

- [ ] **Implement Data Export Controls**
  - [ ] Disable CSV/Excel export of sensitive data
  - [ ] Create /api/flights/export endpoint with:
    - Authentication required
    - Role check (supervisor+ only)
    - Audit logging
    - Rate limiting
    - Data masking (optional callsigns/times)
  - [ ] Log all data exports
  - [ ] Test: Only authorized users can export
  - [ ] Test: Exports are logged
  - **Files**: `api-server.js`

### Compliance & Documentation

- [ ] **Create Security Documentation**
  - [ ] Write Security Policy document
  - [ ] Write Data Classification document
  - [ ] Write Incident Response Plan
  - [ ] Write Password Policy
  - [ ] Write Access Control Policy
  - [ ] Write Audit Log Retention Policy
  - **Files**: Documentation folder

- [ ] **Create Administrator Guide**
  - [ ] Write user management procedures
  - [ ] Write system administration procedures
  - [ ] Write backup & recovery procedures
  - [ ] Write monitoring & alerting procedures
  - [ ] Write incident response procedures

- [ ] **Create Operator Guide**
  - [ ] Write quick start guide
  - [ ] Write CTOT modification procedures
  - [ ] Write password change procedures
  - [ ] Write security best practices
  - [ ] Translate to Korean

### Testing & Validation

- [ ] **Conduct Penetration Testing**
  - [ ] Hire external security firm OR
  - [ ] Conduct internal white-box testing
  - [ ] Test: All OWASP Top 10 vulnerabilities
  - [ ] Test: SQL injection
  - [ ] Test: XSS attacks
  - [ ] Test: CSRF attacks
  - [ ] Test: Authentication bypass
  - [ ] Test: Authorization bypass
  - [ ] Document findings and fixes
  - [ ] Fix all identified vulnerabilities

- [ ] **Perform Security Compliance Audit**
  - [ ] Review against FAA requirements
  - [ ] Review against EASA requirements
  - [ ] Review against ICAO Annex 3
  - [ ] Review against GDPR (if applicable)
  - [ ] Document compliance status
  - [ ] Create remediation plan for non-compliance

---

## 📋 ONGOING (Continuous)

- [ ] **Regular Security Updates**
  - [ ] Check npm vulnerabilities: `npm audit`
  - [ ] Update dependencies monthly: `npm update`
  - [ ] Review security advisories weekly
  - [ ] Patch critical vulnerabilities immediately
  - **Tools**: npm audit, dependabot

- [ ] **Access Control Review**
  - [ ] Review user access quarterly
  - [ ] Remove inactive users
  - [ ] Verify role assignments
  - [ ] Check for privilege escalation
  - [ ] Document access changes

- [ ] **Audit Log Review**
  - [ ] Review audit logs weekly
  - [ ] Check for suspicious activity
  - [ ] Verify CTOT change authorization
  - [ ] Check for unauthorized access attempts
  - [ ] Archive old logs (>30 days)

- [ ] **Backup Verification**
  - [ ] Test backup restoration monthly
  - [ ] Verify backup integrity
  - [ ] Check backup storage location
  - [ ] Update disaster recovery plan

- [ ] **Security Training**
  - [ ] Train operators on password security
  - [ ] Train operators on phishing risks
  - [ ] Conduct annual security awareness training
  - [ ] Document training attendance

---

## 🎯 DEPLOYMENT CHECKLIST

### Before Production Go-Live

- [ ] All CRITICAL items completed
- [ ] All HIGH items completed
- [ ] Penetration testing passed
- [ ] Compliance audit passed
- [ ] Security documentation reviewed
- [ ] Operator training completed
- [ ] Backup & recovery tested
- [ ] Monitoring & alerting configured
- [ ] Incident response plan approved
- [ ] Legal/compliance sign-off obtained

### Post-Deployment

- [ ] Monitor error logs for 24 hours
- [ ] Monitor audit logs for suspicious activity
- [ ] Verify all functionality works with live data
- [ ] Conduct post-deployment review meeting
- [ ] Update documentation with lessons learned
- [ ] Plan security improvement roadmap

---

## 📊 Progress Tracking

**Total Tasks**: 97
**Completed**: 2 ✅ (Remove Hardcoded Credentials, Implement Session Timeout)
**In Progress**: 0
**Not Started**: 95

**Status by Priority**:
- 🔴 CRITICAL: 2/18 (11.1%) ✅ Credentials, Session Timeout
- 🟠 HIGH: 0/23 (0%)
- 🟡 MEDIUM: 0/18 (0%)
- 📋 ONGOING: 0/25 (0%)
- 🎯 DEPLOYMENT: 0/10 (0%)

**Completion Timeline**:
- Start Date: 2026-02-07
- Progress: 2 items in 1 day (5-6 hours)
- Estimated Remaining: 30-35 hours
- **Estimated Completion**: 2026-02-18 (10 days at 5-6 hours/day)

---

## 📝 Notes

- Keep this checklist updated as work progresses
- Mark items complete with actual date
- Link to PR/commit when task is completed
- Update progress percentage weekly
- Review with security team bi-weekly

**Last Updated**: 2026-02-07
**Status**: Not Started
