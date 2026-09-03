const { v4: uuidv4 }             = require("uuid");
const PDFDocument                = require("pdfkit");
const express                    = require("express");
const { body, validationResult } = require("express-validator");
const { pool }                   = require("../config/database");
const { authenticateToken }      = require("../middleware/auth");
const { uploadFileToPublicUrl }  = require("../config/fileUploader");
const crypto                     = require("crypto");

const router = express.Router();

/**
 * ============================================================================
 * MULTI-TENANT SAAS INVOICE MODULE
 * ============================================================================
 * 
 * Key Features:
 * 1. Tenant Data Isolation: All queries are strictly scoped by `organization_id`.
 * 2. Dynamic Branding: Uses tenant organization settings (Logo, Company Name, Address, Tax ID, Currency).
 * 3. Custom Invoice Sequences: Serialwise numbering per organization (e.g. ACME-INV-0001).
 * 4. Plan Limits: Middleware checks monthly invoice quota based on tenant subscription plan.
 * 5. Public Signed PDF URL: HMAC-SHA256 signed public endpoint for WhatsApp / Meta Cloud API.
 * 6. Multi-Currency & Dynamic Tax Engines.
 */

// ─── HELPER FUNCTIONS ───────────────────────────────────────────────────────

const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

const maskPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length > 4 ? `***${digits.slice(-4)}` : "(hidden)";
};

const PUBLIC_API_BASE_URL = (
  process.env.PUBLIC_API_BASE_URL ||
  process.env.PUBLIC_BASE_URL ||
  (process.env.NODE_ENV === "production" ? "https://crm-api.vasifytech.com" : "")
).replace(/\/+$/, "");

const PDF_LINK_SECRET = process.env.PDF_LINK_SECRET || process.env.JWT_SECRET || "saas_pdf_secret";
const PDF_LINK_TTL_MS = 15 * 60 * 1000; // 15 Minutes

const signPdfLink = (invoiceId, expiresAt) =>
  crypto
    .createHmac("sha256", PDF_LINK_SECRET)
    .update(`${invoiceId}.${expiresAt}`)
    .digest("hex");

const safeEqualHex = (a, b) => {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

const buildPublicPdfUrl = (invoiceId) => {
  const expiresAt = Date.now() + PDF_LINK_TTL_MS;
  const sig = signPdfLink(invoiceId, expiresAt);
  const qs = new URLSearchParams({ e: String(expiresAt), s: sig }).toString();
  return `${PUBLIC_API_BASE_URL}/api/saas/invoices/${encodeURIComponent(invoiceId)}/public-pdf?${qs}`;
};

// ─── TENANT ACCESS CONTROL & ORGANIZATION RESOLUTION ─────────────────────────

const getTenantContext = async (req, res) => {
  const organizationId = req.user?.organization_id || req.headers["x-organization-id"] || req.user?.tenant_id;
  if (!organizationId) {
    res.status(400).json({ error: true, message: "Missing tenant organization ID." });
    return null;
  }

  // Fetch Tenant Profile & Settings
  const [orgRows] = await pool.execute(
    `SELECT * FROM organization_profiles WHERE id = ? OR organization_id = ? LIMIT 1`,
    [organizationId, organizationId]
  );

  const tenant = orgRows.length > 0 ? orgRows[0] : {
    id: organizationId,
    company_name: req.user?.company_name || "My Business",
    tax_id: "N/A",
    currency: "INR",
    currency_symbol: "₹",
    prefix: "INV-",
    invoice_limit: 100, // Monthly free quota limit
  };

  return { organizationId, tenant };
};

// ─── SUBSCRIPTION PLAN LIMIT CHECK MIDDLEWARE ────────────────────────────────

const checkSaasInvoiceLimit = async (req, res, next) => {
  try {
    const tenantCtx = await getTenantContext(req, res);
    if (!tenantCtx) return;

    const { organizationId, tenant } = tenantCtx;
    req.tenant = tenant;
    req.organizationId = organizationId;

    if (tenant.invoice_limit && tenant.invoice_limit > 0) {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);

      const [[{ count }]] = await pool.execute(
        `SELECT COUNT(*) AS count FROM invoices 
         WHERE organization_id = ? AND created_at >= ?`,
        [organizationId, firstDay]
      );

      if (count >= tenant.invoice_limit) {
        return res.status(403).json({
          error: true,
          message: `Monthly invoice limit reached (${count}/${tenant.invoice_limit}). Please upgrade your subscription plan.`,
          upgradeRequired: true,
        });
      }
    }

    next();
  } catch (err) {
    console.error("SaaS Limit Check Error:", err);
    next();
  }
};

