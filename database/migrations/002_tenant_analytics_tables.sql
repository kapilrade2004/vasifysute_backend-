-- Phase 1: Analytics & Usage Tracking Migration
-- Creates: tenants, tenant_notes, tenant_tags, module_usage_stats, usage_daily_summary

-- Ensure tenants table exists (mapping user companies)
CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  company_name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  plan VARCHAR(50) DEFAULT 'Trial',
  status VARCHAR(20) DEFAULT 'active',
  assigned_admin_id VARCHAR(36) NULL,
  trial_ends_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add assigned_admin_id to users if not present
SET @dbname = DATABASE();
SET @tablename = 'users';
SET @columnname = 'assigned_admin_id';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN assigned_admin_id VARCHAR(36) NULL'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Tenant Notes Table
CREATE TABLE IF NOT EXISTS tenant_notes (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  admin_id VARCHAR(36) NOT NULL,
  note TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_id (tenant_id),
  INDEX idx_admin_id (admin_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tenant Tags Table
CREATE TABLE IF NOT EXISTS tenant_tags (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  tag VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_tag (tenant_id, tag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Raw Module Usage Stats (UPSERT target)
CREATE TABLE IF NOT EXISTS module_usage_stats (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  module_key VARCHAR(50) NOT NULL,
  feature_key VARCHAR(100) NOT NULL,
  date DATE NOT NULL,
  request_count INT NOT NULL DEFAULT 1,
  active_user_ids JSON NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_module_feature_date (tenant_id, module_key, feature_key, date),
  INDEX idx_tenant_date (tenant_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily Summary Aggregation Table (rolled up from module_usage_stats)
CREATE TABLE IF NOT EXISTS usage_daily_summary (
  tenant_id VARCHAR(50) NOT NULL,
  module_key VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  active_users INT NOT NULL DEFAULT 0,
  total_requests INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, module_key, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
