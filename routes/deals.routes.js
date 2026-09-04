const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { optionalAuth } = require('../middleware/auth');
const usageTracker = require('../src/admin/usage_tracker.middleware');

router.use(usageTracker('crm'));

const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

// GET /api/deals/pipeline/summary - Pipeline stage summary
router.get('/pipeline/summary', optionalAuth, async (req, res) => {
  try {
    const filterUserId = req.userId;
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (filterUserId) {
      whereClause += ' AND (user_id = ? OR user_id IS NULL)';
      params.push(filterUserId);
    }

    const [rows] = await db.query(`
      SELECT stage, COUNT(*) AS count, COALESCE(SUM(value), 0) AS total_value
      FROM deals
      ${whereClause}
      GROUP BY stage
    `, sanitize(...params));

    const pipelineStages = ['prospecting', 'qualification', 'proposal', 'negotiation'];
    const closedStages = ['closed-won', 'closed-lost'];

    const pipeline = (rows || []).filter(r => pipelineStages.includes(r.stage));
    const closed = (rows || []).filter(r => closedStages.includes(r.stage));

    return res.status(200).json({
      success: true,
      pipeline: pipeline || [],
      closed: closed || []
    });
  } catch (err) {
    console.error('Error fetching pipeline summary:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch pipeline summary.' });
  }
});

// GET /api/deals - List all deals
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { search, stage, customerId, page = 1, limit = 50, minValue, maxValue } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const filterUserId = req.userId;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (filterUserId) {
      whereClause += ' AND (user_id = ? OR user_id IS NULL)';
      params.push(filterUserId);
    }
    if (stage && stage !== 'all') {
      whereClause += ' AND stage = ?';
      params.push(stage);
    }
    if (customerId) {
      whereClause += ' AND customer_id = ?';
      params.push(customerId);
    }
    if (minValue) {
      whereClause += ' AND value >= ?';
      params.push(parseFloat(minValue));
    }
    if (maxValue) {
      whereClause += ' AND value <= ?';
      params.push(parseFloat(maxValue));
    }
    if (search) {
      whereClause += ' AND title LIKE ?';
      params.push(`%${search}%`);
    }

    const countSql = `SELECT COUNT(*) AS total FROM deals ${whereClause}`;
    const [countRows] = await db.query(countSql, sanitize(...params));
    const total = countRows[0]?.total || 0;

    const dataSql = `SELECT * FROM deals ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const [deals] = await db.query(dataSql, sanitize(...params, parseInt(limit, 10), offset));

    return res.status(200).json({
      success: true,
      deals: deals || [],
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)) || 1
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch deals.' });
  }
});

// GET /api/deals/:id - Single deal
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM deals WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Deal not found.' });
    }
    return res.status(200).json({ success: true, deal: rows[0], related: {} });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch deal.' });
  }
});

// POST /api/deals - Create deal
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { title, value, stage, customerId, customer_id, probability, expected_close_date, assigned_to, notes, userId } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'Deal title is required.' });
    }

    const dealId = `DEAL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const finalUserId = req.userId || userId || null;

    await db.query(
      `INSERT INTO deals (id, user_id, customer_id, title, value, stage, probability, expected_close_date, assigned_to, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sanitize(
        dealId,
        finalUserId,
        customerId || customer_id || null,
        String(title).trim(),
        parseFloat(value) || 0,
        stage || 'prospecting',
        probability ? parseInt(probability, 10) : 20,
        expected_close_date || null,
        assigned_to || null,
        notes || null
      )
    );

    const [created] = await db.query('SELECT * FROM deals WHERE id = ?', [dealId]);
    return res.status(201).json({
      success: true,
      message: 'Deal created successfully.',
      deal: created[0]
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to create deal.' });
  }
});

// PUT /api/deals/:id - Update deal
router.put('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, value, stage, probability, expected_close_date, assigned_to, notes } = req.body;

    const fields = [];
    const params = [];

    if (title !== undefined) { fields.push('title = ?'); params.push(String(title).trim()); }
    if (value !== undefined) { fields.push('value = ?'); params.push(parseFloat(value) || 0); }
    if (stage !== undefined) { fields.push('stage = ?'); params.push(stage); }
    if (probability !== undefined) { fields.push('probability = ?'); params.push(parseInt(probability, 10)); }
    if (expected_close_date !== undefined) { fields.push('expected_close_date = ?'); params.push(expected_close_date); }
    if (assigned_to !== undefined) { fields.push('assigned_to = ?'); params.push(assigned_to); }
    if (notes !== undefined) { fields.push('notes = ?'); params.push(notes); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update.' });
    }

    fields.push('updated_at = NOW()');
    params.push(id);

    const [result] = await db.query(`UPDATE deals SET ${fields.join(', ')} WHERE id = ?`, sanitize(...params));
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Deal not found.' });
    }

    const [updated] = await db.query('SELECT * FROM deals WHERE id = ?', [id]);
    return res.status(200).json({
      success: true,
      message: 'Deal updated successfully.',
      deal: updated[0]
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update deal.' });
  }
});

// DELETE /api/deals/:id - Delete deal
router.delete('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM deals WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Deal not found.' });
    }
    return res.status(200).json({ success: true, message: 'Deal deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete deal.' });
  }
});

module.exports = router;
