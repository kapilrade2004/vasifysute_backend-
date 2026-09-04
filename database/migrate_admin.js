const fs = require('fs');
const path = require('path');
const db = require('./db');

async function migrateAdmin() {
  console.log('🔄 Running Master Admin Database Migrations...');
  try {
    const migrationSqlPath = path.join(__dirname, 'migrations', '001_create_admin_tables.sql');
    const sql = fs.readFileSync(migrationSqlPath, 'utf8');

    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      await db.query(statement);
    }

    console.log('✅ Master Admin Database Tables created successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

migrateAdmin();
