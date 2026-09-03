const db = require('./db');

async function addServiceNeededColumn() {
  try {
    console.log('🔄 Updating MySQL table schema...');
    await db.query(`
      ALTER TABLE users 
      ADD COLUMN service_needed VARCHAR(100) DEFAULT 'full_suite' AFTER company_name;
    `);
    console.log('✅ Successfully added service_needed column to MySQL users table!');
  } catch (error) {
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ️ Column service_needed already exists in MySQL table.');
    } else {
      console.error('❌ Database migration error:', error.message);
    }
  } finally {
    process.exit(0);
  }
}

addServiceNeededColumn();
