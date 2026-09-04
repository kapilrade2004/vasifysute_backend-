# 🚀 VasifyTech Suite (VT Suite) - System Documentation & Architecture Guide

## 📋 Overview

**VasifyTech Suite (VT Suite)** is an enterprise-grade, all-in-one SaaS Business Management platform designed for small-to-medium enterprises, agencies, and tech companies. The platform integrates CRM, Sales Pipelines, Finance & Invoicing, HR & Payroll, Project Management, and Workspace Support into a unified, high-performance web suite.

---

## 🏗️ Architecture & Technology Stack

The application adopts a decoupled frontend-backend architecture:

### 1. Backend REST API (`vasifysute_backend-`)
- **Runtime**: Node.js
- **Web Framework**: Express.js (v4.21.2)
- **Database Layer**: MySQL (supports local MySQL 8.0 & Remote FreeSQLDatabase / SSL) via `mysql2`
- **Authentication**: JSON Web Tokens (`jsonwebtoken`), Password Hashing (`bcryptjs`)
- **Notification Services**: Nodemailer (SMTP integration for automated reminders & billing alerts)
- **Deployment Spec**: Render Cloud Platform (`render.yaml`)

### 2. Frontend Next.js Web App (`vt_suite.1-1`)
- **Framework**: Next.js 16.3 (App Router with Webpack)
- **UI & Components**: React 19, Lucide Icons, Radix UI primitives, TailwindCSS v4
- **State Management**: React Context (`AppContext`, `AuthContext`, `CRMContext`) with optimistic UI fallbacks
- **Data Visualization**: Recharts analytics graphs
- **Deployment Spec**: Vercel Cloud Platform

---

## 💡 Core Functional Modules

### 💼 1. CRM & Sales Pipeline
- **Leads Directory**: Centralized list of incoming leads with search, source filtering, and stage management.
- **Kanban Board**: Drag-and-drop deal pipeline (`Lead` ➔ `Demo` ➔ `Proposal` ➔ `Negotiation` ➔ `Won` / `Lost`).
- **Sales Owner Assignment**: Admin-only reassignment of leads to specific sales representatives.
- **Closure Tracking**: Follow-up date scheduling and expected closure estimations.

### 💰 2. Finance & Invoicing Engine
- **Customer Directory**: Complete customer database with GSTIN, street address, city, state, and pincode attributes.
- **Invoice Generation**: Automated invoice number generation, line-item pricing, HSN codes, and 18% GST tax calculation.
- **Payment Ledger**: Tracking cumulative client payments (`paidAmount`) and remaining due (`expectedAmount`).
- **Recurring Retainers**: Weekly, monthly, quarterly, and annual billing subscriptions.

### 👥 3. HR & Payroll System
- **Employee Directory**: Full staff profile database with role designations and department mappings.
- **Attendance & Leaves**: Real-time clock-in/out tracking and employee leave request approvals (`Approved` / `Rejected`).
- **Payroll Ledger**: Automated salary processing, allowance structures, deductions, and Net Pay generation.

### 📁 4. Project & Task Management
- **Project Directory**: Enterprise projects with deadline tracking, budget status, and task breakdowns.
- **Task Boards**: Priority levels (`High`, `Medium`, `Low`), assigned team members, and status toggles.

### 🎫 5. Workspace & Support Tickets
- **Calendar**: Event scheduling and follow-up reminders.
- **Ticketing System**: Customer support ticket creation, priority levels, and status resolution.

### 🛡️ 6. Master Admin Console
- **Super Admin Portal**: Restricted master admin access (`/admin/login`).
- **Platform Telemetry**: Overview of total registered companies, active trial accounts, total invoices, and suite volume.
- **Role-Based Access Control (RBAC)**: Enforces role permissions (`admin` vs `user`).

---

## 📡 Backend API Endpoints Reference

All API routes are prefixed with `/api`.

