const express = require("express");
const { body, validationResult, query } = require("express-validator");
const { pool } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { v4: uuidv4 } = require("uuid");
const { getOwnershipClause, ensureCanAccessRecord } = require("../utils/demoScope"); // 🔒 NEW
const multer = require("multer");   // 🆕 NEW — bulk lead upload (npm install multer)
const XLSX = require("xlsx");       // 🆕 NEW — bulk lead upload (npm install xlsx)

const router = express.Router();

// 🆕 NEW — bulk lead upload config. Memory storage since we only need the
// buffer to parse, never write it to disk. 5MB / 1000-row caps are
// deliberately conservative for a CRM lead sheet — raise MAX_UPLOAD_ROWS
// below if you need bigger imports.
const bulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      return cb(new Error("Only .xlsx, .xls, or .csv files are allowed"));
    }
    cb(null, true);
  },
});

// multer's errors (bad file type, too large) call next(err) — wrap so they
// come back as JSON like every other error in this file, instead of
// Express's default HTML error page.
const handleBulkUploadErrors = (req, res, next) => {
  bulkUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "File upload failed" });
    next();
  });
};

// ─── VASIFYTECH CRM CONFIG ─────────────────────────────────────────────────────
const PIPELINE_STAGES = ["lead", "demo", "proposal", "negotiation", "won", "lost"];

const LEAD_SOURCES = ["referral", "website", "whatsapp", "manual", "social", "other"];

const TECH_SERVICES = [
  "website", "whatsapp", "lms", "crm", "digital_marketing",
  "social-media",
  "mobile_app", "devops", "ml_project", "admin_panel",
  "excel_extractor", "word_editor", "website_mobile", "other",
];

// ─── HELPERS ───────────────────────────────────────────────────────────────────

const sanitizeParams = (...params) =>
  params.map((p) => (p === undefined ? null : p));

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: "Validation failed", details: errors.array() });
    return true;
  }
  return false;
};

// ─── FIELD MAP ─────────────────────────────────────────────────────────────────

const leadFieldMap = {
  name:                "name",
  email:               "email",
  phone:               "phone",
  company:             "company",
  source:              "source",
  status:              "status",
  priority:            "priority",
  service:             "service",
  pipelineStage:       "pipeline_stage",
  pipeline_stage:      "pipeline_stage",
  estimatedValue:      "estimated_value",
  estimated_value:     "estimated_value",
  totalAmount:         "total_amount",
  total_amount:        "total_amount",
  // ── NEW ──
  expectedAmount:      "expected_amount",
  expected_amount:     "expected_amount",
  // ─────────
  expectedCloseDate:   "expected_close_date",
  expected_close_date: "expected_close_date",
  closureDate:         "expected_close_date",
  followUpDate:        "follow_up_date",
  follow_up_date:      "follow_up_date",
  assignedTo:          "assigned_to",
  assigned_to:         "assigned_to",
  // 🆕 NEW — lets admin transfer a lead's owner after creation. Maps to the
  // same created_by column that drives sales-rep scoping (see
  // demoScope.js) — reassigning here is what makes the target rep able to
  // see the lead as "their own" going forward, and (deliberately) means
  // the previous owner loses that same visibility, since created_by is
  // being used as a mutable "current owner" field, not an immutable
  // creation-audit field, throughout this app's ownership model.
  salesOwnerId:        "created_by",
  notes:               "notes",
  whatsappNumber:      "whatsapp_number",
  whatsapp_number:     "whatsapp_number",
  referredBy:          "referred_by",
  referred_by:         "referred_by",
  isConverted:         "is_converted",
  is_converted:        "is_converted",
};

// ─── REUSABLE SELECT QUERY ─────────────────────────────────────────────────────

const LEAD_SELECT = `
  SELECT
    l.id, l.name, l.email, l.phone, l.company,
    l.source, l.status, l.pipeline_stage, l.priority,
    l.assigned_to, l.estimated_value, l.total_amount,
    l.expected_amount,
    l.notes, l.expected_close_date,
    l.whatsapp_number, l.service,
    l.follow_up_date, l.referred_by,
    l.is_converted, l.converted_customer_id,
    l.created_at, l.updated_at, l.created_by,
    u.name  AS assigned_user_name,
    cu.name AS created_user_name,
    cu.name AS sales_owner_name  -- 🆕 NEW: clearer alias for the same value —
                                  -- created_by / created_user_name is what
                                  -- drives lead ownership scoping, so this
                                  -- is "who owns this lead" for the admin UI
  FROM leads l
  LEFT JOIN users u  ON l.assigned_to = u.id
  LEFT JOIN users cu ON l.created_by  = cu.id
`;

// ─── ACCESS GUARD ──────────────────────────────────────────────────────────────
// 🔒 DEMO SCOPING: rewritten to enforce full ownership isolation instead of
// the old "assigned_to OR created_by OR unassigned" rule. A demo ("user")
// login may only touch leads it personally created; admin may never touch
// a lead created by a demo user. Returns 404 (not 403) on scope violation so
// neither side can tell the other's records exist.
const ensureCanAccessLead = async (req, res, leadId) => {
  return ensureCanAccessRecord({
    pool,
    table: "leads",
    column: "created_by",
    recordId: leadId,
    req,
    res,
    notFoundMsg: "Lead not found",
  });
};

// =============================================================================
// GET ALL LEADS
// =============================================================================

