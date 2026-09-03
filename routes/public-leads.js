// routes/public-leads.js
const express = require("express");
const { body, validationResult } = require("express-validator");
const { pool } = require("../config/database");
const { v4: uuidv4 } = require("uuid");
const { sendTemplate, sendText } = require("../services/whatsapp");

const router = express.Router();

// ─── Valid service ENUM values (must match DB ENUM exactly) ───────────────────
const VALID_SERVICES = ["haemodialysis", "hdf", "peritoneal", "nursing", "other"];

// Maps website display names → CRM ENUM (fallback if frontend sends display name)
const DISPLAY_TO_ENUM = {
  "Home Haemodialysis":                "haemodialysis",
  "HDF (Haemodialfiltration) At-home": "hdf",
  "Peritoneal Dialysis":               "peritoneal",
  "ANM/GNM Nurse":                     "nursing",
};

// Resolve any incoming service value → valid DB ENUM
const resolveService = (raw) => {
  if (!raw) return null;
  if (VALID_SERVICES.includes(raw)) return raw;           // already a valid ENUM
  return DISPLAY_TO_ENUM[raw] ?? "other";                 // map display name or fallback
};

// Helper: convert undefined → null for MySQL
const sanitizeParams = (...params) => params.map(p => (p === undefined ? null : p));

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: "Validation failed", details: errors.array() });
    return true;
  }
  return false;
};

// =============================================================================
// POST /api/public/website-booking
// Called by the Renalease website booking form — no auth required.
// =============================================================================
router.post(
  "/website-booking",
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("phone").notEmpty().withMessage("Phone is required"),
    body("service").optional().isString(),           // CRM ENUM  e.g. "haemodialysis"
    body("requested_service").optional().isString(), // Display   e.g. "Home Haemodialysis"
    body("notes").optional().isString(),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    try {
      const { name, phone, service, requested_service, notes = "" } = req.body;

      // Resolve to valid ENUM — service field from frontend is already the ENUM value,
      // but we also accept display names as a safe fallback.
      const resolvedService = resolveService(service);

      // ── Normalize phone (Indian numbers) ─────────────────────────────────
      let cleanPhone = phone.replace(/\D/g, "");

      if (cleanPhone.length === 10) {
        cleanPhone = "91" + cleanPhone;
      } else if (cleanPhone.startsWith("0") && cleanPhone.length === 11) {
        cleanPhone = "91" + cleanPhone.substring(1);
      }

      if (cleanPhone.length < 12 || cleanPhone.length > 13 || !cleanPhone.startsWith("91")) {
        return res.status(400).json({
          error: "Invalid phone number format",
          message: "Please provide a valid Indian mobile number (10 digits or with +91)",
        });
      }

      console.log(`[Website Booking] Phone: ${cleanPhone} | service ENUM: ${resolvedService} | display: ${requested_service}`);

      // ── Duplicate check — same phone in last 24h ──────────────────────────
      const [recent] = await pool.execute(
        `SELECT id FROM leads
         WHERE phone = ? AND source = 'website'
         AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
        [cleanPhone]
      );

      if (recent.length > 0) {
        return res.status(409).json({
          error: "Duplicate booking",
          message: "A request from this number was received recently.",
        });
      }

      const syntheticEmail = `${cleanPhone}@website.renalease.local`;
      const leadId = uuidv4();

      await pool.execute(
        `INSERT INTO leads (
          id, name, email, phone,
          source, status, priority,
          service, requested_service, notes, whatsapp_number,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?,
          'website', 'qualified-lead', 'high',
          ?, ?, ?, ?,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
        sanitizeParams(
          leadId,
          name.trim(),
          syntheticEmail,
          cleanPhone,
          resolvedService,        // ← resolved ENUM: "haemodialysis" | "hdf" | "peritoneal" | "nursing" | "other"
          requested_service || null, // ← exact display label: "Home Haemodialysis" etc.
          notes.trim() || null,
          cleanPhone
        )
      );

      console.log(`[Website Booking] Lead created: ${leadId} | ${name} (${cleanPhone}) | ${resolvedService}`);

      // ── Send WhatsApp Confirmation ─────────────────────────────────────────
      const templateName = process.env.WHATSAPP_WEBSITE_CONFIRMATION_TEMPLATE?.trim();
      let sent = false;

      if (templateName && templateName.length > 0) {
        try {
          sent = await sendTemplate(
            cleanPhone,
            templateName,
            process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en",
            [
              name.trim().split(" ")[0] || "Customer",
              requested_service || resolvedService || "our services",
            ]
          );
        } catch (templateErr) {
          console.error("[Website Booking] Template send failed:", templateErr);
        }
      }

      // Fallback to plain text if template not configured or failed
      if (!sent) {
        const fallbackMsg =
          `Dear ${name.trim()},\n\n` +
          `We have received your booking request${requested_service ? ` for ${requested_service}` : ""}.\n` +
          `Our RenalEase team will contact you shortly. Thank you!\n\n` +
          `RenalEase - Kidney Care Solutions 🏥`;

        try {
          sent = await sendText(cleanPhone, fallbackMsg);
        } catch (textErr) {
          console.error("[Website Booking] Plain text fallback failed:", textErr);
        }
      }

      if (sent) {
        console.log(`[Website Booking] WhatsApp sent to ${cleanPhone}`);
      } else {
        console.warn(`[Website Booking] WhatsApp delivery failed for ${cleanPhone}`);
      }

      res.status(201).json({
        message: "Booking received successfully. Our team will contact you shortly.",
        leadId,
      });

    } catch (err) {
      console.error("[Website Booking] Error:", err);
      res.status(500).json({ error: "Failed to process booking" });
    }
  }
);

module.exports = router;