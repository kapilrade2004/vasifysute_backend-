const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const { sendTrialEmail } = require('../services/email.service');

// Helper to sanitize inputs
const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

// POST /api/auth/register (also supports /signup)
router.post(['/register', '/signup'], async (req, res) => {
  try {
    const { name, user_name, email, password, mobile_number, company_name, service_needed, role } = req.body;
    const finalName = (name || user_name || '').trim();
    const finalEmail = (email || '').trim().toLowerCase();
    const finalCompany = (company_name || `${finalName}'s Company`).trim();
    const finalMobile = (mobile_number || '9876543210').trim();
    const finalRole = role || 'admin';

    if (!finalName || !finalEmail || !password) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and password are required.',
        message: 'Name, email, and password are required.'
      });
    }

    // Check existing user
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [finalEmail]);
    if (existing && existing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'An account with this email already exists.',
        message: 'An account with this email already exists.'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Insert user with 7-day trial
    const [result] = await db.query(
      `INSERT INTO users 
        (user_name, email, mobile_number, company_name, service_needed, password_hash, role, status, trial_ends_at, trial_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', DATE_ADD(NOW(), INTERVAL 7 DAY), 'active')`,
      sanitize(finalName, finalEmail, finalMobile, finalCompany, service_needed || 'full_suite', password_hash, finalRole)
    );

    const userId = result.insertId;

    // Fetch newly created user
    const [userRows] = await db.query(
      `SELECT id, user_name, email, mobile_number, company_name, service_needed, role, status, trial_ends_at, trial_status, created_at,
              TIMESTAMPDIFF(DAY, NOW(), trial_ends_at) AS days_left
       FROM users WHERE id = ?`,
      [userId]
    );
    const user = userRows[0];

    // Sign JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.user_name, role: user.role, company: user.company_name },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Send Welcome Email asynchronously
    const endDateStr = user.trial_ends_at ? new Date(user.trial_ends_at).toLocaleDateString() : '7 days from now';
    const welcomeHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff;">
        <h2 style="color: #1DA851;">Welcome to VasifyTech Suite!</h2>
        <p>Hi <strong>${user.user_name}</strong>,</p>
        <p>Your 7-Day Free Trial for <strong>${user.company_name}</strong> is active until <strong>${endDateStr}</strong>.</p>
        <p>You can now manage your CRM, HR & Payroll, Projects, and Invoicing in one place.</p>
      </div>
    `;
    sendTrialEmail(user.email, '🚀 Welcome to VasifyTech Suite — Free Trial Activated!', `Welcome ${user.user_name}!`, welcomeHtml).catch(() => {});

    return res.status(201).json({
      success: true,
      message: 'Registration successful! 7-day free trial activated.',
      token,
      user: {
        id: user.id,
        name: user.user_name,
        email: user.email,
        role: user.role,
        company: user.company_name,
        trial_status: user.trial_status,
        days_left: user.days_left
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create user account.', message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.',
        message: 'Email and password are required.'
      });
    }

    const trimmedEmail = String(email).trim().toLowerCase();
    const [rows] = await db.query(
      `SELECT id, user_name, email, password_hash, company_name, role, status, trial_ends_at, trial_status,
              TIMESTAMPDIFF(DAY, NOW(), trial_ends_at) AS days_left
       FROM users WHERE email = ?`,
      [trimmedEmail]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
        message: 'Invalid email or password.'
      });
    }

    const user = rows[0];

    // If password_hash exists, check with bcrypt; if empty (legacy seed user), allow login or upgrade
    if (user.password_hash) {
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password.',
          message: 'Invalid email or password.'
        });
      }
    }

    // Update last active
    await db.query('UPDATE users SET updated_at = NOW() WHERE id = ?', [user.id]).catch(() => {});

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.user_name, role: user.role, company: user.company_name },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        name: user.user_name,
        email: user.email,
        role: user.role || 'admin',
        company: user.company_name,
        trial_status: user.trial_status,
        days_left: user.days_left
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, error: 'Login failed.', message: err.message });
  }
});

// GET /api/auth/verify
router.get('/verify', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, user_name, email, mobile_number, company_name, service_needed, role, status, trial_ends_at, trial_status,
              TIMESTAMPDIFF(DAY, NOW(), trial_ends_at) AS days_left
       FROM users WHERE id = ?`,
      [req.userId]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({ valid: false, message: 'User not found.' });
    }

    const u = rows[0];
    return res.status(200).json({
      valid: true,
      user: {
        id: u.id,
        name: u.user_name,
        email: u.email,
        mobile_number: u.mobile_number,
        company: u.company_name,
        role: u.role,
        status: u.status,
        trial_status: u.trial_status,
        days_left: u.days_left
      }
    });
  } catch (err) {
    return res.status(401).json({ valid: false, message: 'Invalid token.' });
  }
});

// GET /api/auth/profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, user_name AS name, email, mobile_number, company_name, service_needed, role, status, avatar, trial_ends_at, trial_status,
              TIMESTAMPDIFF(DAY, NOW(), trial_ends_at) AS days_left
       FROM users WHERE id = ?`,
      [req.userId]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    return res.status(200).json({ success: true, user: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch profile.' });
  }
});

// PUT /api/auth/profile
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name, user_name, company_name, mobile_number, avatar } = req.body;
    const finalName = (name || user_name || '').trim();

    const fields = [];
    const params = [];

    if (finalName) { fields.push('user_name = ?'); params.push(finalName); }
    if (company_name) { fields.push('company_name = ?'); params.push(company_name.trim()); }
    if (mobile_number) { fields.push('mobile_number = ?'); params.push(mobile_number.trim()); }
    if (avatar !== undefined) { fields.push('avatar = ?'); params.push(avatar); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update.' });
    }

    fields.push('updated_at = NOW()');
    params.push(req.userId);

    await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, sanitize(...params));

    const [updated] = await db.query(
      `SELECT id, user_name AS name, email, mobile_number, company_name, role, status, avatar FROM users WHERE id = ?`,
      [req.userId]
    );

    return res.status(200).json({ success: true, message: 'Profile updated successfully.', user: updated[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update profile.' });
  }
});

// PUT /api/auth/change-password
router.put('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long.' });
    }

    const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ?', [req.userId]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const currentHash = rows[0].password_hash;
    if (currentHash && currentPassword) {
      const match = await bcrypt.compare(currentPassword, currentHash);
      if (!match) {
        return res.status(400).json({ success: false, error: 'Current password does not match.' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await db.query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [newHash, req.userId]);
    return res.status(200).json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to change password.' });
  }
});

module.exports = router;
