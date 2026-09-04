# 🚀 Vasify SUITE — Modular SaaS Platform Architecture

> **Vasify SUITE** is an enterprise-grade, **Multi-Tenant Modular SaaS Platform** where organizations subscribe to ready-made business modules (CRM, Finance, HR, Projects, Workspace, and more) and can dynamically **enable, disable, configure, customize, and extend** their data models, workflows, forms, layouts, permissions, and branding without altering core application code.

---

## 📋 Table of Contents

1. [Executive Summary & Core Philosophy](#executive-summary--core-philosophy)
2. [Platform vs. Fixed SaaS Architecture](#platform-vs-fixed-saas-architecture)
3. [The Customization Engine (Core IP)](#the-customization-engine-core-ip)
   - [1. Custom Fields Engine](#1-custom-fields-engine)
   - [2. Custom Modules & Dynamic Entity Engine](#2-custom-modules--dynamic-entity-engine)
   - [3. Configurable Lifecycles & Pipelines](#3-configurable-lifecycles--pipelines)
   - [4. Dynamic Form Builder & Public Endpoints](#4-dynamic-form-builder--public-endpoints)
   - [5. Custom Layouts & View Composer](#5-custom-layouts--view-composer)
   - [6. Configurable Dashboards & Widget System](#6-configurable-dashboards--widget-system)
   - [7. Workflow & Automation Engine](#7-workflow--automation-engine)
   - [8. Granular RBAC & Permission Matrix](#8-granular-rbac--permission-matrix)
   - [9. White-Labeling & Brand Customization](#9-white-labeling--brand-customization)
   - [10. Module Marketplace & App Store](#10-module-marketplace--app-store)
4. [Master Admin Control Plane](#master-admin-control-plane)
5. [Multi-Tenancy & Database Architecture](#multi-tenancy--database-architecture)
6. [Complete REST API Reference](#complete-rest-api-reference)
7. [Implementation & Evolution Roadmap](#implementation--evolution-roadmap)

---

## Executive Summary & Core Philosophy

Traditional business software forces organizations into rigid, hardcoded silos. **Vasify SUITE changes this paradigm:**

```text
                    VASIFY SUITE
                         │
              ┌──────────┴──────────┐
              │   SaaS Platform     │
              └──────────┬──────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
      CRM             Finance             HR
        │                │                │
     Projects        Workspace         Reports
        │                │                │
        └────────────────┼────────────────┘
                         │
                 CUSTOMIZATION ENGINE
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       Fields         Workflows       Layouts
       Forms          Automation       Branding
       Statuses       Permissions      Templates
       Modules        Rules            Dashboards
```

Instead of writing separate codebases for different verticals:
- **Agency / Tech Company**: Uses `Leads ➔ Demos ➔ Proposals ➔ Won Deals`.
- **Real Estate Firm**: Configures the CRM engine for `Inquiries ➔ Site Visits ➔ Negotiations ➔ Bookings`.
- **Educational Institute**: Configures the CRM engine for `Inquiries ➔ Counselling ➔ Applications ➔ Admissions`.

**Same core platform engine. Completely configurable tenant experience.**

---

## The Customization Engine (Core IP)

### 1. Custom Fields Engine
Organizations can append custom fields to any core entity (`leads`, `deals`, `customers`, `invoices`, `employees`, `projects`).

Supported Types: `Text`, `Number`, `Currency`, `Email`, `Phone`, `Date`, `Dropdown`, `MultiSelect`, `Checkbox`, `Radio`, `File`, `Image`, `UserReference`, `RelationReference`, `Formula`.

### 2. Custom Modules & Dynamic Entity Engine
Organizations can declare entirely new business modules and sub-entities directly from the UI (e.g. `Properties`, `Students`, `Vehicles`, `Patients`).

### 3. Configurable Lifecycles & Pipelines
No hardcoded status sequences. Tenants create and customize pipelines according to their sales methodology.

### 4. Dynamic Form Builder & Public Endpoints
Visual form composer allowing tenants to generate public lead-capture or survey forms with webhooks.

### 5. Custom Layouts & View Composer
Tenants control the anatomy of record detail pages, card placement, and role-based section visibility.

### 6. Configurable Dashboards & Widget System
Every organization dashboard is composed of modular, draggable, resizable KPI and chart widgets.

### 7. Workflow & Automation Engine
Event-driven trigger and action pipeline for business automation (`WHEN Trigger ➔ IF Condition ➔ DO Action`).

### 8. Granular RBAC & Permission Matrix
Moving beyond `admin` vs `user` into dynamic role composition with module- and field-level permissions.

### 9. White-Labeling & Brand Customization
Custom logo, brand accent colors, custom invoice templates, and custom domain bindings.

### 10. Module Marketplace & App Store
Tenants can subscribe to or activate modules on-demand (`CRM`, `Finance`, `HR`, `Projects`, `Inventory`, `Helpdesk`).

---

## Multi-Tenancy & Database Architecture

### Primary Tenant Boundary: `organizations`

```sql
-- 1. Organizations (Core Tenant Entity)
CREATE TABLE organizations (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  legal_name VARCHAR(255) NULL,
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

-- 2. Organization Enabled Modules
CREATE TABLE organization_modules (
  id VARCHAR(36) PRIMARY KEY,
  organization_id VARCHAR(36) NOT NULL,
  module_key VARCHAR(50) NOT NULL, -- 'crm', 'finance', 'hr', 'projects', 'inventory'
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
  role_id VARCHAR(36) NOT NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Custom Fields Schema
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
```

---

## Implementation & Evolution Roadmap

```
Phase 1: Foundation (COMPLETED)
├── Cloudflare Static Export Deployment (Zero Errors, 47 Routes Compiled)
├── Master Admin Console with Deep Data Inspector across all Tenants
├── Transactional Admin APIs with Mandatory Audit Logging
└── Live Infrastructure Diagnostics & SMTP Mail Dispatcher

Phase 2: Modular Customization Engine (IN PROGRESS)
├── Organization-First Multi-Tenancy Transition (organizations -> organization_users)
├── Custom Fields Engine (EAV schema + dynamic form rendering in CRM)
├── Dynamic Pipeline & Stage Builder (Configurable deal workflows)
└── Granular Dynamic RBAC (Custom roles with module-level permissions)

Phase 3: Automation & Integrations (NEXT)
├── Workflow Automation Engine (Trigger ➔ Condition ➔ Action visual builder)
├── In-App Notification Center & Activity Timeline Feeds
├── Multi-Bracket Configurable GST Engine with State-Aware Split
└── Document Vault (Contracts, Invoices, Attachments on S3/R2)

Phase 4: Scale & Ecosystem (FUTURE)
├── White-Labeling (Custom subdomains, brand palettes, invoice templates)
├── Module Marketplace (1-click installation of new business modules)
└── Public Developer API & Webhook Dispatcher
```

---

*Last Updated: September 2026*  
*Architecture: Vasify SUITE Modular SaaS Platform*