| Route | Method | Description |
| :--- | :--- | :--- |
| **Health & Meta** | | |
| `/` | GET | API Status & Available Route Map |
| `/health` | GET | Database Connectivity & Health Check |
| **Authentication** | | |
| `/api/auth/register` | POST | Register new company user account |
| `/api/auth/login` | POST | Authenticate user & issue JWT token |
| `/api/auth/verify` | GET | Verify active JWT token session |
| **Customers** | | |
| `/api/customers` | GET | Fetch paginated customer directory |
| `/api/customers` | POST | Create new customer record |
| `/api/customers/:id` | PUT | Update customer profile details |
| `/api/customers/:id` | DELETE | Delete customer record |
| **Invoices** | | |
| `/api/invoices` | GET | List generated invoices |
| `/api/invoices` | POST | Issue standalone or recurring invoice |
| `/api/invoices/:id` | PUT | Update invoice payment status & items |
| **Leads & Deals** | | |
| `/api/leads` | GET / POST | Manage sales leads |
| `/api/deals` | GET / POST | Manage pipeline deal stages |
| **HR & Workspace** | | |
| `/api/hr/employees` | GET / POST | Manage staff directory |
| `/api/hr/attendance` | GET / POST | Attendance log entries |
| `/api/hr/leaves` | GET / PUT | Employee leave requests |
| `/api/hr/payroll` | GET / POST | Process monthly staff payroll |
| `/api/workspace/tickets`| GET / POST | Customer support tickets |
| **Master Admin** | | |
| `/api/admin/login` | POST | Super admin authentication |
| `/api/admin/stats` | GET | Global system statistics & metrics |

---

## 🗄️ Database Schema Structure

The MySQL database (`vt_suite`) comprises the following core relational tables:

```
vt_suite (Database)
 ├── users (id, name, email, password_hash, company_name, role, status, created_at)
 ├── customers (id, name, email, phone, company, address, city, state, pincode, gstin, total_value, status, created_at)
 ├── leads (id, name, phone, whatsapp, email, company, service, source, stage, priority, total_amount, expected_amount, follow_up_date)
 ├── deals (id, lead_id, title, stage, value, close_date, sales_owner)
 ├── invoices (id, invoice_number, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total_amount, status)
 ├── invoice_items (id, invoice_id, description, hsn, quantity, rate, amount)
 ├── customer_payments (id, customer_id, amount, payment_date, notes)
 ├── employees (id, name, email, role, department, salary, join_date, status)
 ├── attendance (id, employee_id, date, status, check_in, check_out)
 ├── leaves (id, employee_id, leave_type, start_date, end_date, reason, status)
 ├── payroll (id, employee_id, month, basic_salary, allowance, deductions, net_salary, status)
 ├── projects (id, name, client_name, budget, status, start_date, end_date)
 ├── tasks (id, project_id, title, assignee, priority, status, due_date)
 └── tickets (id, ticket_number, customer_name, subject, priority, status, created_at)
```

---

## ⚙️ Environment Configuration (`.env`)

Create a `.env` file in `vasifysute_backend-`:

```env
# Server Port
PORT=5000

# Local MySQL Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root
DB_NAME=vt_suite
DB_SSL=false

# JWT Secret Key
JWT_SECRET=vasifytech_super_secret_jwt_key_2026

# SMTP Email Configuration (Nodemailer)
EMAIL_USER=notifications@vasifytech.com
EMAIL_PASS=your_smtp_password
```

---

## 🛠️ Local Development & Running Guide

### 1. Running Backend Server (`vasifysute_backend-`)
```bash
# Navigate to backend directory
cd vasifysute_backend-

# Install dependencies
npm install

# Run database migrations / seed (Optional)
npm run seed

# Start server in development mode
npm run dev
# Backend will start on http://localhost:5000
```

### 2. Running Frontend Client (`vt_suite.1-1`)
```bash
# Navigate to frontend directory
cd vt_suite.1-1

# Install dependencies
npm install

# Start Next.js development server
npm run dev
# Frontend will start on http://localhost:3000
```

---

## 🚀 Production Deployment Workflow

- **Backend (`Render`)**: Managed automatically via `render.yaml`. Connect your GitHub repository to Render as a Web Service running `npm start`.
- **Frontend (`Vercel`)**: Connect `vt_suite.1-1` root directory to Vercel, set `NEXT_PUBLIC_API_URL=https://<your-render-backend-url>/api`, and build using `npm run build`.
