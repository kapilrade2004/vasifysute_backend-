const express = require('express');
const router = express.Router();
const db = require('../database/db');
const usageTracker = require('../src/admin/usage_tracker.middleware');

router.use(usageTracker('crm'));

// ── Helper ────────────────────────────────────────────────────────────────────
const sanitize = (...params) => params.map(p => (p === undefined ? null : p));

function generateLeadId() {
  return `LEAD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// ── Auto-create / migrate leads table ───────────────────────────────────────
async function ensureLeadsTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id              VARCHAR(50) PRIMARY KEY,
        organization_id VARCHAR(50) NULL,
        user_id         INT NULL,
        name            VARCHAR(150) NOT NULL,
        company         VARCHAR(150) NOT NULL,
        email           VARCHAR(150) NULL,
        phone           VARCHAR(50) NULL,
        whatsapp        VARCHAR(50) NULL,
        source          VARCHAR(80) DEFAULT 'Website',
        stage           VARCHAR(80) DEFAULT 'New',
        priority        VARCHAR(50) DEFAULT 'Medium',
        value           DECIMAL(15,2) DEFAULT 0,
        assigned_to     VARCHAR(150) NULL,
        follow_up_date  DATETIME NULL,
        notes           TEXT NULL,
        created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NULL,
        INDEX idx_leads_user (user_id),
        INDEX idx_leads_org (organization_id),
        INDEX idx_leads_stage (stage)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Safely add any columns that may not exist in older MySQL table instances
    const alterColumns = [
      "ALTER TABLE leads ADD COLUMN organization_id VARCHAR(50) NULL AFTER id",
      "ALTER TABLE leads ADD COLUMN whatsapp VARCHAR(50) NULL AFTER phone",
      "ALTER TABLE leads ADD COLUMN priority VARCHAR(50) DEFAULT 'Medium' AFTER stage",
      "ALTER TABLE leads ADD COLUMN follow_up_date DATETIME NULL AFTER assigned_to"
    ];
    for (const sql of alterColumns) {
      try {
        await db.query(sql);
      } catch (e) {
        // Ignored if column already exists
      }
    }
    console.log('✅ Leads table ready.');
  } catch (err) {
    console.warn('Leads table auto-create warning:', err.message);
  }
}
ensureLeadsTable();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/leads
// Query params: ?userId=  ?stage=  ?search=  ?source=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { userId, stage, search, source } = req.query;

    let query = `SELECT * FROM leads WHERE 1=1`;
    const params = [];

    if (userId) {
      query += ` AND user_id = ?`;
      params.push(userId);
    }
    if (stage && stage !== 'All') {
      query += ` AND stage = ?`;
      params.push(stage);
    }
    if (source && source !== 'All') {
      query += ` AND source = ?`;
      params.push(source);
    }
    if (search) {
      query += ` AND (name LIKE ? OR company LIKE ? OR email LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    query += ` ORDER BY created_at DESC`;

    const [leads] = await db.query(query, sanitize(...params));
    return res.status(200).json({
      success: true,
      leads: leads || [],
      pagination: {
        total: (leads || []).length,
        page: 1,
        limit: (leads || []).length,
        totalPages: 1
      }
    });
  } catch (err) {
    console.error('Error fetching leads:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch leads.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/leads/:id — single lead
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT * FROM leads WHERE id = ?`, [req.params.id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }
    return res.status(200).json({ success: true, lead: rows[0] });
  } catch (err) {
    console.error('Error fetching lead:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch lead.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/leads — create lead (Supports Quick Create with only Name & Phone)
// Body: { userId, organizationId, name, company, email, phone, whatsapp, source, stage, priority, value, assignedTo, followUpDate, notes }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      userId, organizationId, name, company, email, phone, whatsapp,
      source, stage, priority, value, assignedTo, followUpDate, notes
    } = req.body;

    if (!name || String(name).trim().length < 1) {
      return res.status(400).json({ success: false, message: 'Lead name is required.' });
    }

    const leadId = generateLeadId();
    const leadValue = parseFloat(value) || 0;
    const resolvedCompany = company && String(company).trim().length > 0 
      ? String(company).trim() 
      : `${String(name).trim()} (Direct)`;
    const resolvedPhone = phone ? String(phone).trim() : null;
    const resolvedWhatsapp = whatsapp ? String(whatsapp).trim() : resolvedPhone;
    const resolvedStage = stage || 'New';
    const resolvedPriority = priority || 'Medium';

    await db.query(
      `INSERT INTO leads
        (id, organization_id, user_id, name, company, email, phone, whatsapp, source, stage, priority, value, assigned_to, follow_up_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sanitize(
        leadId,
        organizationId || null,
        userId || null,
        String(name).trim(),
        resolvedCompany,
        email ? String(email).trim().toLowerCase() : null,
        resolvedPhone,
        resolvedWhatsapp,
        source || 'Website',
        resolvedStage,
        resolvedPriority,
        leadValue,
        assignedTo || null,
        followUpDate ? new Date(followUpDate) : null,
        notes || null
      )
    );

    // Auto-log creation activity
    try {
      await db.query(
        `INSERT INTO activities (id, organization_id, user_id, entity_type, entity_id, type, title, description, completed_at)
         VALUES (?, ?, ?, 'lead', ?, 'created', 'Lead created', ?, NOW())`,
        sanitize(
          `ACT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          organizationId || null,
          userId || null,
          leadId,
          `Initial creation via ${source || 'Direct Entry'}`
        )
      );
    } catch (actErr) {
      console.warn('Could not auto-log lead creation activity:', actErr.message);
    }

    const [rows] = await db.query(`SELECT * FROM leads WHERE id = ?`, [leadId]);
    return res.status(201).json({
      success: true,
      message: 'Lead created successfully.',
      lead: rows[0]
    });
  } catch (err) {
    console.error('Error creating lead:', err);
    return res.status(500).json({ success: false, message: 'Failed to create lead.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/leads/:id — Atomic Single/Multi-Field Inline Edit
// Body: any subset of { name, company, email, phone, whatsapp, source, stage, priority, value, assignedTo, assigned_to, followUpDate, follow_up_date, notes }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;

    const [existingRows] = await db.query(`SELECT * FROM leads WHERE id = ?`, [id]);
    if (!existingRows || existingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }
    const existing = existingRows[0];

    const updates = [];
    const params = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      params.push(String(body.name).trim());
    }
    if (body.company !== undefined) {
      updates.push('company = ?');
      params.push(String(body.company).trim());
    }
    if (body.email !== undefined) {
      updates.push('email = ?');
      params.push(body.email ? String(body.email).trim().toLowerCase() : null);
    }
    if (body.phone !== undefined) {
      updates.push('phone = ?');
      params.push(body.phone ? String(body.phone).trim() : null);
    }
    if (body.whatsapp !== undefined) {
      updates.push('whatsapp = ?');
      params.push(body.whatsapp ? String(body.whatsapp).trim() : null);
    }
    if (body.source !== undefined) {
      updates.push('source = ?');
      params.push(body.source || 'Website');
    }
    if (body.stage !== undefined) {
      updates.push('stage = ?');
      params.push(body.stage);
    }
    if (body.priority !== undefined) {
      updates.push('priority = ?');
      params.push(body.priority);
    }
    if (body.value !== undefined) {
      updates.push('value = ?');
      params.push(parseFloat(body.value) || 0);
    }
    if (body.assignedTo !== undefined || body.assigned_to !== undefined) {
      updates.push('assigned_to = ?');
      params.push(body.assignedTo || body.assigned_to || null);
    }
    if (body.followUpDate !== undefined || body.follow_up_date !== undefined) {
      const fDate = body.followUpDate || body.follow_up_date;
      updates.push('follow_up_date = ?');
      params.push(fDate ? new Date(fDate) : null);
    }
    if (body.notes !== undefined) {
      updates.push('notes = ?');
      params.push(body.notes || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields provided to update.' });
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    await db.query(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`, sanitize(...params));

    // Automated activity logs on status/stage change
    if (body.stage && body.stage !== existing.stage) {
      try {
        await db.query(
          `INSERT INTO activities (id, organization_id, user_id, entity_type, entity_id, type, title, description, completed_at)
           VALUES (?, ?, ?, 'lead', ?, 'status_change', ?, ?, NOW())`,
          sanitize(
            `ACT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            existing.organization_id || null,
            existing.user_id || null,
            id,
            `Stage updated to ${body.stage}`,
            `Changed from ${existing.stage} to ${body.stage}`
          )
        );
      } catch (actErr) {
        console.warn('Could not auto-log stage change activity:', actErr.message);
      }
    }

    // Automated activity log on follow-up schedule change
    const newFollowUp = body.followUpDate || body.follow_up_date;
    if (newFollowUp && newFollowUp !== existing.follow_up_date) {
      try {
        await db.query(
          `INSERT INTO activities (id, organization_id, user_id, entity_type, entity_id, type, title, description, scheduled_at, completed_at)
           VALUES (?, ?, ?, 'lead', ?, 'follow_up', ?, ?, ?, NOW())`,
          sanitize(
            `ACT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            existing.organization_id || null,
            existing.user_id || null,
            id,
            `Follow-up scheduled`,
            `Scheduled for ${new Date(newFollowUp).toLocaleDateString()}`,
            new Date(newFollowUp)
          )
        );
      } catch (actErr) {
        console.warn('Could not auto-log follow-up activity:', actErr.message);
      }
    }

    const [refetched] = await db.query(`SELECT * FROM leads WHERE id = ?`, [id]);
    return res.status(200).json({
      success: true,
      message: 'Lead updated successfully.',
      lead: refetched[0]
    });
  } catch (err) {
    console.error('Error in atomic PATCH lead:', err);
    return res.status(500).json({ success: false, message: 'Failed to update lead.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/leads/:id — full update
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, company, email, phone,
      source, stage, value, assignedTo, notes
    } = req.body;

    const [existing] = await db.query(`SELECT id FROM leads WHERE id = ?`, [id]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }

    await db.query(
      `UPDATE leads
       SET name = ?, company = ?, email = ?, phone = ?,
           source = ?, stage = ?, value = ?, assigned_to = ?,
           notes = ?, updated_at = NOW()
       WHERE id = ?`,
      sanitize(
        name ? String(name).trim() : null,
        company ? String(company).trim() : null,
        email ? String(email).trim().toLowerCase() : null,
        phone ? String(phone).trim() : null,
        source || 'Website',
        stage || 'New',
        parseFloat(value) || 0,
        assignedTo || null,
        notes || null,
        id
      )
    );

    const [rows] = await db.query(`SELECT * FROM leads WHERE id = ?`, [id]);
    return res.status(200).json({ success: true, message: 'Lead updated.', lead: rows[0] });
  } catch (err) {
    console.error('Error updating lead:', err);
    return res.status(500).json({ success: false, message: 'Failed to update lead.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/leads/:id/stage — quick stage-only update (for Kanban)
// Body: { stage }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/stage', async (req, res) => {
  try {
    const { id } = req.params;
    const { stage } = req.body;

    const validStages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
    if (!stage || !validStages.includes(stage)) {
      return res.status(400).json({
        success: false,
        message: `Invalid stage. Must be one of: ${validStages.join(', ')}`
      });
    }

    const [result] = await db.query(
      `UPDATE leads SET stage = ?, updated_at = NOW() WHERE id = ?`,
      [stage, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }

    return res.status(200).json({ success: true, message: `Stage updated to ${stage}.` });
  } catch (err) {
    console.error('Error updating lead stage:', err);
    return res.status(500).json({ success: false, message: 'Failed to update stage.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/leads/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query(`DELETE FROM leads WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }

    return res.status(200).json({ success: true, message: 'Lead deleted successfully.' });
  } catch (err) {
    console.error('Error deleting lead:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete lead.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/leads/:id/convert — Convert lead to customer (+ update stage to Won)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/convert', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM leads WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }

    const lead = rows[0];
    const customerId = `CUST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Create customer record
    await db.query(
      `INSERT INTO customers (id, user_id, name, email, phone, company, status, total_value, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      sanitize(
        customerId,
        lead.user_id,
        lead.name,
        lead.email,
        lead.phone,
        lead.company,
        lead.value || 0,
        `Converted from Lead #${lead.id}. ${lead.notes || ''}`
      )
    );

    // Update lead stage to Won
    await db.query(`UPDATE leads SET stage = 'Won', updated_at = NOW() WHERE id = ?`, [id]);

    const [custRows] = await db.query('SELECT * FROM customers WHERE id = ?', [customerId]);

    return res.status(200).json({
      success: true,
      message: 'Lead converted to customer successfully.',
      customer: custRows[0]
    });
  } catch (err) {
    console.error('Error converting lead:', err);
    return res.status(500).json({ success: false, message: 'Failed to convert lead.' });
  }
});

// ── Lead Follow-ups ─────────────────────────────────────────────────────────

// GET /api/leads/:id/follow-ups
router.get('/:id/follow-ups', async (req, res) => {
  try {
    const { id } = req.params;
    const [followUps] = await db.query(
      'SELECT * FROM leads_followups WHERE lead_id = ? ORDER BY follow_up_date ASC',
      [id]
    );
    return res.status(200).json({ success: true, followUps: followUps || [] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch follow-ups.' });
  }
});

// POST /api/leads/:id/follow-ups
router.post('/:id/follow-ups', async (req, res) => {
  try {
    const { id } = req.params;
    const { followUpDate, followUpTime, notes } = req.body;
    if (!followUpDate) {
      return res.status(400).json({ success: false, message: 'followUpDate is required.' });
    }

    const fupId = `FUP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await db.query(
      `INSERT INTO leads_followups (id, lead_id, follow_up_date, follow_up_time, notes)
       VALUES (?, ?, ?, ?, ?)`,
      sanitize(fupId, id, followUpDate, followUpTime || null, notes || null)
    );

    const [created] = await db.query('SELECT * FROM leads_followups WHERE id = ?', [fupId]);
    return res.status(201).json({ success: true, message: 'Follow-up scheduled.', followUp: created[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to add follow-up.' });
  }
});

// PUT /api/leads/:id/follow-up — Quick schedule
router.put('/:id/follow-up', async (req, res) => {
  try {
    const { id } = req.params;
    const { followUpDate, followUpNotes } = req.body;
    if (!followUpDate) {
      return res.status(400).json({ success: false, message: 'followUpDate is required.' });
    }

    const fupId = `FUP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await db.query(
      `INSERT INTO leads_followups (id, lead_id, follow_up_date, notes)
       VALUES (?, ?, ?, ?)`,
      sanitize(fupId, id, followUpDate, followUpNotes || null)
    );

    return res.status(200).json({ success: true, message: 'Follow-up saved.', followUpDate });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to schedule follow-up.' });
  }
});

module.exports = router;
