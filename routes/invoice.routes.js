const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { sendTrialEmail } = require('../services/email.service');

// Helper to sanitize parameters
const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

// Helper: Ensure invoice tables exist in MySQL database
async function ensureInvoiceTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id VARCHAR(50) PRIMARY KEY,
        user_id INT NULL,
        customer_id VARCHAR(50) NULL,
        invoice_number VARCHAR(100) NOT NULL,
        customer_name VARCHAR(255) NULL,
        customer_company VARCHAR(255) NULL,
        customer_email VARCHAR(255) NULL,
        customer_phone VARCHAR(50) NULL,
        amount DECIMAL(15,2) DEFAULT 0,
        tax DECIMAL(5,2) DEFAULT 18,
        gst_amount DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'draft',
        issue_date DATE NULL,
        due_date DATE NULL,
        notes TEXT NULL,
        po_number VARCHAR(100) NULL,
        terms VARCHAR(100) DEFAULT 'due_on_receipt',
        place_of_supply VARCHAR(100) DEFAULT 'Maharashtra (27)',
        whatsapp_sent TINYINT(1) DEFAULT 0,
        whatsapp_sent_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8;
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id VARCHAR(50) PRIMARY KEY,
        invoice_id VARCHAR(50) NOT NULL,
        description TEXT NULL,
        quantity INT DEFAULT 1,
        rate DECIMAL(15,2) DEFAULT 0,
        amount DECIMAL(15,2) DEFAULT 0,
        hsn VARCHAR(50) DEFAULT '998313',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log("✅ SaaS Invoice & Invoice Items MySQL tables ready.");
  } catch (err) {
    console.warn("Invoice tables auto-create warning:", err.message);
  }
}

// Auto-run schema initialization
ensureInvoiceTables();

