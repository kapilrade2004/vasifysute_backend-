const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { optionalAuth } = require('../middleware/auth');

const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

// ── 1. EMPLOYEES ─────────────────────────────────────────────────────────────

// GET /api/hr/employees - List employees
router.get('/employees', optionalAuth, async (req, res) => {
  try {
    const { department, status, search } = req.query;
    const filterUserId = req.userId;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (filterUserId) {
      whereClause += ' AND (user_id = ? OR user_id IS NULL)';
      params.push(filterUserId);
    }
    if (department && department !== 'all') {
      whereClause += ' AND department = ?';
      params.push(department);
    }
    if (status && status !== 'all') {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      whereClause += ' AND (name LIKE ? OR designation LIKE ? OR email LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q, q);
    }

    const [employees] = await db.query(
      `SELECT * FROM hr_employees ${whereClause} ORDER BY created_at DESC`,
      sanitize(...params)
    );

    return res.status(200).json({ success: true, employees: employees || [] });
  } catch (err) {
    console.error('Error fetching employees:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch employees.' });
  }
});

// POST /api/hr/employees - Add employee
router.post('/employees', optionalAuth, async (req, res) => {
  try {
    const { name, email, phone, designation, department, joining_date, salary, status } = req.body;
    if (!name || !designation) {
      return res.status(400).json({ success: false, error: 'Name and designation are required.' });
    }

    const empId = `EMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const finalUserId = req.userId || null;

    await db.query(
      `INSERT INTO hr_employees (id, user_id, name, email, phone, designation, department, joining_date, salary, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sanitize(
        empId,
        finalUserId,
        String(name).trim(),
        email ? String(email).trim().toLowerCase() : null,
        phone ? String(phone).trim() : null,
        String(designation).trim(),
        department || 'Operations',
        joining_date || new Date().toISOString().split('T')[0],
        parseFloat(salary) || 0,
        status || 'Active'
      )
    );

    const [created] = await db.query('SELECT * FROM hr_employees WHERE id = ?', [empId]);
    return res.status(201).json({ success: true, message: 'Employee added.', employee: created[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to add employee.' });
  }
});

// PUT /api/hr/employees/:id - Update employee
router.put('/employees/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, designation, department, salary, status } = req.body;

    const fields = [];
    const params = [];

    if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
    if (email !== undefined) { fields.push('email = ?'); params.push(email); }
    if (phone !== undefined) { fields.push('phone = ?'); params.push(phone); }
    if (designation !== undefined) { fields.push('designation = ?'); params.push(designation); }
    if (department !== undefined) { fields.push('department = ?'); params.push(department); }
    if (salary !== undefined) { fields.push('salary = ?'); params.push(parseFloat(salary) || 0); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields provided to update.' });
    }

    fields.push('updated_at = NOW()');
    params.push(id);

    const [result] = await db.query(`UPDATE hr_employees SET ${fields.join(', ')} WHERE id = ?`, sanitize(...params));
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Employee not found.' });
    }

    const [updated] = await db.query('SELECT * FROM hr_employees WHERE id = ?', [id]);
    return res.status(200).json({ success: true, message: 'Employee updated.', employee: updated[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update employee.' });
  }
});

// DELETE /api/hr/employees/:id - Remove employee
router.delete('/employees/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM hr_employees WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Employee not found.' });
    }
    return res.status(200).json({ success: true, message: 'Employee deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete employee.' });
  }
});

// ── 2. ATTENDANCE ────────────────────────────────────────────────────────────

