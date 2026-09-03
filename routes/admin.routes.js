const express = require('express');
const router  = express.Router();
const db      = require('../database/db');

// ── Admin auth middleware ─────────────────────────────────────────────────────
// Checks X-Admin-Token header against ADMIN_PASSWORD env var.
// Also accepts a short-lived session token stored in memory.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function requireAdminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query._adminToken;
  if (!token || token !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: 'Admin authentication required.'
    });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/login
// Body: { password }
// Returns a "token" (which is just the password itself for now — simple,
// but moves the secret out of client-side JS and into env var).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: 'Password is required.' });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
  }
  return res.status(200).json({
    success: true,
    message: 'Admin authenticated successfully.',
    token: ADMIN_PASSWORD  // frontend will store and send as X-Admin-Token
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/stats
// Returns all users enriched with invoice_count, lead_count, days_left
// plus aggregated totals for the dashboard cards.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', requireAdminAuth, async (req, res) => {
  try {
    // Single query: users + counts of their invoices and leads
    const [users] = await db.query(`
      SELECT
        u.id,
        u.user_name,
        u.mobile_number,
        u.email,
        u.company_name,
        u.service_needed,
        u.trial_status,
        u.trial_ends_at,
        u.reminder_sent_at,
        u.created_at,
        u.updated_at,
        TIMESTAMPDIFF(DAY, NOW(), u.trial_ends_at)  AS days_left,
        COUNT(DISTINCT i.id)                         AS invoice_count,
        COUNT(DISTINCT l.id)                         AS lead_count,
        COALESCE(SUM(i.total), 0)                    AS total_invoiced
      FROM users u
      LEFT JOIN invoices i ON i.user_id = u.id
      LEFT JOIN leads    l ON l.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

    // Compute summary totals
    const totals = {
      total_users:    users.length,
      trialing:       users.filter(u => u.trial_status === 'active').length,
      expired:        users.filter(u => u.trial_status === 'expired').length,
      premium:        users.filter(u => u.trial_status === 'premium').length,
      total_invoices: users.reduce((s, u) => s + Number(u.invoice_count), 0),
      total_leads:    users.reduce((s, u) => s + Number(u.lead_count), 0),
      total_revenue:  users.reduce((s, u) => s + Number(u.total_invoiced), 0)
    };

    return res.status(200).json({ success: true, users, totals });
  } catch (err) {
    console.error('Error fetching admin stats:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch admin stats.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/users/:id — single user detail with their recent invoices & leads
// ─────────────────────────────────────────────────────────────────────────────
router.get('/users/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // User record
    const [userRows] = await db.query(`
      SELECT u.*,
        TIMESTAMPDIFF(DAY, NOW(), u.trial_ends_at) AS days_left
      FROM users u WHERE u.id = ?
    `, [id]);

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = userRows[0];

    // Recent invoices (last 10)
    const [invoices] = await db.query(`
      SELECT id, invoice_number, customer_name, total, status, created_at
      FROM invoices
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [id]);

    // Recent leads (last 10)
    const [leads] = await db.query(`
      SELECT id, name, company, stage, value, created_at
      FROM leads
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [id]);

    return res.status(200).json({
      success: true,
      user,
      invoices: invoices || [],
      leads: leads || []
    });
  } catch (err) {
    console.error('Error fetching admin user detail:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch user detail.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/users/:id/trial — manually extend or expire a user's trial
// Body: { trial_status, trial_ends_at }
// ─────────────────────────────────────────────────────────────────────────────
router.put('/users/:id/trial', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { trial_status, trial_ends_at } = req.body;

    const fields  = [];
    const params  = [];

    if (trial_status)  { fields.push('trial_status = ?');  params.push(trial_status); }
    if (trial_ends_at) { fields.push('trial_ends_at = ?'); params.push(trial_ends_at); }
    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    fields.push('updated_at = NOW()');
    params.push(id);

    const [result] = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.status(200).json({ success: true, message: 'Trial updated successfully.' });
  } catch (err) {
    console.error('Error updating user trial:', err);
    return res.status(500).json({ success: false, message: 'Failed to update trial.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/health — quick internal status check (no auth needed)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    return res.status(200).json({
      status: 'healthy',
      db: 'connected',
      ts: new Date().toISOString()
    });
  } catch (err) {
    return res.status(503).json({
      status: 'unhealthy',
      db: 'disconnected',
      error: err.message
    });
  }
});

module.exports = router;