router.get(
  "/",
  authenticateToken,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().isString(),
    query("phone").optional().isString(),
    query("status").optional().isIn([...PIPELINE_STAGES, "all"]),
    query("priority").optional().isIn(["low", "medium", "high"]),
    query("source").optional().isIn([...LEAD_SOURCES, "all"]),
    query("service").optional().isIn([...TECH_SERVICES, "all"]),
    query("assignedTo").optional().isString(),
    query("createdBy").optional().isString(),
    query("followUpDue").optional().isIn(["today", "overdue", "this-week", "none"]),
    query("dateSort").optional().isIn(["latest", "oldest"]),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const pageRaw  = Number.parseInt(req.query.page,  10);
      const limitRaw = Number.parseInt(req.query.limit, 10);
      const page   = !Number.isNaN(pageRaw)  && pageRaw  > 0                    ? pageRaw  : 1;
      const limit  = !Number.isNaN(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 10;
      const offset = (page - 1) * limit;

      const {
        search, phone: phoneSearch,
        status, priority, source, service,
        assignedTo, createdBy, followUpDue,
        dateSort = "latest",
      } = req.query;

      let whereClause = "WHERE 1=1";
      const queryParams = [];

      // 🔒 DEMO SCOPING — replaces the old
      //   "assigned_to = ? OR created_by = ? OR assigned_to IS NULL" rule.
      // Demo users now only ever see leads they created; admin never sees
      // leads created by a demo user.
      {
        const { clause: ownerClause, params: ownerParams } = getOwnershipClause(req, "created_by", "l");
        whereClause += ` AND ${ownerClause}`;
        queryParams.push(...ownerParams);
      }

      if (search) {
        whereClause += " AND (l.name LIKE ? OR l.email LIKE ? OR l.company LIKE ?)";
        const s = `%${search}%`;
        queryParams.push(s, s, s);
      }

      if (phoneSearch) {
        whereClause += " AND (l.phone LIKE ? OR l.whatsapp_number LIKE ?)";
        const p = `%${phoneSearch}%`;
        queryParams.push(p, p);
      }

      if (status && status !== "all") {
        whereClause += " AND (l.pipeline_stage = ? OR l.status = ?)";
        queryParams.push(status, status);
      }

      if (priority)                    { whereClause += " AND l.priority = ?"; queryParams.push(priority); }
      if (source  && source  !== "all") { whereClause += " AND l.source = ?";  queryParams.push(source);   }
      if (service && service !== "all") { whereClause += " AND l.service = ?"; queryParams.push(service);  }

      if (assignedTo && assignedTo !== "all") {
        whereClause += " AND l.assigned_to = ?";
        queryParams.push(assignedTo);
      }

      if (createdBy && req.user.role === "admin") {
        whereClause += " AND l.created_by = ?";
        queryParams.push(createdBy);
      }

      if (followUpDue === "today") {
        whereClause += " AND DATE(l.follow_up_date) = CURDATE()";
      } else if (followUpDue === "overdue") {
        whereClause += " AND l.follow_up_date < CURDATE() AND l.status NOT IN ('won','lost')";
      } else if (followUpDue === "this-week") {
        whereClause += " AND l.follow_up_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)";
      } else if (followUpDue === "none") {
        whereClause += " AND l.follow_up_date IS NULL";
      }

      const sortDir = dateSort === "oldest" ? "ASC" : "DESC";

      const leadsSql = `
        ${LEAD_SELECT}
        ${whereClause}
        ORDER BY
          CASE WHEN l.follow_up_date IS NOT NULL AND DATE(l.follow_up_date) <= CURDATE() THEN 0 ELSE 1 END,
          l.created_at ${sortDir}
        LIMIT ${Number(limit)} OFFSET ${Number(offset)}
      `;

      const [leads] = await pool.execute(leadsSql, sanitizeParams(...queryParams));

      const countSql = `SELECT COUNT(*) AS total FROM leads l ${whereClause}`;
      const [countResult] = await pool.execute(countSql, sanitizeParams(...queryParams));

      const total      = countResult[0]?.total || 0;
      const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

      res.json({
        leads,
        pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      });
    } catch (error) {
      console.error("Leads fetch error:", error);
      res.status(500).json({ error: "Failed to fetch leads" });
    }
  }
);

// =============================================================================
// LEAD STATS
// =============================================================================