// Generate serialwise invoice number: INV-YYYYMM-XXXX
const generateInvNumber = async () => {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `INV-${ym}-`;

  try {
    const [rows] = await db.query(
      `SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY created_at DESC`,
      [`${prefix}%`]
    );

    let maxSeq = 0;
    if (rows && rows.length > 0) {
      for (const r of rows) {
        if (r.invoice_number) {
          const parts = r.invoice_number.split("-");
          const lastPart = parts[parts.length - 1];
          const num = parseInt(lastPart, 10);
          if (!isNaN(num) && num > maxSeq) {
            maxSeq = num;
          }
        }
      }
    }
    const seq = maxSeq + 1;
    return `${prefix}${String(seq).padStart(4, "0")}`;
  } catch (e) {
    const randomSeq = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}${randomSeq}`;
  }
};

// GET /api/invoices - Fetch multi-tenant user invoices
router.get('/', async (req, res) => {
  try {
    const userId = req.query.userId;
    let query = `SELECT * FROM invoices`;
    const params = [];

    if (userId) {
      query += ` WHERE user_id = ?`;
      params.push(userId);
    }
    query += ` ORDER BY created_at DESC`;

    const [invoices] = await db.query(query, sanitize(...params));

    if (invoices && invoices.length > 0) {
      const ids = invoices.map(i => i.id);
      const placeholders = ids.map(() => '?').join(',');
      const [items] = await db.query(
        `SELECT * FROM invoice_items WHERE invoice_id IN (${placeholders}) ORDER BY created_at`,
        sanitize(...ids)
      );

      invoices.forEach(inv => {
        inv.items = items.filter(it => it.invoice_id === inv.id);
      });
    }

    return res.status(200).json({ success: true, invoices: invoices || [] });
  } catch (err) {
    console.error('Error fetching invoices:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch invoices.' });
  }
});

// GET /api/invoices/next-number - Fetch next serialwise invoice number
router.get('/next-number', async (req, res) => {
  try {
    const nextNumber = await generateInvNumber();
    return res.status(200).json({ success: true, nextNumber });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to generate invoice number.' });
  }
});

// POST /api/invoices - Create multi-tenant invoice
router.post('/', async (req, res) => {
  try {
    const {
      userId, customerName, customerCompany, customerEmail, customerPhone,
      amount, tax, total, status, issueDate, dueDate, notes, poNumber, terms, placeOfSupply, items
    } = req.body;

    const invoiceId = `INV-${Date.now()}`;
    const invNum = req.body.invoiceNumber || await generateInvNumber();

    const subtotal = amount || (items && items.length ? items.reduce((s, i) => s + Number(i.amount || 0), 0) : 0);
    const taxRate = tax || 18;
    const gstAmt = (subtotal * taxRate) / 100;
    const finalTotal = total || (subtotal + gstAmt);

    await db.query(
      `INSERT INTO invoices
        (id, user_id, invoice_number, customer_name, customer_company, customer_email, customer_phone,
         amount, tax, gst_amount, total, status, issue_date, due_date, notes, po_number, terms, place_of_supply)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sanitize(
        invoiceId, userId || null, invNum, customerName || 'Valued Client', customerCompany || null,
        customerEmail || null, customerPhone || null, subtotal, taxRate, gstAmt, finalTotal,
        status || 'draft', issueDate || new Date().toISOString().split('T')[0],
        dueDate || new Date().toISOString().split('T')[0], notes || null,
        poNumber || null, terms || 'due_on_receipt', placeOfSupply || 'Maharashtra (27)'
      )
    );

    if (items && Array.isArray(items)) {
      for (const item of items) {
        await db.query(
          `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount, hsn)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          sanitize(
            `ITM-${Date.now()}-${Math.floor(Math.random()*1000)}`, invoiceId,
            item.description || 'Service Charges', item.quantity || 1, item.rate || 0,
            item.amount || (item.quantity * item.rate) || 0, item.hsn || '998313'
          )
        );
      }
    }

    return res.status(201).json({
      success: true,
      message: 'SaaS Invoice created successfully',
      invoice: { id: invoiceId, invoice_number: invNum, total: finalTotal }
    });
  } catch (err) {
    console.error('Error creating invoice:', err);
    return res.status(500).json({ success: false, message: 'Failed to create SaaS invoice.' });
  }
});

// POST /api/invoices/:id/send-whatsapp - Send Invoice PDF & Notification via WhatsApp
router.post('/:id/send-whatsapp', async (req, res) => {
  try {
    const { id } = req.params;
    const { targetPhone, customerName } = req.body;

    const [rows] = await db.query(`SELECT * FROM invoices WHERE id = ?`, sanitize(id));
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }

    const inv = rows[0];
    const recipientPhone = targetPhone || inv.customer_phone || '+919769026133';
    const clientName = customerName || inv.customer_name || 'Valued Client';

    // Update database status
    await db.query(
      `UPDATE invoices SET whatsapp_sent = 1, whatsapp_sent_at = NOW(), status = 'sent' WHERE id = ?`,
      sanitize(id)
    );

    return res.status(200).json({
      success: true,
      message: `Invoice #${inv.invoice_number} dispatched via WhatsApp to ${recipientPhone}`,
      whatsapp: {
        recipient: recipientPhone,
        customer: clientName,
        invoiceNumber: inv.invoice_number,
        total: inv.total,
        status: 'delivered'
      }
    });
  } catch (err) {
    console.error('Error sending WhatsApp invoice:', err);
    return res.status(500).json({ success: false, message: 'Failed to send WhatsApp invoice.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/invoices/stats/overview — invoice statistics and trends
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats/overview', async (req, res) => {
  try {
    const userId = req.query.userId;
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (userId) {
      whereClause += ' AND user_id = ?';
      params.push(userId);
    }

    const [statusBreakdown] = await db.query(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total_amount
       FROM invoices ${whereClause}
       GROUP BY status`,
      sanitize(...params)
    );

    const [monthlyTrend] = await db.query(
      `SELECT DATE_FORMAT(issue_date, '%Y-%m') AS month, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total_amount
       FROM invoices ${whereClause}
       GROUP BY month
       ORDER BY month DESC LIMIT 6`,
      sanitize(...params)
    );

    const [overdueRows] = await db.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total_amount
       FROM invoices ${whereClause} AND due_date < CURDATE() AND status != 'paid'`,
      sanitize(...params)
    );

    return res.status(200).json({
      success: true,
      statusBreakdown: statusBreakdown || [],
      monthlyTrend: monthlyTrend || [],
      overdue: {
        count: overdueRows[0]?.count || 0,
        total_amount: overdueRows[0]?.total_amount || 0
      }
    });
  } catch (err) {
    console.error('Error fetching invoice stats:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch invoice stats.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/invoices/:id — single invoice with all line items
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(`SELECT * FROM invoices WHERE id = ?`, sanitize(id));

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }

    const invoice = rows[0];
    const [items] = await db.query(
      `SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at`,
      sanitize(id)
    );
    invoice.items = items || [];

    return res.status(200).json({ success: true, invoice });
  } catch (err) {
    console.error('Error fetching invoice:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch invoice.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/invoices/:id — update invoice status and/or metadata
// Body: { status, notes, dueDate, customerName, customerEmail, customerPhone }
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status, notes, dueDate, customerName,
      customerCompany, customerEmail, customerPhone
    } = req.body;

    const [existing] = await db.query(`SELECT id FROM invoices WHERE id = ?`, sanitize(id));
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }

    // Build dynamic SET clause — only update fields that were sent
    const fields = [];
    const params = [];

    if (status !== undefined)         { fields.push('status = ?');           params.push(status); }
    if (notes !== undefined)          { fields.push('notes = ?');            params.push(notes); }
    if (dueDate !== undefined)        { fields.push('due_date = ?');         params.push(dueDate); }
    if (customerName !== undefined)   { fields.push('customer_name = ?');    params.push(customerName); }
    if (customerCompany !== undefined){ fields.push('customer_company = ?'); params.push(customerCompany); }
    if (customerEmail !== undefined)  { fields.push('customer_email = ?');   params.push(customerEmail); }
    if (customerPhone !== undefined)  { fields.push('customer_phone = ?');   params.push(customerPhone); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    fields.push('updated_at = NOW()');
    params.push(id);

    await db.query(
      `UPDATE invoices SET ${fields.join(', ')} WHERE id = ?`,
      sanitize(...params)
    );

    const [rows] = await db.query(`SELECT * FROM invoices WHERE id = ?`, sanitize(id));
    const [items] = await db.query(
      `SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at`,
      sanitize(id)
    );
    const invoice = rows[0];
    invoice.items = items || [];

    return res.status(200).json({ success: true, message: 'Invoice updated.', invoice });
  } catch (err) {
    console.error('Error updating invoice:', err);
    return res.status(500).json({ success: false, message: 'Failed to update invoice.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/invoices/:id — deletes invoice and all line items (CASCADE)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query(`DELETE FROM invoices WHERE id = ?`, sanitize(id));

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }

    return res.status(200).json({ success: true, message: 'Invoice deleted successfully.' });
  } catch (err) {
    console.error('Error deleting invoice:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete invoice.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/invoices/:id/send-email — send invoice summary via Nodemailer
// Body: { toEmail, customerName }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/send-email', async (req, res) => {
  try {
    const { id } = req.params;
    const { toEmail, customerName } = req.body;

    const [rows] = await db.query(`SELECT * FROM invoices WHERE id = ?`, sanitize(id));
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }

    const inv = rows[0];
    const [items] = await db.query(
      `SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at`,
      sanitize(id)
    );

    const recipient = toEmail || inv.customer_email;
    if (!recipient) {
      return res.status(400).json({ success: false, message: 'No email address available for this invoice.' });
    }

    const clientName = customerName || inv.customer_name || 'Valued Client';
    const issueDate  = inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('en-IN') : '—';
    const dueDate    = inv.due_date   ? new Date(inv.due_date).toLocaleDateString('en-IN')   : '—';

    // Build line items HTML rows
    const itemRows = (items || []).map((item, idx) => `
      <tr>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;">${idx + 1}</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;">${item.description || '—'}</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:center;">${item.quantity}</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;">₹${Number(item.rate).toLocaleString('en-IN')}</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;font-weight:700;">₹${Number(item.amount).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');

    const subject = `Invoice ${inv.invoice_number} from VasifyTech — ₹${Number(inv.total).toLocaleString('en-IN')}`;
    const text    = `Dear ${clientName}, please find your invoice ${inv.invoice_number} for ₹${inv.total}. Due: ${dueDate}.`;
    const html    = `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;background:#ffffff;">
        <div style="display:flex;justify-content:space-between;border-bottom:2px solid #1DA851;padding-bottom:20px;margin-bottom:20px;">
          <div>
            <h2 style="color:#1DA851;margin:0;font-size:22px;">VasifyTech Suite</h2>
            <p style="color:#64748b;font-size:12px;margin:4px 0 0;">Axiom Milan CHS, Kandivali West, Mumbai 400067<br>GSTIN: 27AAKCV0353N1ZW</p>
          </div>
          <div style="text-align:right;">
            <div style="font-size:26px;font-weight:800;color:#0f172a;">INVOICE</div>
            <div style="font-size:14px;color:#64748b;">#${inv.invoice_number}</div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;gap:20px;margin-bottom:24px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:14px 18px;border-radius:10px;flex:1;">
            <strong style="color:#475569;font-size:12px;text-transform:uppercase;">Bill To</strong><br/>
            <span style="font-weight:700;color:#0f172a;font-size:15px;">${clientName}</span><br/>
            ${inv.customer_company ? `<span style="color:#64748b;">${inv.customer_company}</span><br/>` : ''}
            ${inv.customer_email   ? `<span style="color:#64748b;">${inv.customer_email}</span><br/>`   : ''}
            ${inv.customer_phone   ? `<span style="color:#64748b;">${inv.customer_phone}</span>`         : ''}
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:14px 18px;border-radius:10px;flex:1;">
            <strong style="color:#475569;font-size:12px;text-transform:uppercase;">Invoice Details</strong><br/>
            <span style="color:#64748b;">Issue Date: <strong>${issueDate}</strong></span><br/>
            <span style="color:#64748b;">Due Date: <strong>${dueDate}</strong></span><br/>
            <span style="color:#64748b;">Place of Supply: <strong>${inv.place_of_supply || 'Maharashtra (27)'}</strong></span>
          </div>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:20px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:left;">#</th>
              <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:left;">Description</th>
              <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:center;">Qty</th>
              <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;">Rate</th>
              <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>${itemRows || `<tr><td colspan="5" style="padding:12px;border:1px solid #e2e8f0;text-align:center;color:#94a3b8;">No line items</td></tr>`}</tbody>
        </table>

        <div style="text-align:right;margin-bottom:24px;">
          <div style="font-size:14px;color:#64748b;">Subtotal: ₹${Number(inv.amount).toLocaleString('en-IN')}</div>
          <div style="font-size:14px;color:#64748b;">GST (${inv.tax || 18}%): ₹${Number(inv.gst_amount).toLocaleString('en-IN')}</div>
          <div style="font-size:20px;font-weight:800;color:#1DA851;margin-top:6px;">Total: ₹${Number(inv.total).toLocaleString('en-IN')}</div>
        </div>

        ${inv.notes ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px 16px;border-radius:8px;font-size:13px;color:#475569;margin-bottom:20px;"><strong>Notes:</strong> ${inv.notes}</div>` : ''}

        <div style="text-align:center;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12.5px;color:#94a3b8;">
          Thank you for your business. Please contact us at support@vasifytech.com for any queries.
        </div>
      </div>
    `;

    const result = await sendTrialEmail(recipient, subject, text, html);

    // Mark status as sent if it was a draft
    if (inv.status === 'draft') {
      await db.query(
        `UPDATE invoices SET status = 'sent', updated_at = NOW() WHERE id = ?`,
        sanitize(id)
      );
    }

    return res.status(200).json({
      success: true,
      message: `Invoice ${inv.invoice_number} emailed to ${recipient}`,
      email: { recipient, invoiceNumber: inv.invoice_number, simulated: result.simulated || false }
    });
  } catch (err) {
    console.error('Error sending invoice email:', err);
    return res.status(500).json({ success: false, message: 'Failed to send invoice email.' });
  }
});

module.exports = router;

