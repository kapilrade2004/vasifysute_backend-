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
   - [CRM as a Service](#crm-as-a-service)
   - [Finance as a Service](#finance-as-a-service)
   - [HR as a Service](#hr-as-a-service)
   - [Project Management as a Service](#project-management-as-a-service)
   - [Workspace as a Service](#workspace-as-a-service)
7. [Service Activation & Subscription Engine](#7-service-activation--subscription-engine)
8. [The Customization Engine (Core IP)](#8-the-customization-engine-core-ip)
   - [Custom Field Builder](#custom-field-builder)
   - [Custom Form Builder](#custom-form-builder)
   - [Custom Layout Builder](#custom-layout-builder)
   - [Configurable Pipelines & Lifecycles](#configurable-pipelines--lifecycles)
   - [Workflow & Automation Engine](#workflow--automation-engine)
   - [Dynamic Dashboard & Widget System](#dynamic-dashboard--widget-system)
9. [Platform Supporting Services](#9-platform-supporting-services)
   - [Notification Service](#notification-service)
   - [Object Storage & File Service](#object-storage--file-service)
   - [Background Job & Queue System](#background-job--queue-system)
   - [Integration Hub & Webhooks](#integration-hub--webhooks)
10. [Multi-Tenancy & Database Architecture](#10-multi-tenancy--database-architecture)
11. [Backend REST API Architecture (`/api/v1`)](#11-backend-rest-api-architecture-apiv1)
12. [Request Security Flow](#12-request-security-flow)
13. [Frontend Dynamic Shell Architecture](#13-frontend-dynamic-shell-architecture)
14. [Customer Onboarding & Configuration Wizard](#14-customer-onboarding--configuration-wizard)
15. [Phased Implementation Roadmap](#15-phased-implementation-roadmap)

---

## 1. The Fundamental Concept & 4 Pillars

Vasify Suite is structured into **4 major systems**:

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

The **Platform Admin** (`/admin/*`) is Vasify's internal command center. It is strictly isolated from tenant spaces and handles cross-tenant telemetry, subscription health, and security governance.

### Admin Dashboard KPIs & Telemetry
```text
/admin/dashboard
├── Operational Metrics:
│   ├── Total Organizations:     2,481
│   ├── Active Organizations:    2,174
│   ├── Active Trials (7-day):     187
│   ├── Suspended Accounts:         23
│   └── Churned / Cancelled:        97
├── Financial Telemetry:
│   ├── Monthly Recurring Revenue (MRR):  ₹18,40,000
│   ├── Annual Recurring Revenue (ARR):   ₹2,20,80,000
│   └── Total Platform GMV Invoiced:     ₹14,85,00,000
└── System Infrastructure Health:
    ├── API Requests (24h):      4.8M
    ├── Database Latency:        12ms (Operational)
    ├── Storage Footprint:       1.2 TB
    └── Background Failed Jobs:  0 (Health: 100%)
```

### Analytical Growth Charts
- MRR & ARR Growth Velocity.
- Trial-to-Paid Conversion Cohorts.
- Module Adoption Distribution (Full Suite vs CRM vs Finance vs HR).
- API Saturation & Storage Utilization.

---

## 3. 🏢 Organization & Tenant Management

Super-admins govern all tenant companies via `/admin/organizations` (or `/admin/companies`):

```text
/admin/organizations
├── Search & Filters (Status: Active, Trial, Suspended, Expired; Plan: Starter, Pro, Enterprise)
├── Data Columns: Organization, Plan, Active Modules, User Seats, Status, GMV, Created Date
└── Single Organization Deep Inspector (Full Multi-Tab Inspector):
    ├── Overview: Subscription health, seat limits, owner profile
    ├── Subscribed Modules: Toggle module access per tenant (CRM, Finance, HR, Projects)
    ├── CRM Data: View all leads, deals, and pipeline volume of that tenant
    ├── Finance Data: View all invoices, payments, and GST records of that tenant
    ├── Customer Data: View all client accounts registered by that tenant
    ├── Workforce Data: View all HR employee profiles and departments
    ├── User Accounts: Manage all login credentials, roles, and 1-click password resets
    ├── Plan Extensions: Fast presets (+7d, +15d, +30d, +90d, +365d) or custom expiry
    └── Security Actions: Suspend with logged reason, reactivate, or soft-delete
```

---

## 4. 👤 User Management & Two-Tiered RBAC

Vasify strictly separates **Platform Administrators** from **Tenant Business Users**:

### 1. Platform Users (Internal Vasify Staff)
- `SuperAdmin`: Full system control, billing, tenant lifecycle, and DB diagnostics.
- `SupportAdmin`: Tenant support tickets, read-only audit inspection, user assists.
- `FinanceAdmin`: Platform billing oversight, subscription reconciliation.

### 2. Tenant Users (Customer Organization Staff)
- `OrgOwner`: Full organization ownership, subscription billing, module activation.
- `OrgAdmin`: Department-wide configuration, custom fields, user invitations.
- `Manager`: Team lead approvals, pipeline management, leave approvals.
- `Employee`: Personal tasks, timesheets, assigned leads, personal attendance.
- `Viewer`: Read-only access to authorized modules.

### Dynamic Permission Nodes
Permissions are evaluated at runtime using granular dot-notation:
```text
CRM:       leads.view, leads.create, leads.edit, leads.delete, leads.export, leads.assign
Finance:   invoices.view, invoices.create, invoices.edit, invoices.approve, invoices.export
HR:        employees.view, attendance.manage, leaves.approve, payroll.generate
Projects:  projects.create, tasks.assign, milestones.manage, timesheets.view
```

---

## 5. 🧩 SaaS Service / Module Catalog

Each module is an isolated pluggable business service governed by metadata, pricing, dependencies, and settings:

```text
Module Entity
├── Service Identity (key, name, description, icon, version)
├── Pricing & Plan Tiers (Starter, Professional, Enterprise)
├── Feature Flags (e.g. crm.ai_lead_scoring, finance.multi_currency)
├── Module Dependencies (e.g. Projects requires Workspace)
├── Default Entity Schema & Field Definitions
└── Organization Activation Status (Active, Inactive, Trial)
```

---

## 6. Core Services Architecture

### CRM as a Service
- **Core Entities**: Leads, Contacts, Companies (B2B Accounts), Deals, Pipelines, Activities.
- **High-Velocity Pipeline**: Visual drag-and-drop Kanban board with monetary stage feedback.
- **Activity Timeline**: Unified stream (`Lead Created` ➔ `Call Logged` ➔ `WhatsApp Sent` ➔ `Meeting Held` ➔ `Quote Delivered` ➔ `Deal Won`).
- **1-Click Conversion**: Converts qualified leads into linked Client Contacts and active Deals.

### Finance as a Service
- **Core Entities**: Invoices, Quotations, Sales Orders, Payments, Expenses, Vendors, Retainers.
- **Configurable Multi-Rate GST**: Automatic intra-state (CGST + SGST) vs inter-state (IGST) calculations.
- **Payment Ledger**: Running balance calculations for advance and milestone payments.
- **Recurring Retainers**: Automated billing cycles (weekly, monthly, quarterly, annual).

### HR as a Service
- **Core Entities**: Employees, Departments, Designations, Attendance, Leave, Holidays, Payroll.
- **Attendance Tracking**: One-click Clock In / Clock Out, daily logged hours, correction workflows.
- **Leave Ledger**: Casual, Sick, and Earned balances with multi-stage manager approvals.
- **Payroll Engine**: Automated salary calculations, allowance/deduction structures, one-click payslips.

### Project Management as a Service
- **Core Entities**: Projects, Milestones, Tasks, Subtasks, Timesheets, Budgets.
- **Views**: Interactive Kanban boards, Gantt timelines, milestone burndown charts.
- **Time Tracking**: Logged hours per task with project profitability analysis.

### Workspace as a Service
- **Core Entities**: Calendar Events, Meeting Links, Internal Tickets, Global Announcements.
- **Follow-up Reminders**: Synchronized calendar alerts for sales closures and project milestones.

---

## 7. Service Activation & Subscription Engine

When an organization subscribes to or enables a service, the system provisions tenant access dynamically:

```text
Customer Organization
        │
        ▼
Select Modules & Plans (e.g. CRM + Finance)
        │
        ▼
Subscription Transaction (Razorpay / Stripe)
        │
        ▼
Service Activation Engine
 ├── Writes to `organization_modules`
 ├── Generates default custom fields & pipelines
 ├── Updates tenant navigation shell
 └── Dynamic Sidebar exposes only subscribed modules
```

---

## 8. The Customization Engine (Core IP)

### Custom Field Builder
Allows tenants to attach bespoke attributes to any entity without altering SQL schemas:

```text
CRM ➔ Leads ➔ Custom Fields ➔ "+ Add Field"
┌────────────────────────────────────────────────────────┐
│ Field Label:     Company Size                          │
│ Field Key:       company_size                          │
│ Field Type:      Dropdown                              │
│ Options:         1-10, 11-50, 51-200, 201-500, 500+    │
│ Validation:      Required [✓]  Filterable [✓]          │
└────────────────────────────────────────────────────────┘
```
**Supported Primitives**: Text, LongText, Number, Currency, Email, Phone, URL, Date, DateTime, Dropdown, MultiSelect, Checkbox, Radio, File, Image, UserReference, RelationReference, Formula.

### Custom Form Builder
Visual drag-and-drop form builder generating public URLs (e.g. `https://vasifytech.com/f/org-slug/lead-form`) for inbound lead capture and website embedding.

### Custom Layout Builder
Allows organizations to rearrange detail views: reorder cards, position the Activity Timeline, and control role-based card visibility.

### Configurable Pipelines & Lifecycles
Custom pipeline stages tailored to any industry:
- **Agencies**: `Lead` ➔ `Discovery` ➔ `Proposal` ➔ `Negotiation` ➔ `Won`.
- **Real Estate**: `Inquiry` ➔ `Site Visit` ➔ `Price Negotiation` ➔ `Booking` ➔ `Sale Closed`.
- **Education**: `Inquiry` ➔ `Counselling` ➔ `Application` ➔ `Admission` ➔ `Enrolled`.

### Workflow & Automation Engine
Event-driven trigger/condition/action builder:
```text
WHEN Lead Created
  IF Source == "Website" AND ExpectedValue >= 1,00,000
    THEN Set Priority = "High"
    AND Assign to Senior Account Exec
    AND Dispatch WhatsApp Greeting
    AND Create Follow-up Task
```

### Dynamic Dashboard & Widget System
Users compose their executive dashboard by adding, arranging, and resizing widgets (Revenue, Leads, Pipeline, Unpaid Invoices, Attendance, Cash Flow).

---

## 9. Platform Supporting Services

### Notification Service
Unified notification engine supporting:
- In-app notification bell with real-time unread badges.
- Transactional emails via Nodemailer (Gmail SMTP).
- WhatsApp Cloud API webhooks.
- Scheduled reminders.

### Object Storage & File Service
- Uploads routed to S3/Cloudflare R2 compatible object storage.
- File metadata, permissions, and entity associations stored in MySQL.

### Background Job & Queue System
- Asynchronous task processing (Redis + BullMQ / Node event queues) for:
  - Automated trial reminder emails.
  - WhatsApp webhook dispatches.
  - Large CSV/Excel data imports and exports.
  - Invoice PDF rendering.

### Integration Hub & Webhooks
- Outbound webhooks on entity triggers (`lead.created`, `invoice.paid`, `deal.won`).
- Inbound webhooks with HMAC signature verification.

---

## 10. Multi-Tenancy & Database Architecture

All business tables are partitioned by `organization_id`:

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

-- 2. Organization Modules (Service Activation)
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

## 11. Backend REST API Architecture (`/api/v1`)

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

## 12. Request Security Flow

Every tenant API request follows an authenticated pipeline:

```text
Incoming HTTP Request
        ↓
    CORS Check
        ↓
   Rate Limiter (Brute-force protection)
        ↓
 JWT Signature Verification (`Bearer <token>`)
        ↓
 Resolve User & Organization ID
        ↓
 Check Organization Status (`active` / `trial`)
        ↓
 Check Subscribed Module Access (`organization_modules`)
        ↓
 Check Granular RBAC Permissions (`leads.create`)
        ↓
 Execute Controller & Service Logic
        ↓
 Scoped Query: `WHERE organization_id = ?`
        ↓
 Return Standardized JSON Response
```

---

## 13. Frontend Dynamic Shell Architecture

The client workspace (`vt-suite`) builds its navigation dynamically:
1. Client logs in and receives JWT payload containing `organization_id` and active role.
2. Shell queries `GET /api/v1/organizations/modules` to receive enabled services.
3. **Dynamic Sidebar** renders only the subscribed modules:
   - If organization only subscribes to **CRM & Finance**, HR and Projects are omitted from navigation.
   - If organization upgrades to **Full Suite**, HR, Projects, and Workspace appear immediately.

---

## 14. Customer Onboarding & Configuration Wizard

```text
User Sign Up
      ↓
Verify Email
      ↓
Create Organization (Company Name, Slug)
      ↓
Select Industry (Agency, Tech, Real Estate, Education, Healthcare, Retail)
      ↓
Pre-Configure Industry Presets (Pipelines, Fields, Stages)
      ↓
Select Subscribed Services & Choose Plan
      ↓
Invite Team Members & Assign Roles
      ↓
Launch Tailored Workspace Dashboard
```

---

## 15. Phased Implementation Roadmap

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
