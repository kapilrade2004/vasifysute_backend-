# 🛡️ Master Admin Module Documentation

The **Master Admin Module** is an isolated, platform-owner layer in VasifyTech Suite (`vt-suite-backend`) that operates independently of tenant-level user accounts. It provides cross-tenant administration, company lifecycle control, billing oversight, and security audit logging.

---

## 🔐 Security & Authentication Flow

1. **Distinct JWT Signing**:
   - Master Admin JWT tokens are signed using the `ADMIN_JWT_SECRET` environment variable (strictly isolated from tenant `JWT_SECRET`).
   - Tokens expire after **4 hours**.

2. **Distinct Token Storage**:
   - Master Admin tokens must be stored on the client under `admin_token` (and `admin_user`), **never** under tenant `auth_token` or `token` keys.

3. **Rate Limiting**:
   - `POST /api/admin/login` is rate-limited to **5 attempts per 15 minutes** per IP address to prevent brute-force attacks.

4. **Transactional Audit Logging**:
   - Every mutating endpoint (e.g. company suspension, soft deletion) records an immutable entry in `admin_audit_logs` within the **same MySQL transaction**.

---

## 🗄️ Database Schema & Migrations

### 1. `admins` Table
Stores platform super admins and support admins:
```sql
CREATE TABLE admins (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('super_admin', 'support_admin') NOT NULL DEFAULT 'super_admin',
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 2. `admin_audit_logs` Table
Tracks every action executed by platform admins:
```sql
CREATE TABLE admin_audit_logs (
  id VARCHAR(36) PRIMARY KEY,
  admin_id VARCHAR(36) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(100) NOT NULL,
  target_id VARCHAR(100) NULL,
  meta JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);
```

---

## 🛠️ CLI Commands & Setup

### 1. Run Migration
Execute the migration script to create `admins` and `admin_audit_logs` tables without touching tenant data:
```bash
npm run migrate:admin
```

### 2. Seed Initial Super Admin Account
Seed the initial super admin from environment variables (`ADMIN_INITIAL_EMAIL`, `ADMIN_INITIAL_PASSWORD`, `ADMIN_INITIAL_NAME`):
```bash
npm run seed:admin
```

### 3. How to Create Additional Super Admin Accounts
You can create additional super admin accounts via command line using the seed helper script or via SQL insertion:
```bash
# Set environment variables for the new admin
ADMIN_INITIAL_EMAIL="security.admin@vasifytech.com" ADMIN_INITIAL_PASSWORD="SecurePassword2026!" ADMIN_INITIAL_NAME="Security Admin" npm run seed:admin
```

---

## 📡 API Endpoints

| Endpoint | Method | Guard | Description |
| :--- | :--- | :--- | :--- |
| `/api/admin/login` | POST | `loginRateLimiter` | Authenticates master admin & returns 4h JWT token |
| `/api/admin/stats` | GET | `verifyAdminToken`, `super_admin` | Cached (60s) aggregate platform telemetry |
| `/api/admin/companies` | GET | `verifyAdminToken`, `super_admin` | Paginated list of tenant companies |
| `/api/admin/companies/:id` | GET | `verifyAdminToken`, `super_admin` | Single company details & invoice metrics |
| `/api/admin/companies/:id/suspend` | PUT | `verifyAdminToken`, `super_admin` | Suspends tenant company (with Audit Log) |
| `/api/admin/companies/:id/delete` | DELETE | `verifyAdminToken`, `super_admin` | Soft deletes tenant company (with Audit Log) |
| `/api/admin/invoices` | GET | `verifyAdminToken`, `super_admin` | Cross-tenant invoice audit directory |
| `/api/admin/tickets` | GET | `verifyAdminToken`, `super_admin` | Cross-tenant support queue |
| `/api/admin/audit-logs` | GET | `verifyAdminToken`, `super_admin` | Filterable audit log entries |