router.get("/stats", authenticateToken, async (req, res) => {
  try {
    const params = [];
    let whereClause = "WHERE 1=1";

    // 🔒 DEMO SCOPING — replaces the old "assigned_to = ? OR created_by = ?" rule
    {
      const { clause: ownerClause, params: ownerParams } = getOwnershipClause(req, "created_by");
      whereClause += ` AND ${ownerClause}`;
      params.push(...ownerParams);
    }

    const [rows] = await pool.execute(
      `SELECT
        COUNT(*)                                                         AS totalLeads,
        SUM(CASE WHEN pipeline_stage = 'lead'        THEN 1 ELSE 0 END) AS stageLeads,
        SUM(CASE WHEN pipeline_stage = 'demo'        THEN 1 ELSE 0 END) AS stageDemos,
        SUM(CASE WHEN pipeline_stage = 'proposal'    THEN 1 ELSE 0 END) AS stageProposals,
        SUM(CASE WHEN pipeline_stage = 'negotiation' THEN 1 ELSE 0 END) AS stageNegotiations,
        SUM(CASE WHEN pipeline_stage = 'won'         THEN 1 ELSE 0 END) AS stageWon,
        SUM(CASE WHEN pipeline_stage = 'lost'        THEN 1 ELSE 0 END) AS stageLost,
        SUM(CASE WHEN source = 'referral' THEN 1 ELSE 0 END)            AS sourceReferral,
        SUM(CASE WHEN source = 'website'  THEN 1 ELSE 0 END)            AS sourceWebsite,
        SUM(CASE WHEN source = 'whatsapp' THEN 1 ELSE 0 END)            AS sourceWhatsapp,
        SUM(CASE WHEN source = 'manual'   THEN 1 ELSE 0 END)            AS sourceManual,
        SUM(CASE WHEN source = 'social'   THEN 1 ELSE 0 END)            AS sourceSocial,
        SUM(COALESCE(total_amount, estimated_value, 0))                  AS totalPipelineValue,
        SUM(CASE WHEN pipeline_stage = 'won'
            THEN COALESCE(total_amount, estimated_value, 0)
            ELSE 0 END)                                                  AS wonValue,
        SUM(COALESCE(expected_amount, 0))                                AS totalExpectedValue,
        SUM(CASE WHEN follow_up_date IS NOT NULL
                  AND DATE(follow_up_date) <= CURDATE()
                  AND pipeline_stage NOT IN ('won','lost')
             THEN 1 ELSE 0 END)                                          AS pendingFollowUps
      FROM leads ${whereClause}`,
      sanitizeParams(...params)
    );

    const [sourceBreakdown] = await pool.execute(
      `SELECT source, COUNT(*) AS count FROM leads ${whereClause} GROUP BY source ORDER BY count DESC`,
      sanitizeParams(...params)
    );

    const [serviceBreakdown] = await pool.execute(
      `SELECT service, COUNT(*) AS count FROM leads ${whereClause} AND service IS NOT NULL GROUP BY service ORDER BY count DESC`,
      sanitizeParams(...params)
    );

    const [dailyLeads] = await pool.execute(
      `SELECT DATE(created_at) AS date, COUNT(*) AS count FROM leads ${whereClause} AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at) ORDER BY date`,
      sanitizeParams(...params)
    );

    const [monthlyRevenue] = await pool.execute(
      `SELECT
         DATE_FORMAT(created_at, '%Y-%m') AS month,
         SUM(COALESCE(total_amount, estimated_value, 0)) AS pipeline,
         SUM(COALESCE(expected_amount, 0))               AS expected
       FROM leads ${whereClause}
       AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month`,
      sanitizeParams(...params)
    );

    res.json({ stats: rows[0] || {}, sourceBreakdown, serviceBreakdown, dailyLeads, monthlyRevenue });
  } catch (error) {
    console.error("Lead stats error:", error);
    res.status(500).json({ error: "Failed to fetch lead stats" });
  }
});

// =============================================================================
// 🆕 NEW — BULK LEAD UPLOAD (Excel/CSV import)
// =============================================================================
// Both routes below MUST be registered before "GET /:id" — Express matches
// routes top-to-bottom, and "/:id" would otherwise treat the literal path
// segment "bulk-upload" as if it were a lead's id, matching first and
// hiding these handlers entirely. Same fix pattern already used for
// /stats, /payments/summary etc. elsewhere in this codebase.

// ─── Column header aliases ─────────────────────────────────────────────────
// Accepts a range of common header spellings so the uploader doesn't have
// to match an exact template. Matching is case/space/underscore-insensitive
// (see normalizeHeader below).
const BULK_HEADER_ALIASES = {
  name:           ["name", "clientname", "leadname", "fullname"],
  phone:          ["phone", "phonenumber", "mobile", "mobilenumber", "contact", "contactnumber"],
  email:          ["email", "emailaddress"],
  company:        ["company", "business", "companyname"],
  whatsappNumber: ["whatsapp", "whatsappnumber"],
  source:         ["source", "leadsource"],
  priority:       ["priority"],
  service:        ["service"],
  estimatedValue: ["estimatedvalue", "totalamount", "amount", "dealvalue", "totalvalue"],
  expectedAmount: ["expectedamount", "expected"],
  notes:          ["notes", "remarks", "comment", "comments"],
  referredBy:     ["referredby", "referral", "reference"],
};

const normalizeHeader = (h) => String(h ?? "").trim().toLowerCase().replace(/[\s_]+/g, "");

const extractBulkRowFields = (rawRow) => {
  const out = {};
  for (const [key, value] of Object.entries(rawRow)) {
    const norm = normalizeHeader(key);
    for (const [field, aliases] of Object.entries(BULK_HEADER_ALIASES)) {
      if (aliases.includes(norm)) {
        out[field] = typeof value === "string" ? value.trim() : value;
        break;
      }
    }
  }
  return out;
};

const MAX_BULK_ROWS = 1000;

