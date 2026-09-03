const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { optionalAuth } = require('../middleware/auth');

const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

// GET /api/customers - List all customers with search, filter, and pagination
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { search, status, page = 1, limit = 50, userId } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const filterUserId = req.userId || userId;

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
      whereClause += ' AND (name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }

    const countSql = `SELECT COUNT(*) AS total FROM customers ${whereClause}`;
    const [countRows] = await db.query(countSql, sanitize(...params));
    const total = countRows[0]?.total || 0;

    const dataSql = `SELECT * FROM customers ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const [customers] = await db.query(dataSql, sanitize(...params, parseInt(limit, 10), offset));

    return res.status(200).json({
      success: true,
      customers: customers || [],
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)) || 1
      }
    });
  } catch (err) {
    console.error('Error fetching customers:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch customers.', message: err.message });
  }
});

// GET /api/customers/:id - Single customer with related invoices/deals
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM customers WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Customer not found.' });
    }

    const customer = rows[0];

    // Fetch related invoices and deals
    const [invoices] = await db.query('SELECT * FROM invoices WHERE customer_id = ? OR customer_name = ? LIMIT 10', [id, customer.name]).catch(() => [[]]);
    const [deals] = await db.query('SELECT * FROM deals WHERE customer_id = ? LIMIT 10', [id]).catch(() => [[]]);

    return res.status(200).json({
      success: true,
      customer,
      related: {
        invoices: invoices || [],
        deals: deals || []
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch customer.' });
  }
});

// POST /api/customers - Create new customer
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { name, email, phone, company, address, status, total_value, notes, userId } = req.body;
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Customer name is required.' });
    }

    const customerId = `CUST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const finalUserId = req.userId || userId || null;

    await db.query(
      `INSERT INTO customers (id, user_id, name, email, phone, company, address, status, total_value, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sanitize(
        customerId,
        finalUserId,
        String(name).trim(),
        email ? String(email).trim().toLowerCase() : null,
        phone ? String(phone).trim() : null,
        company ? String(company).trim() : null,
        address || null,
        status || 'active',
        parseFloat(total_value) || 0,
        notes || null
      )
    );

    const [created] = await db.query('SELECT * FROM customers WHERE id = ?', [customerId]);
    return res.status(201).json({
      success: true,
      message: 'Customer created successfully.',
      customer: created[0]
    });
  } catch (err) {
    console.error('Error creating customer:', err);
    return res.status(500).json({ success: false, error: 'Failed to create customer.' });
  }
});

// PUT /api/customers/:id - Update customer
router.put('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, company, address, status, total_value, notes } = req.body;

    const fields = [];
    const params = [];

    if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
    if (email !== undefined) { fields.push('email = ?'); params.push(email ? String(email).trim().toLowerCase() : null); }
    if (phone !== undefined) { fields.push('phone = ?'); params.push(phone ? String(phone).trim() : null); }
    if (company !== undefined) { fields.push('company = ?'); params.push(company ? String(company).trim() : null); }
    if (address !== undefined) { fields.push('address = ?'); params.push(address); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    if (total_value !== undefined) { fields.push('total_value = ?'); params.push(parseFloat(total_value) || 0); }
    if (notes !== undefined) { fields.push('notes = ?'); params.push(notes); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields provided to update.' });
    }

    fields.push('updated_at = NOW()');
    params.push(id);

    const [result] = await db.query(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`, sanitize(...params));
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Customer not found.' });
    }

    const [updated] = await db.query('SELECT * FROM customers WHERE id = ?', [id]);
    return res.status(200).json({
      success: true,
      message: 'Customer updated successfully.',
      customer: updated[0]
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update customer.' });
  }
});

// DELETE /api/customers/:id - Delete customer
router.delete('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM customers WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Customer not found.' });
    }
    return res.status(200).json({ success: true, message: 'Customer deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete customer.' });
  }
});

// POST /api/customers/:id/move-to-lead - Move customer into leads table
router.post('/:id/move-to-lead', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM customers WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Customer not found.' });
    }
    const c = rows[0];
    const leadId = `LEAD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await db.query(
      `INSERT INTO leads (id, user_id, name, company, email, phone, source, stage, value, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'Customer Re-engagement', 'New', ?, ?)`,
      sanitize(leadId, c.user_id, c.name, c.company || c.name, c.email, c.phone, c.total_value || 0, c.notes)
    );

    // Update customer status to prospect
    await db.query(`UPDATE customers SET status = 'prospect' WHERE id = ?`, [id]);

    return res.status(200).json({
      success: true,
      message: 'Customer moved to sales leads.',
      leadId
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to move customer to lead.' });
  }
});

module.exports = router;
