-- ==========================================================
-- VT Suite Consolidated Database Schema
-- Compatible with: MySQL 8.0+, MariaDB, TiDB Cloud, Aiven, Railway
-- ==========================================================

CREATE DATABASE IF NOT EXISTS vt_suite;
USE vt_suite;

-- 1. Users & 7-Day Free Trial Management
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_name VARCHAR(150) NOT NULL,
    mobile_number VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(150) NOT NULL UNIQUE,
    company_name VARCHAR(150) NOT NULL,
    service_needed VARCHAR(100) DEFAULT 'full_suite',
    trial_ends_at DATETIME NULL,
    trial_status VARCHAR(20) DEFAULT 'active',
    reminder_sent_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR(50) PRIMARY KEY,
    user_id INT NULL,
    customer_id VARCHAR(50) NULL,
    invoice_number VARCHAR(100) NOT NULL,
    customer_name VARCHAR(255) NULL,
    customer_company VARCHAR(255) NULL,
    customer_email VARCHAR(255) NULL,
    customer_phone VARCHAR(50) NULL,
    amount DECIMAL(15,2) DEFAULT 0,
    tax DECIMAL(5,2) DEFAULT 18,
    gst_amount DECIMAL(15,2) DEFAULT 0,
    total DECIMAL(15,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'draft',
    issue_date DATE NULL,
    due_date DATE NULL,
    notes TEXT NULL,
    po_number VARCHAR(100) NULL,
    terms VARCHAR(100) DEFAULT 'due_on_receipt',
    place_of_supply VARCHAR(100) DEFAULT 'Maharashtra (27)',
    whatsapp_sent TINYINT(1) DEFAULT 0,
    whatsapp_sent_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Invoice Items Table
CREATE TABLE IF NOT EXISTS invoice_items (
    id VARCHAR(50) PRIMARY KEY,
    invoice_id VARCHAR(50) NOT NULL,
    description TEXT NULL,
    quantity INT DEFAULT 1,
    rate DECIMAL(15,2) DEFAULT 0,
    amount DECIMAL(15,2) DEFAULT 0,
    hsn VARCHAR(50) DEFAULT '998313',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
