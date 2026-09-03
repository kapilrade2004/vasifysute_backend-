const mysql = require('mysql2/promise');
require('dotenv').config();

function getPoolConfig() {
  const databaseUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;

  // SSL is required on some cloud hosts
  const isCloudHost = databaseUrl && (
    databaseUrl.includes('tidbcloud.com') ||
    databaseUrl.includes('aivencloud.com') ||
    databaseUrl.includes('railway.app') ||
    databaseUrl.includes('clever-cloud.com')
  );

  const useSsl = process.env.DB_SSL === 'true' || isCloudHost;
  const sslConfig = useSsl ? { rejectUnauthorized: false } : undefined;

  if (databaseUrl) {
    return {
      uri: databaseUrl,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      ...(sslConfig ? { ssl: sslConfig } : {})
    };
  }

  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = Number(process.env.DB_PORT) || 3306;
  const dbUser = process.env.DB_USER || 'root';
  const dbPassword = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'root';
  const dbName = process.env.DB_NAME || 'vt_suite';

  return {
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 15000,
    ...(sslConfig ? { ssl: sslConfig } : {})
  };
}

let pool;

function getPool() {
  if (!pool) {
    const config = getPoolConfig();
    pool = config.uri ? mysql.createPool(config.uri) : mysql.createPool(config);
  }
  return pool;
}

