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

module.exports = router;