// ─── GET /leads/bulk-upload/template — downloadable starter workbook ───────
router.get("/bulk-upload/template", authenticateToken, (req, res) => {
  try {
    const headers = [
      "Name", "Phone", "Email", "Company", "WhatsApp Number",
      "Source", "Priority", "Service", "Estimated Value", "Expected Amount",
      "Referred By", "Notes",
    ];
    const example = [
      "Rahul Sharma", "+91 98765 43210", "rahul@example.com", "Sharma Traders", "+91 98765 43210",
      "referral", "medium", "website", "50000", "45000",
      "Existing Client", "Interested in a new website",
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="leads-upload-template.xlsx"');
    res.send(buffer);
  } catch (error) {
    console.error("Bulk upload template error:", error);
    res.status(500).json({ error: "Failed to generate template" });
  }
});

// ─── POST /leads/bulk-upload — parse + import ───────────────────────────────
// Every row is validated independently — a bad row is skipped with a
// reason, not a reason to fail the whole batch. Response always reports
// both what was created and what was skipped so the uploader can fix and
// re-upload just the problem rows.
router.post("/bulk-upload", authenticateToken, handleBulkUploadErrors, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch (e) {
      return res.status(400).json({ error: "Could not read the file — make sure it's a valid Excel or CSV file" });
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: "The file has no sheets" });

    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (rawRows.length === 0) {
      return res.status(400).json({ error: "The file has no data rows" });
    }
    if (rawRows.length > MAX_BULK_ROWS) {
      return res.status(400).json({ error: `Too many rows — max ${MAX_BULK_ROWS} leads per upload. Split into smaller files.` });
    }

    const skipped = [];
    const seenPhones = new Set();
    const candidates = [];

    rawRows.forEach((rawRow, idx) => {
      const rowNum = idx + 2; // +1 for 0-index, +1 for the header row itself
      const fields = extractBulkRowFields(rawRow);

      const name  = String(fields.name  ?? "").trim();
      const phone = String(fields.phone ?? "").trim();

      if (!name)  { skipped.push({ row: rowNum, reason: "Missing name" });  return; }
      if (!phone) { skipped.push({ row: rowNum, reason: "Missing phone" }); return; }

      if (seenPhones.has(phone)) {
        skipped.push({ row: rowNum, reason: `Duplicate phone in file (${phone})` });
        return;
      }
      seenPhones.add(phone);

      const source   = LEAD_SOURCES.includes(fields.source)               ? fields.source   : "manual";
      const priority = ["low", "medium", "high"].includes(fields.priority) ? fields.priority : "medium";
      const service  = TECH_SERVICES.includes(fields.service)             ? fields.service  : null;

      const estimatedValueNum = Number(fields.estimatedValue);
      const expectedAmountNum = Number(fields.expectedAmount);

      candidates.push({
        rowNum, name, phone,
        email: fields.email
          ? String(fields.email).trim().toLowerCase()
          : `${phone.replace(/\D/g, "")}@vasifytech.local`,
        company: fields.company || null,
        whatsappNumber: fields.whatsappNumber || phone,
        source, priority, service,
        estimatedValue: Number.isFinite(estimatedValueNum) ? estimatedValueNum : 0,
        expectedAmount: Number.isFinite(expectedAmountNum) ? expectedAmountNum : 0,
        notes: fields.notes || null,
        referredBy: fields.referredBy || null,
      });
    });

    if (candidates.length === 0) {
      return res.status(400).json({ error: "No valid rows to import", created: 0, skipped });
    }

    // Duplicate check against existing leads — one query for the whole batch
    // rather than one per row.
    const phones = candidates.map((r) => r.phone);
    const placeholders = phones.map(() => "?").join(",");
    const [existingRows] = await pool.execute(
      `SELECT phone FROM leads WHERE phone IN (${placeholders})`,
      sanitizeParams(...phones)
    );
    const existingPhones = new Set(existingRows.map((r) => r.phone));

    // 🔒 Ownership matches single-lead creation exactly: non-admin uploads
    // are always self-owned; admin uploads default to unassigned unless a
    // per-row assignee is added in a future version of this endpoint.
    const assignedTo = req.user.role !== "admin" ? req.user.id : null;
    const createdBy  = req.user.id; // drives sales-rep scoping — see demoScope.js

    let created = 0;
    for (const row of candidates) {
      if (existingPhones.has(row.phone)) {
        skipped.push({ row: row.rowNum, reason: `Lead with phone ${row.phone} already exists` });
        continue;
      }
      try {
        const leadId = uuidv4();
        await pool.execute(
          `INSERT INTO leads (
            id, name, email, phone, company,
            source, status, pipeline_stage, priority,
            assigned_to, estimated_value, total_amount, expected_amount,
            notes, whatsapp_number, service,
            referred_by, is_converted,
            created_by, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, 0,
            ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )`,
          sanitizeParams(
            leadId, row.name, row.email, row.phone, row.company,
            row.source, "lead", "lead", row.priority,
            assignedTo, row.estimatedValue, row.estimatedValue, row.expectedAmount,
            row.notes, row.whatsappNumber, row.service,
            row.referredBy,
            createdBy
          )
        );
        created += 1;
      } catch (err) {
        console.error("Bulk lead insert error:", { row: row.rowNum, err });
        skipped.push({ row: row.rowNum, reason: "Database error — could not save this row" });
      }
    }

    return res.status(201).json({
      message: `Imported ${created} of ${rawRows.length} leads`,
      created,
      skipped,
      totalRows: rawRows.length,
    });
  } catch (error) {
    console.error("Bulk lead upload error:", error);
    res.status(500).json({ error: "Failed to process bulk upload" });
  }
});

// =============================================================================
// GET LEAD BY ID
// =============================================================================

router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await ensureCanAccessLead(req, res, id);
    if (!access.ok) return;

    const [leads] = await pool.execute(
      `${LEAD_SELECT} WHERE l.id = ?`,
      sanitizeParams(id)
    );

    if (leads.length === 0) return res.status(404).json({ error: "Lead not found" });

    const lead = leads[0];

    const tasks = await pool.execute(
      'SELECT id, title, type, status, due_date FROM tasks WHERE related_type = "lead" AND related_id = ?',
      sanitizeParams(id)
    ).then(([rows]) => rows).catch(() => []);

    const followUpHistory = await pool.execute(
      `SELECT * FROM lead_follow_ups WHERE lead_id = ? ORDER BY follow_up_date ASC, created_at DESC`,
      sanitizeParams(id)
    ).then(([rows]) => rows).catch(() => []);

    res.json({ lead, related: { tasks, followUpHistory } });
  } catch (error) {
    console.error("Lead fetch error:", error);
    res.status(500).json({ error: "Failed to fetch lead" });
  }
});

// =============================================================================
// CREATE LEAD
// =============================================================================