async function initDB() {
  const config = getPoolConfig();
  const dbName = config.database || process.env.DB_NAME || 'vt_suite';

  // Step 1: Attempt to create database if on local instance (ignored on cloud if permission restricted)
  if (!config.uri && (config.host === 'localhost' || config.host === '127.0.0.1')) {
    try {
      const rootConn = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password
      });
      await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
      await rootConn.end();
    } catch (err) {
      // Ignore if cannot create database
    }
  }

  // Step 2: Initialize connection pool
  const dbPool = getPool();

  // Step 3: Initialize tables (Universal MySQL 5.5 - 8.0+ compatible)
  try {
    // 3.1 Users table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_name VARCHAR(150) NOT NULL,
        mobile_number VARCHAR(20) NOT NULL UNIQUE,
        email VARCHAR(150) NOT NULL UNIQUE,
        company_name VARCHAR(150) NOT NULL,
        service_needed VARCHAR(100) DEFAULT 'full_suite',
        password_hash VARCHAR(255) NULL,
        role VARCHAR(50) DEFAULT 'admin',
        status VARCHAR(50) DEFAULT 'active',
        avatar VARCHAR(500) NULL,
        trial_ends_at DATETIME NULL,
        trial_status VARCHAR(20) DEFAULT 'active',
        reminder_sent_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Auto-migration columns for users if needed
    try { await dbPool.query(`ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER service_needed;`); } catch (e) {}
    try { await dbPool.query(`ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'admin' AFTER password_hash;`); } catch (e) {}
    try { await dbPool.query(`ALTER TABLE users ADD COLUMN status VARCHAR(50) DEFAULT 'active' AFTER role;`); } catch (e) {}
    try { await dbPool.query(`ALTER TABLE users ADD COLUMN avatar VARCHAR(500) NULL AFTER status;`); } catch (e) {}
    try { await dbPool.query(`ALTER TABLE users ADD COLUMN service_needed VARCHAR(100) DEFAULT 'full_suite' AFTER company_name;`); } catch (e) {}
    try { await dbPool.query(`ALTER TABLE users ADD COLUMN trial_ends_at DATETIME NULL AFTER service_needed;`); } catch (e) {}
    try { await dbPool.query(`ALTER TABLE users ADD COLUMN trial_status VARCHAR(20) DEFAULT 'active' AFTER trial_ends_at;`); } catch (e) {}
    try { await dbPool.query(`ALTER TABLE users ADD COLUMN reminder_sent_at DATETIME NULL AFTER trial_status;`); } catch (e) {}

    // Backfill missing trial_ends_at
    try {
      await dbPool.query(`
        UPDATE users 
        SET trial_ends_at = DATE_ADD(created_at, INTERVAL 7 DAY) 
        WHERE trial_ends_at IS NULL;
      `);
    } catch (e) {}

    // 3.2 Invoices table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id VARCHAR(50) PRIMARY KEY,
        user_id INT NULL,
        customer_id VARCHAR(50) NULL,
        invoice_number VARCHAR(100) NOT NULL,
        customer_name VARCHAR(150) NULL,
        customer_company VARCHAR(150) NULL,
        customer_email VARCHAR(150) NULL,
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
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NULL,
        INDEX idx_inv_user (user_id),
        INDEX idx_inv_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.3 Invoice Items table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id VARCHAR(50) PRIMARY KEY,
        invoice_id VARCHAR(50) NOT NULL,
        description TEXT NULL,
        quantity INT DEFAULT 1,
        rate DECIMAL(15,2) DEFAULT 0,
        amount DECIMAL(15,2) DEFAULT 0,
        hsn VARCHAR(50) DEFAULT '998313',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_item_invoice (invoice_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.4 Leads table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id          VARCHAR(50) PRIMARY KEY,
        user_id     INT NULL,
        name        VARCHAR(150) NOT NULL,
        company     VARCHAR(150) NOT NULL,
        email       VARCHAR(150) NULL,
        phone       VARCHAR(50) NULL,
        source      VARCHAR(80) DEFAULT 'Website',
        stage       VARCHAR(80) DEFAULT 'New',
        value       DECIMAL(15,2) DEFAULT 0,
        assigned_to VARCHAR(150) NULL,
        notes       TEXT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME NULL,
        INDEX idx_leads_user (user_id),
        INDEX idx_leads_stage (stage)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.5 Customers / Clients table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id          VARCHAR(50) PRIMARY KEY,
        user_id     INT NULL,
        name        VARCHAR(150) NOT NULL,
        email       VARCHAR(150) NULL,
        phone       VARCHAR(50) NULL,
        company     VARCHAR(150) NULL,
        address     TEXT NULL,
        status      VARCHAR(50) DEFAULT 'active',
        total_value DECIMAL(15,2) DEFAULT 0,
        notes       TEXT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME NULL,
        INDEX idx_cust_user (user_id),
        INDEX idx_cust_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.6 Deals / Pipeline table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS deals (
        id                 VARCHAR(50) PRIMARY KEY,
        user_id            INT NULL,
        customer_id        VARCHAR(50) NULL,
        lead_id            VARCHAR(50) NULL,
        title              VARCHAR(200) NOT NULL,
        value              DECIMAL(15,2) DEFAULT 0,
        stage              VARCHAR(50) DEFAULT 'prospecting',
        probability        INT DEFAULT 20,
        expected_close_date DATE NULL,
        assigned_to        VARCHAR(150) NULL,
        notes              TEXT NULL,
        created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at         DATETIME NULL,
        INDEX idx_deal_user (user_id),
        INDEX idx_deal_stage (stage)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.7 Tasks table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id           VARCHAR(50) PRIMARY KEY,
        user_id      INT NULL,
        title        VARCHAR(200) NOT NULL,
        description  TEXT NULL,
        type         VARCHAR(50) DEFAULT 'task',
        priority     VARCHAR(50) DEFAULT 'medium',
        status       VARCHAR(50) DEFAULT 'pending',
        assigned_to  VARCHAR(150) NULL,
        related_type VARCHAR(50) NULL,
        related_id   VARCHAR(50) NULL,
        due_date     DATETIME NULL,
        completed_at DATETIME NULL,
        created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME NULL,
        INDEX idx_task_user (user_id),
        INDEX idx_task_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.8 HR Employees table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS hr_employees (
        id           VARCHAR(50) PRIMARY KEY,
        user_id      INT NULL,
        name         VARCHAR(150) NOT NULL,
        email        VARCHAR(150) NULL,
        phone        VARCHAR(50) NULL,
        designation  VARCHAR(150) NOT NULL,
        department   VARCHAR(100) DEFAULT 'Operations',
        joining_date DATE NULL,
        salary       DECIMAL(15,2) DEFAULT 0,
        status       VARCHAR(50) DEFAULT 'Active',
        created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME NULL,
        INDEX idx_emp_user (user_id),
        INDEX idx_emp_dept (department)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.9 HR Attendance table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS hr_attendance (
        id          VARCHAR(50) PRIMARY KEY,
        user_id     INT NULL,
        employee_id VARCHAR(50) NOT NULL,
        date        DATE NOT NULL,
        check_in    TIME NULL,
        check_out   TIME NULL,
        status      VARCHAR(50) DEFAULT 'Present',
        notes       VARCHAR(255) NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_att_user_date (user_id, date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.10 HR Leaves table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS hr_leaves (
        id          VARCHAR(50) PRIMARY KEY,
        user_id     INT NULL,
        employee_id VARCHAR(50) NOT NULL,
        leave_type  VARCHAR(50) DEFAULT 'Casual',
        from_date   DATE NOT NULL,
        to_date     DATE NOT NULL,
        reason      TEXT NULL,
        status      VARCHAR(50) DEFAULT 'Pending',
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_leave_user (user_id),
        INDEX idx_leave_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.11 HR Payroll table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS hr_payroll (
        id           VARCHAR(50) PRIMARY KEY,
        user_id      INT NULL,
        employee_id  VARCHAR(50) NOT NULL,
        month_year   VARCHAR(20) NOT NULL,
        base_salary  DECIMAL(15,2) DEFAULT 0,
        bonuses      DECIMAL(15,2) DEFAULT 0,
        deductions   DECIMAL(15,2) DEFAULT 0,
        net_salary   DECIMAL(15,2) DEFAULT 0,
        payment_date DATE NULL,
        status       VARCHAR(50) DEFAULT 'Pending',
        created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_payroll_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.12 Projects table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id          VARCHAR(50) PRIMARY KEY,
        user_id     INT NULL,
        name        VARCHAR(200) NOT NULL,
        client_name VARCHAR(150) NULL,
        status      VARCHAR(50) DEFAULT 'In Progress',
        budget      DECIMAL(15,2) DEFAULT 0,
        deadline    DATE NULL,
        progress    INT DEFAULT 0,
        description TEXT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME NULL,
        INDEX idx_proj_user (user_id),
        INDEX idx_proj_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.13 Workspace Events / Calendar table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS workspace_events (
        id          VARCHAR(50) PRIMARY KEY,
        user_id     INT NULL,
        title       VARCHAR(200) NOT NULL,
        start_time  DATETIME NOT NULL,
        end_time    DATETIME NULL,
        category    VARCHAR(50) DEFAULT 'Meeting',
        description TEXT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_event_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.14 Workspace Tickets table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS workspace_tickets (
        id          VARCHAR(50) PRIMARY KEY,
        user_id     INT NULL,
        subject     VARCHAR(250) NOT NULL,
        requester   VARCHAR(150) NULL,
        priority    VARCHAR(50) DEFAULT 'Medium',
        status      VARCHAR(50) DEFAULT 'Open',
        description TEXT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME NULL,
        INDEX idx_ticket_user (user_id),
        INDEX idx_ticket_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3.15 Lead Follow-ups table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS leads_followups (
        id             VARCHAR(50) PRIMARY KEY,
        lead_id        VARCHAR(50) NOT NULL,
        user_id        INT NULL,
        follow_up_date DATE NOT NULL,
        follow_up_time VARCHAR(20) NULL,
        notes          TEXT NULL,
        completed      TINYINT(1) DEFAULT 0,
        created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_fup_lead (lead_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log(`✅ MySQL Database '${dbName}' (${config.host}) & Full Suite Tables ready.`);
  } catch (error) {
    console.error('❌ Database Initialization Warning:', error.message);
  }
}

initDB();

const db = {
  async query(sql, params) {
    const p = getPool();
    return p.query(sql, params);
  },
  async getConnection() {
    const p = getPool();
    return p.getConnection();
  }
};

module.exports = db;
