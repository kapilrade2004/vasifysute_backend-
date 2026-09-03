const db = require('../database/db');

// Create new user record with automatic 7-Day Free Trial
async function createUser(userData) {
  const { user_name, mobile_number, email, company_name, service_needed } = userData;
  const service = service_needed || 'full_suite';
  
  // Set 7-day free trial end date
  const sql = `
    INSERT INTO users (user_name, mobile_number, email, company_name, service_needed, trial_ends_at, trial_status)
    VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), 'active')
  `;
  const [result] = await db.query(sql, [user_name, mobile_number, email, company_name, service]);
  
  return getUserById(result.insertId);
}

// Get all users ordered by creation date descending with trial calculations
async function getAllUsers() {
  const sql = `
    SELECT 
      id, user_name, mobile_number, email, company_name, service_needed,
      created_at, updated_at, trial_ends_at, trial_status, reminder_sent_at,
      TIMESTAMPDIFF(DAY, NOW(), trial_ends_at) AS days_left
    FROM users 
    ORDER BY id DESC
  `;
  const [rows] = await db.query(sql);
  return rows;
}

// Get user by ID
async function getUserById(id) {
  const sql = `
    SELECT 
      id, user_name, mobile_number, email, company_name, service_needed,
      created_at, updated_at, trial_ends_at, trial_status, reminder_sent_at,
      TIMESTAMPDIFF(DAY, NOW(), trial_ends_at) AS days_left
    FROM users 
    WHERE id = ?
  `;
  const [rows] = await db.query(sql, [id]);
  return rows[0] || null;
}

// Update user record by ID
async function updateUser(id, userData) {
  const { user_name, mobile_number, email, company_name } = userData;
  const sql = `
    UPDATE users
    SET user_name = ?, mobile_number = ?, email = ?, company_name = ?
    WHERE id = ?
  `;
  const [result] = await db.query(sql, [user_name, mobile_number, email, company_name, id]);
  if (result.affectedRows === 0) return null;
  return getUserById(id);
}

// Delete user record by ID
async function deleteUser(id) {
  const sql = `DELETE FROM users WHERE id = ?`;
  const [result] = await db.query(sql, [id]);
  return result.affectedRows > 0;
}

// Upgrade user to Premium
async function upgradeToPremium(id) {
  const sql = `UPDATE users SET trial_status = 'premium' WHERE id = ?`;
  await db.query(sql, [id]);
  return getUserById(id);
}

// Update trial status & reminder timestamp
async function updateTrialReminder(id, status) {
  const sql = `UPDATE users SET trial_status = ?, reminder_sent_at = NOW() WHERE id = ?`;
  await db.query(sql, [status, id]);
  return getUserById(id);
}

// Find user by email
async function findByEmail(email, excludeId = null) {
  let sql = `SELECT * FROM users WHERE email = ?`;
  const params = [email];
  if (excludeId) {
    sql += ` AND id != ?`;
    params.push(excludeId);
  }
  const [rows] = await db.query(sql, params);
  return rows[0] || null;
}

// Find user by mobile number
async function findByMobile(mobile_number, excludeId = null) {
  let sql = `SELECT * FROM users WHERE mobile_number = ?`;
  const params = [mobile_number];
  if (excludeId) {
    sql += ` AND id != ?`;
    params.push(excludeId);
  }
  const [rows] = await db.query(sql, params);
  return rows[0] || null;
}

module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  upgradeToPremium,
  updateTrialReminder,
  findByEmail,
  findByMobile
};
