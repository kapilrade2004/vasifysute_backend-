const express = require('express');
const router = express.Router();
const db = require('../database/db');
const usageTracker = require('../src/admin/usage_tracker.middleware');

router.use(usageTracker('crm'));

const sanitize = (...params) => params.map(p => (p === undefined ? null : p));

function generateActivityId() {
  return `ACT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// ── Auto-create activities table if missing ──────────────────────────────────
async function ensureActivitiesTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS activities (
        id              VARCHAR(50) PRIMARY KEY,
        organization_id VARCHAR(50) NULL,
        user_id         INT NULL,
        entity_type     VARCHAR(50) NOT NULL,
        entity_id       VARCHAR(50) NOT NULL,
        type            VARCHAR(50) NOT NULL,
        title           VARCHAR(255) NOT NULL,
        description     TEXT NULL,
        outcome         VARCHAR(100) NULL,
        scheduled_at    DATETIME NULL,
        completed_at    DATETIME NULL,
        created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_act_entity (entity_type, entity_id),
        INDEX idx_act_user (user_id),
        INDEX idx_act_type (type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Activities table ready.');
  } catch (err) {
    console.warn('Activities table auto-create warning:', err.message);
  }
}
ensureActivitiesTable();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/activities
// Query params: ?entityType=lead&entityId=LEAD-123 &type=call &limit=50
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { entityType, entityId, type, limit = 50 } = req.query;

    let query = `SELECT * FROM activities WHERE 1=1`;
    const params = [];

    if (entityType) {
      query += ` AND entity_type = ?`;
      params.push(entityType);
    }
    if (entityId) {
      query += ` AND entity_id = ?`;
      params.push(entityId);
    }
    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(parseInt(limit, 10) || 50);

    const [activities] = await db.query(query, sanitize(...params));
    return res.status(200).json({
      success: true,
      activities: activities || []
    });
  } catch (err) {
    console.error('Error fetching activities:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch activities.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/activities — Log an activity
// Body: { entityType, entityId, type, title, description, outcome, scheduledAt, completedAt, userId, organizationId }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      entityType,
      entityId,
      type,
      title,
      description,
      outcome,
      scheduledAt,
      completedAt,
      userId,
      organizationId
    } = req.body;

    if (!entityType || !entityId || !type || !title) {
      return res.status(400).json({
        success: false,
        message: 'entityType, entityId, type, and title are required.'
      });
    }

    const activityId = generateActivityId();

    await db.query(
      `INSERT INTO activities 
        (id, organization_id, user_id, entity_type, entity_id, type, title, description, outcome, scheduled_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sanitize(
        activityId,
        organizationId || null,
        userId || null,
        entityType,
        entityId,
        type,
        String(title).trim(),
        description ? String(description).trim() : null,
        outcome || null,
        scheduledAt ? new Date(scheduledAt) : null,
        completedAt ? new Date(completedAt) : new Date()
      )
    );

    const [rows] = await db.query(`SELECT * FROM activities WHERE id = ?`, [activityId]);
    return res.status(201).json({
      success: true,
      message: 'Activity logged successfully.',
      activity: rows[0]
    });
  } catch (err) {
    console.error('Error creating activity:', err);
    return res.status(500).json({ success: false, message: 'Failed to log activity.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/activities/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query(`DELETE FROM activities WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Activity not found.' });
    }

    return res.status(200).json({ success: true, message: 'Activity deleted successfully.' });
  } catch (err) {
    console.error('Error deleting activity:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete activity.' });
  }
});

module.exports = router;