router.post(
  "/",
  authenticateToken,
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("phone").notEmpty().withMessage("Phone is required"),
    body("email").optional().isEmail(),
    body("company").optional().isString(),
    body("source").optional().isIn(LEAD_SOURCES),
    body("priority").optional().isIn(["low", "medium", "high"]),
    body("assignedTo").optional().isString(),
    body("service").optional().isIn(TECH_SERVICES),
    body("estimatedValue").optional().isNumeric(),
    body("totalAmount").optional().isNumeric(),
    body("expectedAmount").optional().isNumeric(),   // ── NEW ──
    body("notes").optional().isString(),
    body("referredBy").optional().isString(),
    body("referred_by").optional().isString(),
    body("expectedCloseDate").optional().isISO8601(),
    body("whatsappNumber").optional().isString(),
    body("followUpDate").optional().isISO8601(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      if (!req.user?.id) return res.status(401).json({ error: "Unauthenticated" });

      const {
        name, email, phone, company, source, priority,
        assignedTo: rawAssignedTo, service,
        estimatedValue, totalAmount, expectedAmount,   // ── NEW ──
        notes, expectedCloseDate, whatsappNumber, followUpDate,
      } = req.body;

      const referredBy = req.body.referredBy ?? req.body.referred_by ?? null;

      // Phone duplicate check
      const [existingByPhone] = await pool.execute(
        "SELECT id, name, pipeline_stage FROM leads WHERE phone = ?",
        sanitizeParams(phone)
      );

      if (existingByPhone.length > 0) {
        const dup = existingByPhone[0];
        return res.status(409).json({
          error:        "Lead already exists",
          message:      `A lead with phone ${phone} already exists.`,
          existingLead: { id: dup.id, name: dup.name, status: dup.pipeline_stage },
        });
      }

      const normalizedEmail    = email ? email.trim().toLowerCase() : `${phone.replace(/\D/g, "")}@vasifytech.local`;
      const safeSource         = source ?? "manual";
      const safePriority       = priority ?? "medium";
      const safeEstimatedValue = estimatedValue  != null ? Number(estimatedValue)  : 0;
      const safeTotalAmount    = totalAmount     != null ? Number(totalAmount)     : safeEstimatedValue;
      const safeExpectedAmount = expectedAmount  != null ? Number(expectedAmount)  : 0;  // ── NEW ──

      let safeExpectedCloseDate = null;
      if (expectedCloseDate) {
        const d = new Date(expectedCloseDate);
        if (!Number.isNaN(d.getTime())) safeExpectedCloseDate = d.toISOString().slice(0, 10);
      }

      let safeFollowUpDate = null;
      if (followUpDate) {
        const d = new Date(followUpDate);
        if (!Number.isNaN(d.getTime())) safeFollowUpDate = d.toISOString().slice(0, 10);
      }

      let assignedTo = rawAssignedTo ?? null;
      if (req.user.role !== "admin") {
        assignedTo = req.user.id;
      } else if (!assignedTo || assignedTo === "" || assignedTo === "0") {
        assignedTo = null;
      }

      if (assignedTo != null) {
        const [userRows] = await pool.execute("SELECT id FROM users WHERE id = ?", sanitizeParams(assignedTo));
        if (userRows.length === 0) return res.status(400).json({ error: "Invalid assigned user" });
      }

      const leadId    = uuidv4();
      const createdBy = req.user.id; // 🔒 this is what demo scoping keys off — unchanged, already correct

      await pool.execute(
        `INSERT INTO leads (
          id, name, email, phone, company,
          source, status, pipeline_stage, priority,
          assigned_to, estimated_value, total_amount, expected_amount,
          notes, expected_close_date,
          whatsapp_number, service,
          follow_up_date, referred_by,
          is_converted,
          created_by, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          0,
          ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
        sanitizeParams(
          leadId, name.trim(), normalizedEmail, phone, company ?? null,
          safeSource, "lead", "lead", safePriority,
          assignedTo, safeEstimatedValue, safeTotalAmount, safeExpectedAmount,  // ── NEW ──
          notes ?? null, safeExpectedCloseDate,
          whatsappNumber ?? phone, service ?? null,
          safeFollowUpDate, referredBy,
          createdBy
        )
      );

      const [leads] = await pool.execute(
        `${LEAD_SELECT} WHERE l.id = ?`,
        sanitizeParams(leadId)
      );

      res.status(201).json({ message: "Lead created successfully", lead: leads[0] });
    } catch (error) {
      console.error("Lead creation error:", error);
      res.status(500).json({ error: "Failed to create lead" });
    }
  }
);

// =============================================================================
// UPDATE LEAD
// =============================================================================

router.put(
  "/:id",
  authenticateToken,
  [
    body("name").optional().trim().notEmpty(),
    body("email").optional().isEmail(),
    body("phone").optional().isString(),
    body("company").optional().isString(),
    body("source").optional().isIn(LEAD_SOURCES),
    body("status").optional().isIn(PIPELINE_STAGES),
    body("pipelineStage").optional().isIn(PIPELINE_STAGES),
    body("pipeline_stage").optional().isIn(PIPELINE_STAGES),
    body("priority").optional().isIn(["low", "medium", "high"]),
    body("service").optional().isIn(TECH_SERVICES),
    body("estimatedValue").optional().isNumeric(),
    body("estimated_value").optional().isNumeric(),
    body("totalAmount").optional().isNumeric(),
    body("total_amount").optional().isNumeric(),
    body("expectedAmount").optional().isNumeric(),    // ── NEW ──
    body("expected_amount").optional().isNumeric(),   // ── NEW ──
    body("notes").optional().isString(),
    body("referredBy").optional().isString(),
    body("referred_by").optional().isString(),
    body("expectedCloseDate").optional(),
    body("closureDate").optional(),
    body("whatsappNumber").optional().isString(),
    body("whatsapp_number").optional().isString(),
    body("followUpDate").optional(),
    body("follow_up_date").optional(),
    body("assignedTo").optional().isString(),
    body("assigned_to").optional().isString(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const { id } = req.params;
      const updateData = { ...req.body };

      const access = await ensureCanAccessLead(req, res, id);
      if (!access.ok) return;

      // Normalise pipeline_stage
      const incomingStage =
        updateData.pipelineStage ?? updateData.pipeline_stage ?? updateData.status ?? null;
      if (incomingStage) {
        updateData.status         = incomingStage;
        updateData.pipeline_stage = incomingStage;
      }
      delete updateData.pipelineStage;

      // Normalise closureDate alias
      if (updateData.closureDate !== undefined && updateData.expectedCloseDate === undefined) {
        updateData.expectedCloseDate = updateData.closureDate;
      }
      delete updateData.closureDate;

      // Phone conflict check
      if (updateData.phone !== undefined) {
        const [phoneConflict] = await pool.execute(
          "SELECT id FROM leads WHERE phone = ? AND id != ?",
          sanitizeParams(updateData.phone, id)
        );
        if (phoneConflict.length > 0) {
          return res.status(409).json({
            error:          "Lead already exists",
            message:        `A lead with phone ${updateData.phone} already exists.`,
            existingLeadId: phoneConflict[0].id,
          });
        }
      }

      if (updateData.email !== undefined) {
        updateData.email = updateData.email.trim().toLowerCase();
      }

      // Assigned-to guard
      if (
        Object.prototype.hasOwnProperty.call(updateData, "assignedTo") ||
        Object.prototype.hasOwnProperty.call(updateData, "assigned_to")
      ) {
        if (req.user.role !== "admin") {
          delete updateData.assignedTo;
          delete updateData.assigned_to;
        } else {
          let assignedTo = updateData.assignedTo ?? updateData.assigned_to ?? null;
          if (!assignedTo || assignedTo === "" || assignedTo === "0") assignedTo = null;
          if (assignedTo != null) {
            const [userRows] = await pool.execute(
              "SELECT id FROM users WHERE id = ?",
              sanitizeParams(assignedTo)
            );
            if (userRows.length === 0) return res.status(400).json({ error: "Invalid assigned user" });
          }
          updateData.assignedTo = assignedTo;
        }
      }

      // 🆕 NEW — Sales Owner (created_by) transfer guard, admin-only.
      // Reassigning this is what the "Sales Owner" dropdown in the Leads
      // table calls. Blocks assigning ownership to a demo ("user"-role)
      // account — doing so would pull a real lead into a demo sandbox,
      // hiding it from every real admin/sales login (see demoScope.js).
      if (Object.prototype.hasOwnProperty.call(updateData, "salesOwnerId")) {
        if (req.user.role !== "admin") {
          delete updateData.salesOwnerId;
        } else {
          const salesOwnerId = updateData.salesOwnerId;
          if (!salesOwnerId || salesOwnerId === "" || salesOwnerId === "0") {
            return res.status(400).json({ error: "salesOwnerId is required" });
          }
          const [ownerRows] = await pool.execute(
            "SELECT id, role FROM users WHERE id = ?",
            sanitizeParams(salesOwnerId)
          );
          if (ownerRows.length === 0) {
            return res.status(400).json({ error: "Invalid sales owner" });
          }
          if (ownerRows[0].role === "user") {
            return res.status(400).json({ error: "Cannot assign a lead to a demo account" });
          }
          updateData.salesOwnerId = salesOwnerId;
        }
      }

      const [existingLeads] = await pool.execute(
        "SELECT id FROM leads WHERE id = ?",
        sanitizeParams(id)
      );
      if (existingLeads.length === 0) return res.status(404).json({ error: "Lead not found" });

      // Build SET clause — leadFieldMap now includes expectedAmount automatically
      const updateFields = [];
      const updateValues = [];
      const seenDbFields = new Set();

      Object.entries(updateData).forEach(([key, value]) => {
        if (value === undefined) return;
        const dbField = leadFieldMap[key];
        if (!dbField) return;
        if (seenDbFields.has(dbField)) return;
        seenDbFields.add(dbField);
        updateFields.push(`${dbField} = ?`);
        updateValues.push(value === "" ? null : value);
      });

      if (updateFields.length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      updateValues.push(id);

      await pool.execute(
        `UPDATE leads SET ${updateFields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        sanitizeParams(...updateValues)
      );

      const [leads] = await pool.execute(
        `${LEAD_SELECT} WHERE l.id = ?`,
        sanitizeParams(id)
      );

      res.json({ message: "Lead updated successfully", lead: leads[0] });
    } catch (error) {
      console.error("Lead update error:", error);
      res.status(500).json({ error: "Failed to update lead" });
    }
  }
);