// ─── TENANT SERIAL INVOICE NUMBER GENERATOR ──────────────────────────────────

const generateTenantInvNumber = async (conn, organizationId, customPrefix) => {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = customPrefix || `INV-${ym}-`;

  const [rows] = await conn.execute(
    `SELECT invoice_number FROM invoices 
     WHERE organization_id = ? AND invoice_number LIKE ?`,
    [organizationId, `${prefix}%`]
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
};

// ─── DYNAMIC TENANT PDF GENERATOR ───────────────────────────────────────────

async function generateSaasInvoicePdfBuffer(inv, items, tenantConfig, logoB64 = null) {
  return new Promise((resolve, reject) => {
    try {
      const currencySymbol = tenantConfig.currency_symbol || "₹";
      const companyName = tenantConfig.company_name || "Business Name";
      const companyAddress = tenantConfig.address || "";
      const taxId = tenantConfig.tax_id || "";

      let subtotal = (items && items.length > 0)
        ? items.reduce((s, it) => s + Number(it.amount || 0), 0)
        : Number(inv.amount || 0);

      const gstRate = Number(inv.tax || 18);
      const halfRate = gstRate / 2;
      const cgstAmt = (subtotal * halfRate) / 100;
      const sgstAmt = cgstAmt;
      const totalAmt = subtotal + cgstAmt + sgstAmt;
      const invStatus = String(inv.status || "").trim().toLowerCase();

      const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true, bufferPages: true });
      const buffers = [];
      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      const DARK = "#1A1A1A", GRAY = "#555555", LGRAY = "#888888";
      const BORD = "#CCCCCC", BGH = "#F5F5F5", BGALT = "#FAFAFA";

      const PW = 595.28, PH = 841.89, ML = 30, MR = 30, CW = PW - ML - MR;
      let y = 30;

      // Render Dynamic Tenant Logo or Fallback
      if (logoB64) {
        try {
          const raw = logoB64.includes(",") ? logoB64.split(",")[1] : logoB64;
          doc.image(Buffer.from(raw, "base64"), ML, y, { fit: [120, 50] });
        } catch (e) { console.warn("SaaS Logo render warning:", e.message); }
      }

      const CX = ML + 130;
      doc.fontSize(11).font("Helvetica-Bold").fillColor(DARK).text(companyName, CX, y, { width: CW - 130 });
      y += 14;
      if (companyAddress) {
        doc.fontSize(7.5).font("Helvetica").fillColor(GRAY).text(companyAddress, CX, y, { width: CW - 130, lineGap: 1 });
        y += 28;
      }
      if (taxId) {
        doc.fontSize(7.5).font("Helvetica").fillColor(GRAY).text(`Tax ID / GSTIN: ${taxId}`, CX, y, { width: CW - 130 });
        y += 12;
      }

      doc.fontSize(24).font("Helvetica-Bold").fillColor(DARK).text("INVOICE", PW - MR - 180, 30, { align: "right", width: 180 });

      y = Math.max(y, 110) + 10;

      // Metadata Box
      const MBH = 60, HW = CW / 2;
      doc.rect(ML, y, CW, MBH).stroke(BORD);
      doc.moveTo(ML + HW, y).lineTo(ML + HW, y + MBH).stroke(BORD);

      doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY).text(`Invoice #: ${inv.invoice_number || "-"}`, ML + 6, y + 8);
      doc.fontSize(7).font("Helvetica").fillColor(DARK).text(`Date: ${inv.issue_date || new Date().toISOString().split('T')[0]}`, ML + 6, y + 22);
      doc.fontSize(7).font("Helvetica").fillColor(DARK).text(`Due Date: ${inv.due_date || "-"}`, ML + 6, y + 36);

      doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY).text(`Status: ${invStatus.toUpperCase()}`, ML + HW + 6, y + 8);
      doc.fontSize(7).font("Helvetica").fillColor(DARK).text(`Currency: ${tenantConfig.currency || "INR"} (${currencySymbol})`, ML + HW + 6, y + 22);

      y += MBH + 10;

      // Customer Bill To
      doc.rect(ML, y, CW, 50).stroke(BORD);
      doc.fontSize(8).font("Helvetica-Bold").fillColor(GRAY).text("BILL TO:", ML + 6, y + 6);
      doc.fontSize(9).font("Helvetica-Bold").fillColor(DARK).text(inv.customer_name || "Valued Customer", ML + 6, y + 18);
      if (inv.customer_email) doc.fontSize(7.5).font("Helvetica").fillColor(GRAY).text(`Email: ${inv.customer_email}`, ML + 6, y + 32);

      y += 60;

      // Items Table Header
      const colW = { desc: CW * 0.5, qty: CW * 0.15, rate: CW * 0.15, amt: CW * 0.2 };
      doc.rect(ML, y, CW, 20).fill(BGH).stroke(BORD);
      doc.fontSize(7.5).font("Helvetica-Bold").fillColor(DARK);
      doc.text("Description", ML + 6, y + 6, { width: colW.desc });
      doc.text("Qty", ML + colW.desc, y + 6, { width: colW.qty, align: "center" });
      doc.text("Rate", ML + colW.desc + colW.qty, y + 6, { width: colW.rate, align: "right" });
      doc.text("Amount", ML + colW.desc + colW.qty + colW.rate - 6, y + 6, { width: colW.amt, align: "right" });

      y += 20;

      const tableRows = (items && items.length) ? items : [{ description: "Service Charges", quantity: 1, rate: subtotal, amount: subtotal }];

      tableRows.forEach((item, idx) => {
        const itemAmt = Number(item.amount || 0);
        const itemQty = Number(item.quantity || 1);
        const itemRate = Number(item.rate || itemAmt / itemQty);

        if (idx % 2 === 1) doc.rect(ML, y, CW, 20).fill(BGALT);
        doc.rect(ML, y, CW, 20).stroke(BORD);

        doc.fontSize(7.5).font("Helvetica").fillColor(DARK);
        doc.text(String(item.description || "Service"), ML + 6, y + 6, { width: colW.desc - 10 });
        doc.text(String(itemQty), ML + colW.desc, y + 6, { width: colW.qty, align: "center" });
        doc.text(`${currencySymbol} ${itemRate.toFixed(2)}`, ML + colW.desc + colW.qty, y + 6, { width: colW.rate, align: "right" });
        doc.text(`${currencySymbol} ${itemAmt.toFixed(2)}`, ML + colW.desc + colW.qty + colW.rate - 6, y + 6, { width: colW.amt, align: "right" });

        y += 20;
      });

      y += 10;

      // Totals Box
      const TW = 200, TX = ML + CW - TW;
      doc.rect(TX, y, TW, 40).stroke(BORD);
      doc.fontSize(8).font("Helvetica").fillColor(DARK).text("Sub Total:", TX + 8, y + 6);
      doc.text(`${currencySymbol} ${subtotal.toFixed(2)}`, TX + 100, y + 6, { align: "right", width: 90 });

      doc.fontSize(8).font("Helvetica-Bold").fillColor(DARK).text("Total Amount:", TX + 8, y + 22);
      doc.text(`${currencySymbol} ${totalAmt.toFixed(2)}`, TX + 100, y + 22, { align: "right", width: 90 });

      y += 50;

      // Footer Notes
      doc.fontSize(7).font("Helvetica").fillColor(LGRAY).text(`Generated by ${companyName} SaaS platform. Thank you for your business!`, ML, PH - 40, { align: "center", width: CW });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── SAAS ENDPOINTS ─────────────────────────────────────────────────────────

/**
 * GET /api/saas/invoices/next-number
 * Get next serialwise invoice number for current tenant
 */
router.get("/next-number", authenticateToken, async (req, res) => {
  try {
    const tenantCtx = await getTenantContext(req, res);
    if (!tenantCtx) return;

    const nextNumber = await generateTenantInvNumber(pool, tenantCtx.organizationId, tenantCtx.tenant.prefix);
    res.json({ error: false, nextNumber });
  } catch (err) {
    console.error("SaaS next-number error:", err);
    res.status(500).json({ error: true, message: "Failed to generate next invoice number" });
  }
});

/**
 * GET /api/saas/invoices
 * List tenant's invoices with pagination and filters
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const tenantCtx = await getTenantContext(req, res);
    if (!tenantCtx) return;

    const { organizationId } = tenantCtx;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const [invoices] = await pool.execute(
      `SELECT i.*, c.name AS customer_name, c.email AS customer_email 
       FROM invoices i 
       LEFT JOIN customers c ON i.customer_id = c.id 
       WHERE i.organization_id = ? 
       ORDER BY i.created_at DESC 
       LIMIT ? OFFSET ?`,
      [organizationId, limit, offset]
    );

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM invoices WHERE organization_id = ?`,
      [organizationId]
    );

    res.json({
      error: false,
      data: invoices,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error("SaaS Get Invoices Error:", err);
    res.status(500).json({ error: true, message: "Failed to fetch tenant invoices" });
  }
});

/**
 * POST /api/saas/invoices
 * Create new invoice for tenant
 */
router.post("/", authenticateToken, checkSaasInvoiceLimit, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const organizationId = req.organizationId;
    const tenant = req.tenant;
    const { customerId, amount, items, status, issueDate, dueDate, notes } = req.body;

    const invoiceNumber = await generateTenantInvNumber(conn, organizationId, tenant.prefix);
    const invoiceId = uuidv4();

    await conn.execute(
      `INSERT INTO invoices 
       (id, organization_id, customer_id, invoice_number, amount, total, status, issue_date, due_date, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        invoiceId,
        organizationId,
        customerId || null,
        invoiceNumber,
        amount || 0,
        amount || 0,
        status || "unpaid",
        issueDate || new Date(),
        dueDate || null,
        notes || null,
        req.user.id
      ]
    );

    if (items && Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        await conn.execute(
          `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [uuidv4(), invoiceId, item.description, item.quantity || 1, item.rate || 0, item.amount || 0]
        );
      }
    }

    await conn.commit();
    res.status(201).json({ error: false, message: "Invoice created successfully", invoiceId, invoiceNumber });
  } catch (err) {
    await conn.rollback();
    console.error("SaaS Create Invoice Error:", err);
    res.status(500).json({ error: true, message: "Failed to create invoice" });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/saas/invoices/:id/download
 * Download branded PDF
 */
router.post("/:id/download", authenticateToken, async (req, res) => {
  try {
    const tenantCtx = await getTenantContext(req, res);
    if (!tenantCtx) return;

    const { id } = req.params;
    const [invRows] = await pool.execute(
      `SELECT i.*, c.name AS customer_name, c.email AS customer_email 
       FROM invoices i 
       LEFT JOIN customers c ON i.customer_id = c.id 
       WHERE i.id = ? AND i.organization_id = ?`,
      [id, tenantCtx.organizationId]
    );

    if (!invRows.length) return res.status(404).json({ error: true, message: "Invoice not found" });

    const [items] = await pool.execute("SELECT * FROM invoice_items WHERE invoice_id = ?", [id]);

    const pdfBuffer = await generateSaasInvoicePdfBuffer(invRows[0], items, tenantCtx.tenant, req.body?.logoBase64);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=invoice-${invRows[0].invoice_number}.pdf`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("SaaS PDF Download Error:", err);
    res.status(500).json({ error: true, message: "Failed to generate PDF" });
  }
});

/**
 * GET /api/saas/invoices/:id/public-pdf
 * Public signed PDF route for Meta/WhatsApp download
 */
router.get("/:id/public-pdf", async (req, res) => {
  try {
    const { id } = req.params;
    const { e, s } = req.query;

    if (Date.now() > Number(e) || !safeEqualHex(s, signPdfLink(id, Number(e)))) {
      return res.status(403).json({ error: true, message: "Invalid or expired PDF link" });
    }

    const [invRows] = await pool.execute(
      `SELECT i.*, c.name AS customer_name, c.email AS customer_email 
       FROM invoices i 
       LEFT JOIN customers c ON i.customer_id = c.id 
       WHERE i.id = ?`,
      [id]
    );

    if (!invRows.length) return res.status(404).json({ error: true, message: "Invoice not found" });

    const [orgRows] = await pool.execute(`SELECT * FROM organization_profiles WHERE id = ?`, [invRows[0].organization_id]);
    const tenantConfig = orgRows[0] || {};
    const [items] = await pool.execute("SELECT * FROM invoice_items WHERE invoice_id = ?", [id]);

    const pdfBuffer = await generateSaasInvoicePdfBuffer(invRows[0], items, tenantConfig);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=invoice-${invRows[0].invoice_number}.pdf`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("Public PDF error:", err);
    res.status(500).json({ error: true, message: "Failed to render public PDF" });
  }
});

module.exports = router;
