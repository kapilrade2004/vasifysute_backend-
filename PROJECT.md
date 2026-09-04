# 🚀 VASIFY SUITE — COMPLETE MODULAR SAAS PLATFORM ARCHITECTURE

> **Vasify SUITE** is an enterprise-grade, **Multi-Tenant Modular SaaS Platform & Customization Engine** architected around:
> 
> $$\text{Services} \longrightarrow \text{Subscription} \longrightarrow \text{Tenant Management} \longrightarrow \text{Customization}$$
> 
> Rather than a fixed CRM/ERP application, Vasify Suite provides **ready-made business modules as services**, allowing each customer organization to dynamically **enable, disable, configure, customize, and extend** data models, workflows, forms, pipelines, layouts, permissions, and branding without modifying core application code.

---

## 📋 Table of Contents

1. [The Fundamental Concept & 4 Pillars](#1-the-fundamental-concept--4-pillars)
2. [Platform Admin (Internal Control Plane)](#2-platform-admin-internal-control-plane)
3. [Organization & Tenant Management](#3-organization--tenant-management)
4. [User Management & Two-Tiered RBAC](#4-user-management--two-tiered-rbac)
5. [SaaS Service / Module Catalog](#5-saas-service--module-catalog)
6. [Core Services Architecture](#6-core-services-architecture)
7. [Service Activation & Subscription Engine](#7-service-activation--subscription-engine)
8. [The Customization Engine (Core IP)](#8-the-customization-engine-core-ip)
9. [Platform Supporting Services](#9-platform-supporting-services)
10. [Multi-Tenancy & Database Architecture](#10-multi-tenancy--database-architecture)
11. [Backend REST API Architecture (`/api/v1`)](#11-backend-rest-api-architecture-apiv1)
12. [Request Security Flow](#12-request-security-flow)
13. [Frontend Dynamic Shell Architecture](#13-frontend-dynamic-shell-architecture)
14. [Phased Implementation Roadmap](#14-phased-implementation-roadmap)

---

## 1. The Fundamental Concept & 4 Pillars

```text
                                  VASIFY SUITE
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       │                               │                               │
       ▼                               ▼                               ▼
 🛡️ PLATFORM ADMIN              🧩 SAAS SERVICES               🏢 CUSTOMER TENANTS
   (Internal Control)             (Product Catalog)              (Business Workspace)
       │                               │                               │
       ▼                               ▼                               ▼
 Super-Admin Plane               Ready-Made Modules             Dynamic Tenant Portal
       │                               │                               │
       └───────────────────────────────┼───────────────────────────────┘
                                       │
                                       ▼
                             🧠 CUSTOMIZATION ENGINE
       ┌───────────────────────────────┼───────────────────────────────┐
       ▼                               ▼                               ▼
 Custom Fields & Forms          Workflows & Automations         Pipelines & Layouts
       │                               │                               │
       └───────────────────────────────┼───────────────────────────────┘
                                       │
                                       ▼
                              FOUNDATION PLATFORM
   Auth • Dynamic RBAC • Multi-Tenancy • MySQL • S3 Files • Queues • Billing • Audits
```

---

## 2. 🛡️ Platform Admin (Internal Control Plane)

The **Platform Admin** (`/admin/*`) is Vasify's internal command center, managing:
- Aggregated cross-tenant KPIs (Total Orgs, Active Trials, MRR, ARR, GMV, Infrastructure Health).
- Deep Tenant Data Inspector: allows super-admins to inspect any tenant's CRM leads, deals, invoices, clients, staff, and user accounts.
- Administrative lifecycle actions: Plan extensions (+7d, +15d, +30d, +90d, +365d), password resets, suspensions with audit logging, soft-deletion.
- Real-time MySQL latency pings, 15 database table record counters, SMTP test dispatcher, maintenance mode.

---

## 3. 🏢 Organization & Tenant Management

- Scoped to `organizations` with unique `slug`, `plan_tier`, and `max_users`.
- Admin inspects and modifies organization access, enabled modules, billing status, and usage.

---

## 4. 👤 User Management & Two-Tiered RBAC

- **Platform Users**: `SuperAdmin`, `SupportAdmin`, `FinanceAdmin`.
- **Tenant Users**: `OrgOwner`, `OrgAdmin`, `Manager`, `Employee`, `Viewer`.
- **Granular Permissions**: Evaluated using dot-notation (`leads.view`, `invoices.create`, `leaves.approve`).

---

## 5. 🧩 SaaS Service / Module Catalog

Modules operate as independent pluggable services:
- **CRM as a Service**: Leads, Contacts, Companies, Deals, Pipelines, Activity Timeline.
- **Finance as a Service**: Invoices, Payments, Quotations, Expenses, Multi-Rate GST (0%, 5%, 12%, 18%, 28%).
- **HR as a Service**: Employees, Attendance, Leave ledger, Payroll engine, Payslips.
- **Projects as a Service**: Projects, Milestones, Tasks, Subtasks, Kanban, Timesheets.
- **Workspace as a Service**: Calendar, Follow-up reminders, Internal support tickets.

---

## 6. Service Activation & Subscription Engine

- Dynamically writes to `organization_modules`.
- Subscribed modules immediately render in the client's **Dynamic Sidebar**. Unsubscribed modules remain hidden.

---

## 7. The Customization Engine (Core IP)

1. **Custom Fields**: EAV schema supporting Text, Number, Currency, Dropdown, MultiSelect, Date, File, Image, UserReference, Formula.
2. **Custom Forms**: Drag-and-drop form builder with public URLs.
3. **Custom Layouts**: Reorder sections and control card visibility by role.
4. **Configurable Pipelines**: Industry-specific stages (Agencies, Real Estate, Education, Healthcare).
5. **Workflow & Automation Engine**: Event-driven `WHEN Trigger ➔ IF Condition ➔ DO Action`.
6. **Dynamic Dashboards**: User-customized KPI and chart widget grids.

---

## 8. Multi-Tenancy & Database Architecture

```sql
-- 1. Organizations
CREATE TABLE organizations (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  logo_url VARCHAR(512) NULL,
  brand_color VARCHAR(16) NULL,
  gstin VARCHAR(20) NULL,
  plan_tier ENUM('starter', 'pro', 'enterprise') NOT NULL DEFAULT 'starter',
  trial_ends_at DATETIME NULL,
  max_users INT NOT NULL DEFAULT 10,
  status ENUM('active', 'trial', 'disabled', 'deleted') NOT NULL DEFAULT 'trial',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Organization Modules
CREATE TABLE organization_modules (
  id VARCHAR(36) PRIMARY KEY,
  organization_id VARCHAR(36) NOT NULL,
  module_key VARCHAR(50) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  settings JSON NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE KEY (organization_id, module_key)
);

-- 3. Users & Tenant Membership
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  mobile_number VARCHAR(30) NULL,
  avatar_url VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organization_users (
  id VARCHAR(36) PRIMARY KEY,
  organization_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'employee',
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Custom Fields (EAV Dynamic Engine)
CREATE TABLE custom_fields (
  id VARCHAR(36) PRIMARY KEY,
  organization_id VARCHAR(36) NOT NULL,
  module_key VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  field_name VARCHAR(100) NOT NULL,
  field_key VARCHAR(100) NOT NULL,
  field_type VARCHAR(30) NOT NULL,
  options JSON NULL,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE KEY (organization_id, entity_type, field_key)
);

CREATE TABLE custom_field_values (
  id VARCHAR(36) PRIMARY KEY,
  organization_id VARCHAR(36) NOT NULL,
  field_id VARCHAR(36) NOT NULL,
  entity_id VARCHAR(36) NOT NULL,
  value_text TEXT NULL,
  value_number DECIMAL(15, 4) NULL,
  value_date DATETIME NULL,
  value_json JSON NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (field_id) REFERENCES custom_fields(id) ON DELETE CASCADE,
  INDEX (entity_id)
);

-- 5. Configurable Workflows
CREATE TABLE workflows (
  id VARCHAR(36) PRIMARY KEY,
  organization_id VARCHAR(36) NOT NULL,
  module_key VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  trigger_event VARCHAR(100) NOT NULL,
  conditions JSON NULL,
  actions JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
```

---

## 9. Backend REST API Architecture (`/api/v1`)

```text
backend/src/
├── modules/
│   ├── auth/              # JWT issuance, login, refresh, password reset
│   ├── organizations/     # Tenant profile, members, settings
│   ├── saas/              # Modules registry, plans, subscriptions, billing
│   ├── crm/               # Leads, deals, pipelines, activities, contacts
│   ├── finance/           # Invoices, payments, expenses, GST calculations
│   ├── hr/                # Employees, attendance, leaves, payroll
│   ├── projects/          # Projects, milestones, tasks, timesheets
│   ├── workspace/         # Calendar, internal support tickets
│   └── customization/     # Custom fields, custom layouts, forms, workflows
├── admin/                 # Isolated Super-Admin Control Plane APIs
└── middleware/            # Auth, tenant resolver, module guard, RBAC guard
```

---

## 10. Request Security Flow

```text
Request ➔ CORS ➔ Rate Limit ➔ JWT Verification ➔ User & Org Resolution ➔ Module Guard ➔ RBAC Guard ➔ Controller/Service ➔ Scoped Database Query (`WHERE organization_id = ?`) ➔ Standardized Response
```

---

## 11. Phased Implementation Roadmap

```
Phase 1: Foundations & Admin Oversight (COMPLETED)
├── Master Admin Console with Deep Data Inspector across all Tenants
├── Single Pages Architecture (/admin/companies, /admin/users, /admin/invoices, /admin/tickets)
├── Transactional Admin APIs with Audit Logging & System Diagnostics
└── Cloudflare Workers Static Export (47 Routes Compiled, Zero Errors)

Phase 2: Modular Multi-Tenancy & Customization Engine (ACTIVE)
├── Transition to `organizations` -> `organization_users` -> `users`
├── Dynamic Module Registry & Tenant Activation (`organization_modules`)
├── Custom Fields Engine (EAV Schema + Dynamic Form Inputs)
└── Configurable Pipeline Stages (Industry-specific deal stages)

Phase 3: Workflows, Automations & Finance Expansion (NEXT)
├── Workflow Engine (`WHEN Trigger ➔ IF Condition ➔ DO Action`)
├── In-App Notification Center & Activity Timeline Stream
├── Multi-Bracket Configurable GST Engine with State-Aware Split
└── Document Vault (S3/Cloudflare R2 Object Storage)

Phase 4: Ecosystem & Enterprise Scale (FUTURE)
├── White-Labeling (Custom subdomains, brand palettes, invoice templates)
├── Module Marketplace (1-click installation of new business modules)
└── Customer & Employee Dedicated Portals
```

---

*Last Updated: September 2026*  
*Architecture Specification: Vasify SUITE Modular SaaS Platform*