// =============================================================================
// FOLLOW-UP HISTORY CRUD
// =============================================================================

router.get("/:id/follow-ups", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await ensureCanAccessLead(req, res, id);
    if (!access.ok) return;

    const [followUps] = await pool.execute(
      `SELECT * FROM lead_follow_ups WHERE lead_id = ? ORDER BY follow_up_date ASC, created_at DESC`,
      sanitizeParams(id)
    );

    res.json({ followUps });
  } catch (error) {
    console.error("Follow-ups fetch error:", error);
    res.status(500).json({ error: "Failed to fetch follow-ups" });
  }
});

router.post(
  "/:id/follow-ups",
  authenticateToken,
  [
    body("followUpDate").notEmpty().isISO8601().withMessage("Valid follow-up date is required"),
    body("followUpTime").optional().isString(),
    body("notes").optional().isString(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const { id } = req.params;
      const { followUpDate, followUpTime, notes } = req.body;

      const access = await ensureCanAccessLead(req, res, id);
      if (!access.ok) return;

      const d = new Date(followUpDate);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid follow-up date" });

      const safeDate   = d.toISOString().slice(0, 10);
      const followUpId = uuidv4();

      await pool.execute(
        `INSERT INTO lead_follow_ups
           (id, lead_id, follow_up_date, follow_up_time, notes, completed, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        sanitizeParams(followUpId, id, safeDate, followUpTime ?? null, notes ?? null, req.user.id)
      );

      await pool.execute(
        `UPDATE leads SET follow_up_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        sanitizeParams(safeDate, id)
      );

      const [rows] = await pool.execute(
        `SELECT * FROM lead_follow_ups WHERE id = ?`,
        sanitizeParams(followUpId)
      );

      res.status(201).json({ message: "Follow-up added successfully", followUp: rows[0] });
    } catch (error) {
      console.error("Follow-up add error:", error);
      res.status(500).json({ error: "Failed to add follow-up" });
    }
  }
);

