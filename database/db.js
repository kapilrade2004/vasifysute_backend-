const mysql = require('mysql2/promise');
require('dotenv').config();

function getPoolConfig() {
  const databaseUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;

  // SSL is required on most cloud hosts (TiDB, Aiven, Railway, etc.)
  const isCloudHost = databaseUrl && (
    databaseUrl.includes('tidbcloud.com') ||
    databaseUrl.includes('aivencloud.com') ||
    databaseUrl.includes('railway.app') ||
    databaseUrl.includes('clever-cloud.com') ||
    databaseUrl.includes('render.com')
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
  if (!config.uri && config.host === 'localhost') {
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
      // Managed databases often disallow creating new DBs; proceed to use default
    }
  }

  // Step 2: Initialize connection pool
  const dbPool = getPool();

  // Step 3: Initialize all tables
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
        trial_ends_at DATETIME NULL,
        trial_status VARCHAR(20) DEFAULT 'active',
        reminder_sent_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Auto-migration: ensure trial columns exist on users
    try {
      await dbPool.query(`ALTER TABLE users ADD COLUMN service_needed VARCHAR(100) DEFAULT 'full_suite' AFTER company_name;`);
    } catch (e) {}
    try {
      await dbPool.query(`ALTER TABLE users ADD COLUMN trial_ends_at DATETIME NULL AFTER service_needed;`);
    } catch (e) {}
    try {
      await dbPool.query(`ALTER TABLE users ADD COLUMN trial_status VARCHAR(20) DEFAULT 'active' AFTER trial_ends_at;`);
    } catch (e) {}
    try {
      await dbPool.query(`ALTER TABLE users ADD COLUMN reminder_sent_at DATETIME NULL AFTER trial_status;`);
    } catch (e) {}

    // Backfill any missing trial_ends_at
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log(`✅ MySQL Database '${dbName}' & Tables (users, invoices, invoice_items) ready.`);
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
