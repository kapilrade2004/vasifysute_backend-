const db = require('./db');

const sampleUsers = [
  {
    user_name: 'Kapil Rade',
    mobile_number: '9876543210',
    email: 'kapil@example.com',
    company_name: 'ABC Technologies'
  },
  {
    user_name: 'John Doe',
    mobile_number: '9123456789',
    email: 'john@example.com',
    company_name: 'VasifyTech Solutions'
  }
];

async function seedDatabase() {
  try {
    console.log('🌱 Seeding sample users...');
    for (const u of sampleUsers) {
      await db.query(
        `INSERT INTO users (user_name, mobile_number, email, company_name)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE user_name=VALUES(user_name)`,
        [u.user_name, u.mobile_number, u.email, u.company_name]
      );
    }
    console.log('✅ Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding error:', error.message);
    process.exit(1);
  }
}

seedDatabase();
