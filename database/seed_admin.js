const db = require('./db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

async function seedAdmin() {
  console.log('🌱 Seeding Initial Master Super Admin Account...');
  
  const email = process.env.ADMIN_INITIAL_EMAIL || 'admin@vasifytech.com';
  const rawPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@Vasify2026';
  const name = process.env.ADMIN_INITIAL_NAME || 'Master Super Admin';

  try {
    // Check if admin already exists
    const [existing] = await db.query('SELECT id, email FROM admins WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing && existing.length > 0) {
      console.log(`ℹ️ Admin account (${email}) already exists. Skipping seed.`);
      process.exit(0);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(rawPassword, salt);
    const adminId = `admin-${crypto.randomBytes(8).toString('hex')}`;

    await db.query(
      `INSERT INTO admins (id, name, email, password_hash, role, status, created_at) 
       VALUES (?, ?, ?, ?, 'super_admin', 'active', NOW())`,
      [adminId, name, email.trim().toLowerCase(), passwordHash]
    );

    console.log(`✅ Master Super Admin created successfully! Email: ${email}`);
  } catch (err) {
    console.error('❌ Seeding initial admin failed:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

seedAdmin();