router.patch(
  "/:id/follow-ups/:followUpId",
  authenticateToken,
  [
    body("followUpDate").optional().isISO8601(),
    body("followUpTime").optional().isString(),
    body("notes").optional().isString(),
    body("completed").optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const { id, followUpId } = req.params;
      const { followUpDate, followUpTime, notes, completed } = req.body;

      const access = await ensureCanAccessLead(req, res, id);
      if (!access.ok) return;

      const updateFields = [];
      const updateValues = [];

      if (followUpDate !== undefined) {
        const d = new Date(followUpDate);
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid date" });
        updateFields.push("follow_up_date = ?");
        updateValues.push(d.toISOString().slice(0, 10));
      }
      if (followUpTime !== undefined) { updateFields.push("follow_up_time = ?"); updateValues.push(followUpTime); }
      if (notes        !== undefined) { updateFields.push("notes = ?");          updateValues.push(notes);        }
      if (completed    !== undefined) { updateFields.push("completed = ?");      updateValues.push(completed ? 1 : 0); }

      if (updateFields.length === 0) return res.status(400).json({ error: "No fields to update" });

      updateValues.push(followUpId, id);
      await pool.execute(
        `UPDATE lead_follow_ups SET ${updateFields.join(", ")}, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND lead_id = ?`,
        sanitizeParams(...updateValues)
      );

      const [rows] = await pool.execute(
        `SELECT * FROM lead_follow_ups WHERE id = ?`,
        sanitizeParams(followUpId)
      );

      res.json({ message: "Follow-up updated successfully", followUp: rows[0] ?? null });
    } catch (error) {
      console.error("Follow-up update error:", error);
      res.status(500).json({ error: "Failed to update follow-up" });
    }
  }
);

router.delete("/:id/follow-ups/:followUpId", authenticateToken, async (req, res) => {
  try {
    const { id, followUpId } = req.params;
    const access = await ensureCanAccessLead(req, res, id);
    if (!access.ok) return;

    await pool.execute(
      `DELETE FROM lead_follow_ups WHERE id = ? AND lead_id = ?`,
      sanitizeParams(followUpId, id)
    );

    res.json({ message: "Follow-up deleted successfully" });
  } catch (error) {
    console.error("Follow-up delete error:", error);
    res.status(500).json({ error: "Failed to delete follow-up" });
  }
});

// Legacy shortcut PUT /:id/follow-up
router.put(
  "/:id/follow-up",
  authenticateToken,
  [
    body("followUpDate").notEmpty().isISO8601().withMessage("Valid follow-up date is required"),
    body("followUpNotes").optional().isString(),
    body("followUpTime").optional().isString(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const { id } = req.params;
      const { followUpDate, followUpNotes, followUpTime } = req.body;

      const access = await ensureCanAccessLead(req, res, id);
      if (!access.ok) return;

      const d = new Date(followUpDate);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid follow-up date" });
      const safeDate = d.toISOString().slice(0, 10);

      await pool.execute(
        `UPDATE leads SET follow_up_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        sanitizeParams(safeDate, id)
      );

      try {
        await pool.execute(
          `INSERT INTO lead_follow_ups
             (id, lead_id, follow_up_date, follow_up_time, notes, completed, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          sanitizeParams(uuidv4(), id, safeDate, followUpTime ?? null, followUpNotes ?? null, req.user.id)
        );
      } catch (_) { /* non-fatal */ }

      res.json({ message: "Follow-up scheduled", followUpDate: safeDate });
    } catch (error) {
      console.error("Follow-up update error:", error);
      res.status(500).json({ error: "Failed to update follow-up" });
    }
  }
);

router.put("/:id/follow-up/:followUpId/complete", authenticateToken, async (req, res) => {
  try {
    const { id, followUpId } = req.params;
    const { completed = true } = req.body;

    const access = await ensureCanAccessLead(req, res, id);
    if (!access.ok) return;

    await pool.execute(
      `UPDATE lead_follow_ups SET completed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND lead_id = ?`,
      sanitizeParams(completed ? 1 : 0, followUpId, id)
    );

    res.json({ message: "Follow-up status updated" });
  } catch (error) {
    console.error("Follow-up complete error:", error);
    res.status(500).json({ error: "Failed to update follow-up status" });
  }
});

// =============================================================================
// CONVERT LEAD TO CLIENT
// =============================================================================

