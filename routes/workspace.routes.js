const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { optionalAuth } = require('../middleware/auth');
const usageTracker = require('../src/admin/usage_tracker.middleware');

router.use(usageTracker('workspace'));

const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

// ── 1. CALENDAR EVENTS ────────────────────────────────────────────────────────

// GET /api/workspace/events - List calendar events
router.get('/events', optionalAuth, async (req, res) => {
  try {
    const filterUserId = req.userId;
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (filterUserId) {
      whereClause += ' AND (user_id = ? OR user_id IS NULL)';
      params.push(filterUserId);
    }

    const [events] = await db.query(
      `SELECT * FROM workspace_events ${whereClause} ORDER BY start_time ASC`,
      sanitize(...params)
    );

    return res.status(200).json({ success: true, events: events || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch events.' });
  }
});

// POST /api/workspace/events - Create calendar event
router.post('/events', optionalAuth, async (req, res) => {
  try {
    const { title, start_time, end_time, category, description } = req.body;
    if (!title || !start_time) {
      return res.status(400).json({ success: false, error: 'Title and start_time are required.' });
    }

    const eventId = `EVT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const finalUserId = req.userId || null;

    await db.query(
      `INSERT INTO workspace_events (id, user_id, title, start_time, end_time, category, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      sanitize(eventId, finalUserId, String(title).trim(), start_time, end_time || null, category || 'Meeting', description || null)
    );

    const [created] = await db.query('SELECT * FROM workspace_events WHERE id = ?', [eventId]);
    return res.status(201).json({ success: true, message: 'Event created.', event: created[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to create event.' });
  }
});

// DELETE /api/workspace/events/:id - Delete calendar event
router.delete('/events/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM workspace_events WHERE id = ?', [id]);
    return res.status(200).json({ success: true, message: 'Event deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete event.' });
  }
});

// ── 2. SUPPORT TICKETS ────────────────────────────────────────────────────────

// GET /api/workspace/tickets - List support tickets
router.get('/tickets', optionalAuth, async (req, res) => {
  try {
    const { status, priority, search } = req.query;
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
    if (priority && priority !== 'all') {
      whereClause += ' AND priority = ?';
      params.push(priority);
    }
    if (search) {
      whereClause += ' AND (subject LIKE ? OR requester LIKE ? OR description LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q, q);
    }

    const [tickets] = await db.query(
      `SELECT * FROM workspace_tickets ${whereClause} ORDER BY created_at DESC`,
      sanitize(...params)
    );

    return res.status(200).json({ success: true, tickets: tickets || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch tickets.' });
  }
});

// POST /api/workspace/tickets - Create ticket
router.post('/tickets', optionalAuth, async (req, res) => {
  try {
    const { subject, requester, priority, status, description } = req.body;
    if (!subject) {
      return res.status(400).json({ success: false, error: 'Ticket subject is required.' });
    }

    const ticketId = `TCK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const finalUserId = req.userId || null;

    await db.query(
      `INSERT INTO workspace_tickets (id, user_id, subject, requester, priority, status, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      sanitize(ticketId, finalUserId, String(subject).trim(), requester || null, priority || 'Medium', status || 'Open', description || null)
    );

    const [created] = await db.query('SELECT * FROM workspace_tickets WHERE id = ?', [ticketId]);
    return res.status(201).json({ success: true, message: 'Ticket created.', ticket: created[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to create ticket.' });
  }
});

// PUT /api/workspace/tickets/:id/status - Update ticket status
router.put('/tickets/:id/status', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // Open, In Progress, Resolved, Closed

    await db.query('UPDATE workspace_tickets SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);
    return res.status(200).json({ success: true, message: `Ticket status updated to ${status}.` });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update ticket status.' });
  }
});

module.exports = router;
