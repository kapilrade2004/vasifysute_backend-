const mysql = require('mysql2/promise');
require('dotenv').config();

const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = Number(process.env.DB_PORT) || 3306;
const dbUser = process.env.DB_USER || 'root';
const dbPassword = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'root';
const dbName = process.env.DB_NAME || 'vt_suite';

let pool;

async function initDB() {
  try {
    const rootConn = await mysql.createConnection({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword
    });

    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await rootConn.end();

    pool = mysql.createPool({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    const createTableSql = `
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
      );
    `;
    await pool.query(createTableSql);

    // Auto-migration: ensure columns exist on existing table
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN service_needed VARCHAR(100) DEFAULT 'full_suite' AFTER company_name;`);
    } catch (e) {}
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN trial_ends_at DATETIME NULL AFTER service_needed;`);
    } catch (e) {}
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN trial_status VARCHAR(20) DEFAULT 'active' AFTER trial_ends_at;`);
    } catch (e) {}
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN reminder_sent_at DATETIME NULL AFTER trial_status;`);
    } catch (e) {}

    // Backfill any missing trial_ends_at with 7 days after created_at
    await pool.query(`
      UPDATE users 
      SET trial_ends_at = DATE_ADD(created_at, INTERVAL 7 DAY) 
      WHERE trial_ends_at IS NULL;
    `);

    console.log(`✅ MySQL Database '${dbName}' & 7-Day Free Trial Schema ready.`);
  } catch (error) {
    console.error('❌ Database Initialization Warning:', error.message);
    pool = mysql.createPool({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }
}

initDB();

const db = {
  async query(sql, params) {
    if (!pool) {
      pool = mysql.createPool({
        host: dbHost,
        port: dbPort,
        user: dbUser,
        password: dbPassword,
        database: dbName,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
    }
    return pool.query(sql, params);
  },
  async getConnection() {
    if (!pool) {
      pool = mysql.createPool({
        host: dbHost,
        port: dbPort,
        user: dbUser,
        password: dbPassword,
        database: dbName,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
    }
    return pool.getConnection();
  }
};

module.exports = db;