router.post(
  "/:id/convert",
  authenticateToken,
  [body("customerData").optional().isObject()],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const { id } = req.params;
      const { customerData = {} } = req.body;

      const access = await ensureCanAccessLead(req, res, id);
      if (!access.ok) return;

      const [leads] = await pool.execute("SELECT * FROM leads WHERE id = ?", sanitizeParams(id));
      if (leads.length === 0) return res.status(404).json({ error: "Lead not found" });

      const lead = leads[0];

      if (lead.converted_customer_id) {
        return res.status(400).json({ error: "This lead has already been converted to a client." });
      }

      const [existingByPhone] = await pool.execute(
        "SELECT * FROM customers WHERE phone = ?",
        sanitizeParams(lead.phone)
      );

      if (existingByPhone.length > 0) {
        const existingClient = existingByPhone[0];
        await pool.execute(
          `UPDATE leads SET
             pipeline_stage = 'won', status = 'won',
             converted_customer_id = ?,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          sanitizeParams(existingClient.id, id)
        );
        try {
          existingClient.tags = typeof existingClient.tags === "string"
            ? JSON.parse(existingClient.tags)
            : existingClient.tags ?? [];
        } catch { existingClient.tags = []; }
        return res.json({ message: "Lead linked to existing client", customer: existingClient });
      }

      const connection = await pool.getConnection();
      await connection.beginTransaction();

      try {
        let assignedTo = customerData.assignedTo ?? lead.assigned_to ?? null;
        if (!assignedTo || assignedTo === "" || assignedTo === "0") assignedTo = null;
        if (assignedTo != null) {
          const [userRows] = await connection.execute("SELECT id FROM users WHERE id = ?", sanitizeParams(assignedTo));
          if (userRows.length === 0) assignedTo = null;
        }

        // 🔒 DEMO SCOPING: customers are owned via assigned_to (see customers.js).
        // A demo user's converted client must land in their own sandbox
        // regardless of whatever assigned_to the lead/customerData carried,
        // otherwise the new client could end up unowned/orphaned and
        // invisible to both the demo user and admin.
        if (req.user.role !== "admin") {
          assignedTo = req.user.id;
        } else if (assignedTo == null) {
          // 🔒 Same NULL gap that caused the legacy-data issue: if the lead
          // itself was never assigned to anyone and customerData doesn't
          // specify one, default to the converting admin so the new client
          // never lands with assigned_to = NULL (which the ownership rule
          // would then hide from every admin login).
          assignedTo = req.user.id;
        }

        const customerId = uuidv4();

        let tagsArray = Array.isArray(customerData.tags)
          ? customerData.tags
          : typeof customerData.tags === "string" && customerData.tags.trim()
          ? [customerData.tags.trim()]
          : [];

        if (lead.service && !tagsArray.includes(lead.service)) {
          tagsArray.push(lead.service);
        }

        // ✅ FIX (round 2): the customer's "Deal Value" column reads dealValue /
// paidAmount / expectedAmount — NOT total_value alone. The previous version
// only wrote total_value, so a freshly-converted client showed "—" in the
// new Deal Value column even though total_value had a number in it.
//
// New semantics: Due is ALWAYS derived as dealValue - paidAmount, computed
// here server-side — never carried over from the lead's old expected_amount
// forecast, since nothing has been paid yet at the moment of conversion.
const safeTotalValue = customerData.totalValue != null && customerData.totalValue !== ""
  ? Number(customerData.totalValue)
  : (lead.total_amount ?? lead.estimated_value ?? 0);

const safeDealValue = customerData.dealValue != null && customerData.dealValue !== ""
  ? Number(customerData.dealValue)
  : safeTotalValue;

const safePaidAmount = customerData.paidAmount != null && customerData.paidAmount !== ""
  ? Number(customerData.paidAmount)
  : 0;

const safeExpectedAmount = Math.max(safeDealValue - safePaidAmount, 0);

await connection.execute(
  `INSERT INTO customers (
    id, name, email, phone, company,
    address, city, state, zip_code, country,
    status, source, service,
    assigned_to, tags, notes,
    total_value, deal_value, paid_amount, expected_amount, whatsapp_number
  ) VALUES (
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?, ?, ?
  )`,
  sanitizeParams(
    customerId,
    customerData.name        || lead.name,
    lead.email,
    customerData.phone       || lead.phone,
    customerData.company     || lead.company,
    customerData.address     || null,
    customerData.city        || null,
    customerData.state       || null,
    customerData.zipCode     || null,
    customerData.country     || "India",
    customerData.status      || "active",
    lead.source,
    customerData.service     || lead.service,
    assignedTo,
    JSON.stringify(tagsArray),
    customerData.notes       || lead.notes,
    safeTotalValue,
    safeDealValue,                                          // ✅ NEW
    safePaidAmount,                                          // ✅ NEW
    safeExpectedAmount,                                      // ✅ FIXED — now derived, not from lead
    customerData.whatsappNumber || lead.whatsapp_number
  )
);
        await connection.execute(
          `UPDATE leads SET
             pipeline_stage = 'won', status = 'won',
             converted_customer_id = ?,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          sanitizeParams(customerId, id)
        );

        try {
          await connection.execute(
            'UPDATE tasks SET related_type = "customer", related_id = ? WHERE related_type = "lead" AND related_id = ?',
            sanitizeParams(customerId, id)
          );
        } catch (_) { /* non-fatal */ }

        await connection.commit();

        const [customers] = await pool.execute(
          `SELECT c.*, u.name AS assigned_user_name
           FROM customers c
           LEFT JOIN users u ON c.assigned_to = u.id
           WHERE c.id = ?`,
          sanitizeParams(customerId)
        );

        const customer = customers[0];
        try {
          customer.tags = customer.tags && typeof customer.tags === "string"
            ? JSON.parse(customer.tags)
            : customer.tags ?? [];
        } catch { customer.tags = []; }

        res.json({ message: "Lead converted to client successfully", customer });
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error("Lead conversion error:", error);
      res.status(500).json({ error: "Failed to convert lead to client" });
    }
  }
);

// =============================================================================
// DELETE LEAD
// =============================================================================

router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const access = await ensureCanAccessLead(req, res, id);
    if (!access.ok) return;

    const [existingLeads] = await pool.execute(
      "SELECT id FROM leads WHERE id = ?",
      sanitizeParams(id)
    );

    if (existingLeads.length === 0) return res.status(404).json({ error: "Lead not found" });

    await pool.execute("DELETE FROM leads WHERE id = ?", sanitizeParams(id));

    res.json({ message: "Lead deleted successfully" });
  } catch (error) {
    console.error("Lead deletion error:", error);
    res.status(500).json({ error: "Failed to delete lead" });
  }
});

module.exports = router;