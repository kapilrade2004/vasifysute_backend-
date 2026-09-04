# 🚀 Vasify SUITE — System Architecture & Documentation

> **VasifyTech Suite (VT Suite)** is an all-in-one, enterprise-grade multi-tenant SaaS business management platform that unifies CRM, Sales Pipelines, Finance & GST Invoicing, HR & Payroll, Project Management, Team Workspace, and an isolated **Master Admin Control Plane** under a high-performance web suite.

---

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Technology Stack](#technology-stack)
4. [Master Admin Control Plane](#master-admin-control-plane)
5. [Core SaaS Client Modules](#core-saas-client-modules)
6. [Multi-Tenancy & Data Architecture](#multi-tenancy--data-architecture)
7. [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
8. [Database Schema](#database-schema)
9. [Complete API Reference](#complete-api-reference)
10. [Environment Configuration](#environment-configuration)
11. [Deployment Specifications](#deployment-specifications)
12. [Development Setup & Scripts](#development-setup--scripts)

---

## System Overview

| Property | Value |
|---|---|
| **Product Name** | VasifyTech Suite (Vasify SUITE) |
| **Architecture** | Multi-Tenant Decoupled SaaS (Next.js SPA + Express REST API) |
| **Target Market** | SMBs, Digital Agencies, Tech Enterprises, Global Freelancers |
| **Trial Model** | 7-Day Free Trial (Automated lifecycle emails & Admin extensions) |
| **Taxation Engine** | Configurable Multi-Bracket GST (0%, 5%, 12%, 18%, 28%, exempt) with auto-split CGST/SGST vs IGST |
| **Admin Plane** | Isolated Super-Admin Control Center (`/admin/*`) with Single Entity Deep Data Inspectors |

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT BROWSERS                               │
│              Tenant Users & Staff           Master Super-Admins         │
└───────────────────────┬───────────────────────────────┬─────────────────┘
                        │ HTTPS                         │ HTTPS
┌───────────────────────▼───────────────────────────────▼─────────────────┐
│                   FRONTEND WEB APPLICATION (`vt-suite`)                 │
│         Next.js 16 + React 19 + TypeScript + TailwindCSS v4             │
│         Deployed on: Cloudflare Workers Static Assets (SPA) / Render   │
│                                                                         │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────┐  │
│  │     TENANT CLIENT WORKSPACE     │   │   MASTER ADMIN CONTROL      │  │
│  │  • CRM & Real-Time Pipeline     │   │   • Global Mission Control  │  │
│  │  • Finance & GST Invoicing      │   │   • Deep Tenant Inspector   │  │
│  │  • HR & Payroll Ledger          │   │   • Cross-Tenant Invoices   │  │
│  │  • Projects & Task Boards       │   │   • Cross-Tenant Tickets    │  │
│  │  • Activity Timeline Drawer     │   │   • Forensic Audit Trail    │  │
│  │  • Workspace Calendar & Support │   │   • System Health & DB Ping │  │
│  └─────────────────────────────────┘   └─────────────────────────────┘  │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │ REST API (Bearer JWT / Admin Token)
┌─────────────────────────────────▼───────────────────────────────────────┐
│                 BACKEND REST API (`vasifysute_backend-`)                │
│                 Node.js 20+ / Express.js (Modular Monolith)             │
│                 Deployed on: Render Cloud (Oregon)                      │
│                                                                         │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────┐  │
│  │      TENANT BUSINESS LOGIC      │   │     MASTER ADMIN MODULE     │  │
│  │  • Auth & User Management       │   │   • Isolated Admin JWT      │  │
│  │  • Invoices & Payment Receipts  │   │   • Transactional Audit     │  │
│  │  • Leads, Deals & Timeline      │   │   • System Telemetry / Ping │  │
│  │  • HR Payroll & Attendance      │   │   • SMTP Diagnostic Service │  │
│  └─────────────────────────────────┘   └─────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │        Notification Engine: Nodemailer (Gmail SMTP)               │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │ Connection Pool (mysql2 / SSL)
┌─────────────────────────────────▼───────────────────────────────────────┐
│                           MYSQL DATABASE                                │
│       Production: Remote FreeSQLDatabase / TiDB Cloud / Aiven           │
│       Development: Local MySQL 8.0 Engine (3306)                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Complete API Reference

All endpoints are prefixed with `/api`.

### 1. Master Admin API (`/api/admin/*`)
*Guarded by `verifyAdminToken` and `requireRole('super_admin')` unless specified.*

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/admin/login` | Super admin login (Rate limited: 5 attempts / 15m) |
| `GET` | `/api/admin/stats` | Cached aggregate platform telemetry |
| `GET` | `/api/admin/system-health` | Live MySQL ping latency, table row counts, server uptime |
| `POST` | `/api/admin/test-email` | Diagnostic SMTP email dispatcher |
| `GET` | `/api/admin/companies` | List all tenant companies |
| `POST` | `/api/admin/companies` | Register new tenant company with owner account |
| `GET` | `/api/admin/companies/:id` | Deep tenant details (leads, deals, invoices, users) |
| `PUT` | `/api/admin/companies/:id` | Update company profile, service tier, max seats |
| `PUT` | `/api/admin/companies/:id/extend-plan` | Extend tenant subscription days |
| `POST` | `/api/admin/companies/:id/reset-password` | Reset company owner password |
| `PUT` | `/api/admin/companies/:id/suspend` | Suspend or reactivate company (Audit logged) |
| `DELETE` | `/api/admin/companies/:id/delete` | Soft delete tenant company (Audit logged) |
| `POST` | `/api/admin/users` | Add user directly assigned to any tenant |
| `PUT` | `/api/admin/users/:id` | Update user details, role, status, company |
| `PUT` | `/api/admin/users/:id/extend-plan` | Extend individual user plan |
| `DELETE` | `/api/admin/users/:id` | Delete user account (Audit logged) |
| `GET` | `/api/admin/invoices` | Cross-tenant invoice audit directory |
| `PUT` | `/api/admin/invoices/:id/status` | Override invoice payment status with admin note |
| `GET` | `/api/admin/tickets` | Cross-tenant support tickets queue |
| `POST` | `/api/admin/tickets` | Create support ticket |
| `PUT` | `/api/admin/tickets/:id` | Update ticket status, priority, and resolution notes |
| `GET` | `/api/admin/audit-logs` | Filterable forensic audit trail |

### 2. Tenant Client API (`/api/*`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register new tenant user account |
| `POST` | `/api/auth/login` | Authenticate tenant user & issue JWT |
| `GET` | `/api/auth/verify` | Verify active JWT session |
| `GET` / `POST` | `/api/customers` | Customer directory & client creation |
| `PUT` / `DELETE` | `/api/customers/:id` | Customer updates & removal |
| `GET` / `POST` | `/api/invoices` | Tenant invoices list & creation |
| `PUT` | `/api/invoices/:id` | Invoice payment status updates |
| `GET` / `POST` | `/api/leads` | Sales leads management |
| `GET` / `POST` | `/api/deals` | Deal pipeline stages |
| `GET` / `POST` | `/api/hr/employees` | Staff directory |
| `GET` / `POST` | `/api/hr/attendance` | Clock-in/out logs |
| `GET` / `PUT` | `/api/hr/leaves` | Leave requests & manager approvals |
| `GET` / `POST` | `/api/hr/payroll` | Monthly payroll processing |
| `GET` / `POST` | `/api/workspace/tickets` | Tenant support tickets |

---

## Environment Configuration

### Backend (`vasifysute_backend-/.env`)
```env
PORT=5000
NODE_ENV=production

# Database Credentials
DB_HOST=sql12.freesqldatabase.com
DB_PORT=3306
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_db_name
DB_SSL=false

# Authentication Secrets
JWT_SECRET=super_secret_tenant_jwt_key_2026
ADMIN_JWT_SECRET=isolated_master_super_admin_jwt_secret_key_2026

# Super Admin Seed Credentials
ADMIN_INITIAL_EMAIL=admin@vasifytech.com
ADMIN_INITIAL_PASSWORD=admin123
ADMIN_INITIAL_NAME=Master Super Admin

# Email Delivery (Gmail SMTP)
EMAIL_USER=notifications@vasifytech.com
EMAIL_PASS=your_gmail_app_password
```

---

*Last Updated: September 2026*  
*Project: Vasify SUITE / VasifyTech Suite*
