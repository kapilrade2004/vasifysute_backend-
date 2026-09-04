const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { optionalAuth } = require('../middleware/auth');
const usageTracker = require('../src/admin/usage_tracker.middleware');

router.use(usageTracker('projects'));

const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

// GET /api/tasks/stats/overview - Tasks overview metrics
router.get('/stats/overview', optionalAuth, async (req, res) => {
  try {
    const { assignedTo } = req.query;
    const filterUserId = req.userId;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (filterUserId) {
      whereClause += ' AND (user_id = ? OR user_id IS NULL)';
      params.push(filterUserId);
    }
    if (assignedTo) {
      whereClause += ' AND assigned_to = ?';
      params.push(assignedTo);
    }

    const [statusRows] = await db.query(
      `SELECT status, COUNT(*) AS count FROM tasks ${whereClause} GROUP BY status`,
      sanitize(...params)
    );

    const [overdueRows] = await db.query(
      `SELECT COUNT(*) AS count FROM tasks ${whereClause} AND due_date < NOW() AND status != 'completed'`,
      sanitize(...params)
    );

    const [todayRows] = await db.query(
      `SELECT COUNT(*) AS count FROM tasks ${whereClause} AND DATE(due_date) = CURDATE()`,
      sanitize(...params)
    );

    return res.status(200).json({
      success: true,
      statusBreakdown: statusRows || [],
      overdue: overdueRows[0]?.count || 0,
      dueToday: todayRows[0]?.count || 0
    });
  } catch (err) {
    console.error('Error fetching task stats:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch task stats.' });
  }
});

// GET /api/tasks - List all tasks
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { search, type, priority, status, assignedTo, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const filterUserId = req.userId;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (filterUserId) {
      whereClause += ' AND (user_id = ? OR user_id IS NULL)';
      params.push(filterUserId);
    }
    if (type && type !== 'all') {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    if (priority && priority !== 'all') {
      whereClause += ' AND priority = ?';
      params.push(priority);
    }
    if (status && status !== 'all') {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    if (assignedTo) {
      whereClause += ' AND assigned_to = ?';
      params.push(assignedTo);
    }
    if (search) {
      whereClause += ' AND (title LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const countSql = `SELECT COUNT(*) AS total FROM tasks ${whereClause}`;
    const [countRows] = await db.query(countSql, sanitize(...params));
    const total = countRows[0]?.total || 0;

    const dataSql = `SELECT * FROM tasks ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const [tasks] = await db.query(dataSql, sanitize(...params, parseInt(limit, 10), offset));

    return res.status(200).json({
      success: true,
      tasks: tasks || [],
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)) || 1
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch tasks.' });
  }
});

// GET /api/tasks/:id - Single task
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }
    return res.status(200).json({ success: true, task: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch task.' });
  }
});

// POST /api/tasks - Create task
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { title, description, type, priority, status, assigned_to, related_type, related_id, due_date, userId } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'Task title is required.' });
    }

    const taskId = `TASK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const finalUserId = req.userId || userId || null;

    await db.query(
      `INSERT INTO tasks (id, user_id, title, description, type, priority, status, assigned_to, related_type, related_id, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sanitize(
        taskId,
        finalUserId,
        String(title).trim(),
        description || null,
        type || 'task',
        priority || 'medium',
        status || 'pending',
        assigned_to || null,
        related_type || null,
        related_id || null,
        due_date || null
      )
    );

    const [created] = await db.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
    return res.status(201).json({
      success: true,
      message: 'Task created successfully.',
      task: created[0]
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to create task.' });
  }
});

// PUT /api/tasks/:id - Update task
router.put('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, type, priority, status, assigned_to, due_date } = req.body;

    const fields = [];
    const params = [];

    if (title !== undefined) { fields.push('title = ?'); params.push(String(title).trim()); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }
    if (type !== undefined) { fields.push('type = ?'); params.push(type); }
    if (priority !== undefined) { fields.push('priority = ?'); params.push(priority); }
    if (status !== undefined) {
      fields.push('status = ?');
      params.push(status);
      if (status === 'completed') {
        fields.push('completed_at = NOW()');
      }
    }
    if (assigned_to !== undefined) { fields.push('assigned_to = ?'); params.push(assigned_to); }
    if (due_date !== undefined) { fields.push('due_date = ?'); params.push(due_date); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update.' });
    }

    fields.push('updated_at = NOW()');
    params.push(id);

    const [result] = await db.query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, sanitize(...params));
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    const [updated] = await db.query('SELECT * FROM tasks WHERE id = ?', [id]);
    return res.status(200).json({
      success: true,
      message: 'Task updated successfully.',
      task: updated[0]
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update task.' });
  }
});

// DELETE /api/tasks/:id - Delete task
router.delete('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM tasks WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }
    return res.status(200).json({ success: true, message: 'Task deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete task.' });
  }
});

module.exports = router;