// GET /api/hr/attendance - List attendance records
router.get('/attendance', optionalAuth, async (req, res) => {
  try {
    const { date = new Date().toISOString().split('T')[0] } = req.query;
    const filterUserId = req.userId;

    let sql = `
      SELECT a.*, e.name AS employee_name, e.designation, e.department
      FROM hr_attendance a
      JOIN hr_employees e ON a.employee_id = e.id
      WHERE a.date = ?
    `;
    const params = [date];

    if (filterUserId) {
      sql += ' AND (a.user_id = ? OR a.user_id IS NULL)';
      params.push(filterUserId);
    }
    sql += ' ORDER BY e.name ASC';

    const [records] = await db.query(sql, sanitize(...params));
    return res.status(200).json({ success: true, attendance: records || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch attendance.' });
  }
});

// POST /api/hr/attendance - Record attendance
router.post('/attendance', optionalAuth, async (req, res) => {
  try {
    const { employee_id, date = new Date().toISOString().split('T')[0], check_in, check_out, status = 'Present', notes } = req.body;
    if (!employee_id) {
      return res.status(400).json({ success: false, error: 'employee_id is required.' });
    }

    const attId = `ATT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const finalUserId = req.userId || null;

    await db.query(
      `INSERT INTO hr_attendance (id, user_id, employee_id, date, check_in, check_out, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      sanitize(attId, finalUserId, employee_id, date, check_in || '09:30:00', check_out || '18:30:00', status, notes || null)
    );

    return res.status(201).json({ success: true, message: 'Attendance recorded.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to record attendance.' });
  }
});

// ── 3. LEAVE MANAGEMENT ──────────────────────────────────────────────────────

// GET /api/hr/leaves - List leaves
router.get('/leaves', optionalAuth, async (req, res) => {
  try {
    const filterUserId = req.userId;
    let sql = `
      SELECT l.*, e.name AS employee_name, e.department
      FROM hr_leaves l
      JOIN hr_employees e ON l.employee_id = e.id
      WHERE 1=1
    `;
    const params = [];

    if (filterUserId) {
      sql += ' AND (l.user_id = ? OR l.user_id IS NULL)';
      params.push(filterUserId);
    }
    sql += ' ORDER BY l.created_at DESC';

    const [leaves] = await db.query(sql, sanitize(...params));
    return res.status(200).json({ success: true, leaves: leaves || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch leaves.' });
  }
});

// POST /api/hr/leaves - Apply for leave
router.post('/leaves', optionalAuth, async (req, res) => {
  try {
    const { employee_id, leave_type = 'Casual', from_date, to_date, reason } = req.body;
    if (!employee_id || !from_date || !to_date) {
      return res.status(400).json({ success: false, error: 'employee_id, from_date, and to_date are required.' });
    }

    const leaveId = `LEV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const finalUserId = req.userId || null;

    await db.query(
      `INSERT INTO hr_leaves (id, user_id, employee_id, leave_type, from_date, to_date, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`,
      sanitize(leaveId, finalUserId, employee_id, leave_type, from_date, to_date, reason || null)
    );

    return res.status(201).json({ success: true, message: 'Leave application submitted.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to submit leave.' });
  }
});

// PUT /api/hr/leaves/:id/status - Approve or reject leave
router.put('/leaves/:id/status', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // Approved or Rejected
    if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status.' });
    }

    await db.query('UPDATE hr_leaves SET status = ? WHERE id = ?', [status, id]);
    return res.status(200).json({ success: true, message: `Leave status updated to ${status}.` });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update leave status.' });
  }
});

// ── 4. PAYROLL ───────────────────────────────────────────────────────────────

// GET /api/hr/payroll - List payroll
router.get('/payroll', optionalAuth, async (req, res) => {
  try {
    const { month_year } = req.query;
    const filterUserId = req.userId;

    let sql = `
      SELECT p.*, e.name AS employee_name, e.designation, e.department
      FROM hr_payroll p
      JOIN hr_employees e ON p.employee_id = e.id
      WHERE 1=1
    `;
    const params = [];

    if (month_year) {
      sql += ' AND p.month_year = ?';
      params.push(month_year);
    }
    if (filterUserId) {
      sql += ' AND (p.user_id = ? OR p.user_id IS NULL)';
      params.push(filterUserId);
    }
    sql += ' ORDER BY p.created_at DESC';

    const [payroll] = await db.query(sql, sanitize(...params));
    return res.status(200).json({ success: true, payroll: payroll || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch payroll.' });
  }
});

// POST /api/hr/payroll - Generate payroll entry
router.post('/payroll', optionalAuth, async (req, res) => {
  try {
    const { employee_id, month_year, base_salary, bonuses = 0, deductions = 0, payment_date, status = 'Pending' } = req.body;
    if (!employee_id || !month_year) {
      return res.status(400).json({ success: false, error: 'employee_id and month_year are required.' });
    }

    const payId = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const base = parseFloat(base_salary) || 0;
    const bon = parseFloat(bonuses) || 0;
    const ded = parseFloat(deductions) || 0;
    const net = base + bon - ded;
    const finalUserId = req.userId || null;

    await db.query(
      `INSERT INTO hr_payroll (id, user_id, employee_id, month_year, base_salary, bonuses, deductions, net_salary, payment_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sanitize(payId, finalUserId, employee_id, month_year, base, bon, ded, net, payment_date || null, status)
    );

    return res.status(201).json({ success: true, message: 'Payroll record created.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to create payroll.' });
  }
});

module.exports = router;
