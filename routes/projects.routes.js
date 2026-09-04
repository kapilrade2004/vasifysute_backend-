const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { optionalAuth } = require('../middleware/auth');
const usageTracker = require('../src/admin/usage_tracker.middleware');

router.use(usageTracker('projects'));

const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

// GET /api/projects - List projects
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { status, search } = req.query;
    const filterUserId = req.userId;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (filterUserId) {
      whereClause += ' AND (user_id = ? OR user_id IS NULL)';
      params.push(filterUserId);
    }
    if (status && status !== 'all') {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      whereClause += ' AND (name LIKE ? OR client_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [projects] = await db.query(
      `SELECT * FROM projects ${whereClause} ORDER BY created_at DESC`,
      sanitize(...params)
    );

    return res.status(200).json({ success: true, projects: projects || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch projects.' });
  }
});

// GET /api/projects/:id - Single project
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM projects WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Project not found.' });
    }
    return res.status(200).json({ success: true, project: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch project.' });
  }
});

// POST /api/projects - Create project
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { name, client_name, status, budget, deadline, progress, description, userId } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'Project name is required.' });
    }

    const projId = `PRJ-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const finalUserId = req.userId || userId || null;

    await db.query(
      `INSERT INTO projects (id, user_id, name, client_name, status, budget, deadline, progress, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sanitize(
        projId,
        finalUserId,
        String(name).trim(),
        client_name || null,
        status || 'In Progress',
        parseFloat(budget) || 0,
        deadline || null,
        progress ? parseInt(progress, 10) : 0,
        description || null
      )
    );

    const [created] = await db.query('SELECT * FROM projects WHERE id = ?', [projId]);
    return res.status(201).json({ success: true, message: 'Project created.', project: created[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to create project.' });
  }
});

// PUT /api/projects/:id - Update project
router.put('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, client_name, status, budget, deadline, progress, description } = req.body;

    const fields = [];
    const params = [];

    if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
    if (client_name !== undefined) { fields.push('client_name = ?'); params.push(client_name); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    if (budget !== undefined) { fields.push('budget = ?'); params.push(parseFloat(budget) || 0); }
    if (deadline !== undefined) { fields.push('deadline = ?'); params.push(deadline); }
    if (progress !== undefined) { fields.push('progress = ?'); params.push(parseInt(progress, 10)); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update.' });
    }

    fields.push('updated_at = NOW()');
    params.push(id);

    const [result] = await db.query(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, sanitize(...params));
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Project not found.' });
    }

    const [updated] = await db.query('SELECT * FROM projects WHERE id = ?', [id]);
    return res.status(200).json({ success: true, message: 'Project updated.', project: updated[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update project.' });
  }
});

// DELETE /api/projects/:id - Delete project
router.delete('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM projects WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Project not found.' });
    }
    return res.status(200).json({ success: true, message: 'Project deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete project.' });
  }
});

module.exports = router;
