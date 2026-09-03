
const { v4: uuidv4 }             = require("uuid");
const PDFDocument                = require("pdfkit");
const express                    = require("express");
const { body, validationResult } = require("express-validator");
const { pool }                   = require("../config/database");
const { authenticateToken }      = require("../middleware/auth");
const { uploadFileToPublicUrl }  = require("../config/fileUploader");

const crypto = require("crypto");

const router = express.Router();

// Mask a phone number for logs, keeping only the last 4 digits.
const maskPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length > 4 ? `***${digits.slice(-4)}` : "(hidden)";
};



const AOC_API_KEY = process.env.AOC_API_KEY;

const AOC_WHATSAPP_URL =
  "https://api.aoc-portal.com/v1/whatsapp";

const AOC_FROM_NUMBER =
  process.env.AOC_FROM_NUMBER || "+919769026133";

// Approved WhatsApp template used to OPEN the conversation before sending the
// invoice PDF (free-form messages only deliver within 24h of the customer's
// last message; approved templates deliver anytime). Override per environment.
const WHATSAPP_TEMPLATE_NAME =
  process.env.WHATSAPP_TEMPLATE_NAME || "invoice";

const WHATSAPP_TEMPLATE_LANG =
  process.env.WHATSAPP_TEMPLATE_LANG || "en";

// When true (default), the invoice PDF is delivered INSIDE the approved
// template's document header — a single compliant message that works even when
// no 24h session window is open. This is the correct WhatsApp cold-send path.
// Set WHATSAPP_TEMPLATE_HAS_DOCUMENT_HEADER=false only if the approved template
// on the AOC/Meta portal has NO document header, in which case we fall back to
// the legacy template-then-separate-document behaviour.
const TEMPLATE_HAS_DOCUMENT_HEADER =
  String(process.env.WHATSAPP_TEMPLATE_HAS_DOCUMENT_HEADER ?? "true")
    .trim()
    .toLowerCase() !== "false";

// Public base URL of THIS backend (origin only, no path), used to build the
// self-hosted PDF link that WhatsApp/Meta fetches. Must be an internet-reachable
// HTTPS origin, e.g. https://crm-api.vasifytech.com. When empty (e.g. local dev,
// where Meta cannot reach localhost) self-hosting is disabled and the send falls
// back to the external uploader.
const PUBLIC_API_BASE_URL = (
  process.env.PUBLIC_API_BASE_URL ||
  process.env.PUBLIC_BASE_URL ||
  (process.env.NODE_ENV === "production" ? "https://crm-api.vasifytech.com" : "")
).replace(/\/+$/, "");

// Secret + TTL for signing the short-lived public PDF link. The link is
// unauthenticated (Meta cannot send a bearer token) but is HMAC-signed and
// time-limited so it cannot be forged or replayed indefinitely.
const PDF_LINK_SECRET =
  process.env.PDF_LINK_SECRET || process.env.JWT_SECRET || "";

// Parse "15m" / "2h" / "3600" (seconds) into milliseconds. Defaults to 15m.
const parseTtlMs = (raw) => {
  const s = String(raw ?? "15m").trim();
  const m = s.match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  const unit = (m[2] || "s").toLowerCase();
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return n * mult;
};

const PDF_LINK_TTL_MS = parseTtlMs(process.env.PDF_LINK_TTL);

// Build the canonical string that gets HMAC-signed for a PDF link.
const pdfLinkSigningString = (invoiceId, expiresAt) => `${invoiceId}.${expiresAt}`;

const signPdfLink = (invoiceId, expiresAt) =>
  crypto
    .createHmac("sha256", PDF_LINK_SECRET)
    .update(pdfLinkSigningString(invoiceId, expiresAt))
    .digest("hex");

// Constant-time compare that never throws on length mismatch.
const safeEqualHex = (a, b) => {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

// Build the full public, Meta-fetchable HTTPS URL for an invoice PDF.
const buildPublicPdfUrl = (invoiceId) => {
  const expiresAt = Date.now() + PDF_LINK_TTL_MS;
  const sig = signPdfLink(invoiceId, expiresAt);
  const qs = new URLSearchParams({ e: String(expiresAt), s: sig }).toString();
  return `${PUBLIC_API_BASE_URL}/api/invoices/${encodeURIComponent(invoiceId)}/public-pdf?${qs}`;
};

// router.post("/:id/send-whatsapp", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;

//     const access = await canAccessInvoice(req, res, id);
//     if (!access.ok) return;

//     const [invRows] = await pool.execute(
//       INV_SELECT + " WHERE i.id = ?",
//       sanitize(id)
//     );

//     if (!invRows.length) {
//       return res.status(404).json({
//         error: true,
//         message: "Invoice not found",
//       });
//     }

//     const inv = invRows[0];

//     // Customer WhatsApp number retrieval & cleaning
//     const rawPhone =
//       inv.customer_phone_override ||
//       inv.customer_phone ||
//       inv.whatsapp_number ||
//       "";

//     let recipient = String(rawPhone).replace(/\D/g, "");
//     if (recipient.length === 10) {
//       recipient = `91${recipient}`;
//     }

//     if (!recipient || recipient.length < 10 || recipient.endsWith("1234567890") || recipient.endsWith("0000000000")) {
//       return res.status(400).json({
//         error: true,
//         message: `Invalid customer phone number (${rawPhone || "empty"}). Please update the customer phone number with a valid WhatsApp mobile number.`,
//       });
//     }

//     // Fetch items & build PDF buffer
//     const [items] = await pool.execute(
//       "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//       sanitize(id)
//     );

//     const pdfBuffer = await generateInvoicePdfBuffer(inv, items, req.body?.logoBase64);

//     const customerName = inv.customer_name_override || inv.customer_name || "Valued Client";
//     const invoiceNumber = inv.invoice_number || inv.id || "N/A";
//     const orderNumber = inv.po_number || null;
//     const pdfOrderOrInvNumber = orderNumber || invoiceNumber;
//     const pdfFilename = `invoice-${pdfOrderOrInvNumber}.pdf`;
//     const totalAmount = Number(inv.total || inv.amount || 0);

//     const formattedTotal = `â‚¹${totalAmount.toFixed(2)}`;

//     const issueDateFormatted = inv.issue_date || inv.created_at
//       ? new Date(inv.issue_date || inv.created_at).toLocaleDateString("en-IN", {
//         day: "2-digit",
//         month: "2-digit",
//         year: "numeric",
//       })
//       : new Date().toLocaleDateString("en-IN", {
//         day: "2-digit",
//         month: "2-digit",
//         year: "numeric",
//       });

//     const messageText = `Hello ${customerName} ðŸ‘‹

// Thank you for choosing Vasify Technologies.

// Your invoice has been generated and is ready for your reference.

// ðŸ“Œ Invoice Number: ${invoiceNumber}
// ${orderNumber ? `ðŸ“¦ Order Number: ${orderNumber}\n` : ""}ðŸ“… Invoice Date: ${issueDateFormatted}
// ðŸ’° Total Amount: ${formattedTotal}

// Please find the invoice attached to this message. Kindly review it, and feel free to reach out if you have any questions or notice any discrepancy.

// Thank you for your continued trust in us.

// Vasify Technologies Support Team`;

//     // Upload PDF buffer to a public HTTPS URL so Meta/WhatsApp Cloud API can download and deliver the file
//     // let mediaUrl = `data:application/pdf;base64,${pdfBuffer.toString("base64")}`;
    
//     let mediaUrl = null;


//     try {
//       const formData = new FormData();
//       formData.append("reqtype", "fileupload");
//       formData.append("fileToUpload", new Blob([pdfBuffer], { type: "application/pdf" }), pdfFilename);
//       const uploadRes = await fetch("https://0x0.st/", { method: "POST", body: formData });
//       const pubUrl = (await uploadRes.text()).trim();
//       if (pubUrl.startsWith("http")) {
//         mediaUrl = pubUrl;
//         console.log(`[WhatsApp Document] Uploaded PDF to public URL: ${pubUrl}`);
//       }
//     } catch (upErr) {
//       console.warn("[WhatsApp Document] Public upload warning:", upErr.message);
//     }

//     const apiKey = process.env.AOC_API_KEY || process.env.WHATSAPP_API_TOKEN || "kliu2IuLezqOxzzIuOXipDYaFnxubQ";
//     const fromNumber = (process.env.AOC_FROM_NUMBER || process.env.WHATSAPP_PHONE_NUMBER_ID || "919769026133").replace(/\+/g, "");

//     // 1. Send Text Message
//     const textPayload = {
//       recipient_type: "individual",
//       from: fromNumber,
//       to: recipient,
//       type: "text",
//       text: { body: messageText },
//     };

//     try {
//       await fetch(AOC_WHATSAPP_URL, {
//         method: "POST",
//         headers: { "Content-Type": "application/json", apikey: apiKey },
//         body: JSON.stringify(textPayload),
//       });
//     } catch (txtErr) {
//       console.warn("[WhatsApp Text] Message send warning:", txtErr.message);
//     }

//     // 2. Send Invoice PDF Document Attachment
//     const docPayload = {
//       recipient_type: "individual",
//       from: fromNumber,
//       to: recipient,
//       type: "document",
//       document: {
//         link: mediaUrl,
//         filename: pdfFilename,
//         caption: `Hi ${customerName}, please find attached your Invoice PDF.`,
//       },
//     };

//     const response = await fetch(AOC_WHATSAPP_URL, {
//       method: "POST",
//       headers: { "Content-Type": "application/json", apikey: apiKey },
//       body: JSON.stringify(docPayload),
//     });

//     const responseText = await response.text();
//     console.log("AOC WhatsApp document status:", response.status, responseText);

//     let parsedRes = {};
//     try { parsedRes = JSON.parse(responseText); } catch (e) { parsedRes = { raw: responseText }; }

//     if (response.ok && (parsedRes.status === "success" || parsedRes.message === "Message Sent Successfully!" || parsedRes.id)) {
//       try {
//       await pool.execute(
//         `UPDATE invoices SET whatsapp_sent = 1, whatsapp_sent_at = NOW(), whatsapp_status = 'delivered' WHERE id = ?`,
//         sanitize(id)
//       );
//       } catch (updateErr) {
//         console.warn("Could not update invoice whatsapp columns:", updateErr.message);
//       }
//       return res.status(200).json({
//         error: false,
//         message: "Invoice and PDF sent successfully via WhatsApp",
//         data: parsedRes,
//       });
//     }

//     return res.status(response.status || 500).json({
//       error: true,
//       message: "AOC WhatsApp API failed",
//       details: responseText,
//     });

//   } catch (error) {
//     console.error("Send invoice WhatsApp error:", error);
//     return res.status(500).json({
//       error: true,
//       message: "Failed to send WhatsApp message",
//       details: error.message,
//     });
//   }
// });
router.post("/:id/send-whatsapp", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // ------------------------------------------------------------
    // 1. CHECK ACCESS
    // ------------------------------------------------------------
    const access = await canAccessInvoice(req, res, id);
    if (!access.ok) return;

    // ------------------------------------------------------------
    // 2. GET INVOICE
    // ------------------------------------------------------------
    const [invRows] = await pool.execute(
      INV_SELECT + " WHERE i.id = ?",
      sanitize(id)
    );

    if (!invRows.length) {
      return res.status(404).json({
        error: true,
        message: "Invoice not found",
      });
    }

    const inv = invRows[0];

    // ------------------------------------------------------------
    // 3. GET CUSTOMER WHATSAPP NUMBER
    // ------------------------------------------------------------
    const rawPhone =
      inv.customer_phone_override ||
      inv.customer_phone ||
      inv.whatsapp_number ||
      "";

    let recipient = String(rawPhone).replace(/\D/g, "");

    // Indian 10 digit number
    if (recipient.length === 10) {
      recipient = `91${recipient}`;
    }

    if (
      !recipient ||
      recipient.length < 10 ||
      recipient.endsWith("1234567890") ||
      recipient.endsWith("0000000000")
    ) {
      return res.status(400).json({
        error: true,
        message: `Invalid customer phone number (${rawPhone || "empty"}). Please update the customer phone number with a valid WhatsApp mobile number.`,
      });
    }

    // ------------------------------------------------------------
    // 4. GET INVOICE ITEMS
    // ------------------------------------------------------------
    const [items] = await pool.execute(
      "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
      sanitize(id)
    );

    // ------------------------------------------------------------
    // 5. GENERATE PDF
    // ------------------------------------------------------------
    const pdfBuffer = await generateInvoicePdfBuffer(
      inv,
      items,
      req.body?.logoBase64
    );

    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
      return res.status(500).json({
        error: true,
        message: "Failed to generate invoice PDF",
      });
    }

    // ------------------------------------------------------------
    // 6. INVOICE INFORMATION
    // ------------------------------------------------------------
    const customerName =
      inv.customer_name_override ||
      inv.customer_name ||
      "Valued Client";

    const invoiceNumber =
      inv.invoice_number ||
      inv.id ||
      "N/A";

    const orderNumber =
      inv.po_number ||
      null;

    const pdfOrderOrInvNumber =
      orderNumber ||
      invoiceNumber;

    const pdfFilename =
      `invoice-${pdfOrderOrInvNumber}.pdf`;

    const totalAmount =
      Number(inv.total || inv.amount || 0);

    const formattedTotal =
      totalAmount.toFixed(2);

    const issueDateFormatted =
      inv.issue_date || inv.created_at
        ? new Date(
            inv.issue_date || inv.created_at
          ).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        : new Date().toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });

    // ------------------------------------------------------------
    // 7. WHATSAPP TEXT MESSAGE
    // ------------------------------------------------------------
    const messageText = `Hello ${customerName} 👋

Thank you for choosing Vasify Technologies.

Your invoice has been generated and is ready for your reference.

📌 Invoice Number: ${invoiceNumber}
${orderNumber ? `📦 Order Number: ${orderNumber}\n` : ""}📅 Invoice Date: ${issueDateFormatted}
💰 Total Amount: ₹${formattedTotal}

Please find the invoice attached to this message. Kindly review it, and feel free to reach out if you have any questions or notice any discrepancy.

Thank you for your continued trust in us.

Vasify Technologies Support Team`;

    // ------------------------------------------------------------
    // 8. RESOLVE A META-FETCHABLE PDF URL
    // ------------------------------------------------------------
    //
    // The PDF is delivered inside the template's document header, so Meta must
    // be able to download it over HTTPS. Preference order:
    //   1. Self-hosted signed link (reliable; served by GET /:id/public-pdf).
    //   2. External uploader (catbox) as a fallback — used when the signing
    //      secret is unset or the self-hosted base is not internet-reachable
    //      (e.g. local dev, where Meta cannot reach localhost).
    //
    // catbox intermittently fails Meta's fetch with error 131053
    // ("no media found from weblink"), so self-hosting is strongly preferred.
    // ------------------------------------------------------------

    let mediaUrl = null;
    let mediaSource = null;

    if (PDF_LINK_SECRET && /^https:\/\//i.test(PUBLIC_API_BASE_URL)) {
      mediaUrl = buildPublicPdfUrl(id);
      mediaSource = "self-hosted";
      console.log("[WhatsApp Document] Using self-hosted signed PDF URL.");
    } else {
      try {
        const uploadResult = await uploadFileToPublicUrl(
          pdfBuffer,
          pdfFilename,
          "application/pdf"
        );
        mediaUrl = uploadResult.url;
        mediaSource = "external";
        console.log("[WhatsApp Document] Uploaded invoice PDF to public URL:", mediaUrl);
      } catch (uploadError) {
        console.error("[WhatsApp Document] PDF upload failed:", uploadError.message);
      }
    }

    // ------------------------------------------------------------
    // 9. MAKE SURE WE HAVE A VALID HTTPS URL
    // ------------------------------------------------------------

    if (!mediaUrl || !/^https:\/\//i.test(mediaUrl)) {
      return res.status(500).json({
        error: true,
        message:
          "Invoice PDF could not be published to a public HTTPS URL. WhatsApp message was not sent.",
      });
    }

    // ------------------------------------------------------------
    // 10. AOC API CONFIG
    // ------------------------------------------------------------

    const apiKey =
      process.env.AOC_API_KEY ||
      process.env.WHATSAPP_API_TOKEN;

    if (!apiKey) {
      console.error(
        "[WhatsApp] AOC API key is missing"
      );

      return res.status(500).json({
        error: true,
        message:
          "AOC WhatsApp API key is not configured on the server.",
      });
    }

    // Single WhatsApp sender for the whole app: AOC_FROM_NUMBER (919769026133).
    // The WHATSAPP_PHONE_NUMBER_ID fallback was removed — it pointed at a
    // different, unregistered number (918955464054) and produced inconsistent
    // senders between code paths.
    const fromNumber = (
      process.env.AOC_FROM_NUMBER ||
      "+919769026133"
    ).replace(/\+/g, "");

    if (!fromNumber) {
      return res.status(500).json({
        error: true,
        message:
          "AOC WhatsApp sender number is not configured.",
      });
    }

    // ------------------------------------------------------------
    // 11. OPEN THE CONVERSATION (template first, text as fallback)
    // ------------------------------------------------------------
    //
    // WhatsApp only delivers free-form ("session") messages within 24h of the
    // customer's last message. An approved TEMPLATE can be delivered anytime and
    // opens the 24h window so the PDF document that follows is delivered too.
    //
    // Strategy:
    //   1. Send the approved template (invoice_ready_notification).
    //   2. If AOC rejects it (e.g. the template's placeholder count differs from
    //      what we send), fall back to the free-form text — which still delivers
    //      inside an open 24h session window.
    //   3. Either way, continue to the PDF document (section 13). The opening
    //      message is best-effort; the PDF send determines overall success.
    // ------------------------------------------------------------

    // Body placeholders, sent in this order. These MUST match the {{1}}, {{2}}…
    // defined in the approved "invoice_ready_notification" template on the AOC
    // portal. The default order (name, invoice #, date, total) matches the
    // 4-parameter payload the AOC template probes in scratch/ were built against.
    // Override the order/values via WHATSAPP_TEMPLATE_PARAMS (pipe-separated),
    // or set it to an empty string if the template has no body placeholders.
    // Supported tokens: {{name}} {{invoice}} {{order}} {{date}} {{total}}.
    const serviceName = (items && items.length > 0 && items[0].description)
      ? items[0].description
      : "Services";

    const templateTokens = {
      "{{name}}": customerName,
      "{{service}}": serviceName,
      "{{invoice}}": invoiceNumber,
      "{{order}}": orderNumber || "",
      "{{date}}": issueDateFormatted,
      "{{total}}": formattedTotal,
    };

    const defaultParamsForTemplate =
      WHATSAPP_TEMPLATE_NAME === "invoice"
        ? [customerName, serviceName, invoiceNumber, formattedTotal]
        : [customerName, invoiceNumber, issueDateFormatted, formattedTotal];

    const templateParams =
      process.env.WHATSAPP_TEMPLATE_PARAMS !== undefined
        ? process.env.WHATSAPP_TEMPLATE_PARAMS
            .split("|")
            .map((raw) => {
              const key = raw.trim();
              return Object.prototype.hasOwnProperty.call(templateTokens, key)
                ? String(templateTokens[key])
                : key;
            })
            .filter((v) => v.length > 0)
        : defaultParamsForTemplate;

    // AOC portal template format (top-level templateName + language + components),
    // matching scratch/probe_aoc_header_components.js. This differs from the Meta
    // Cloud API's nested `template` object; the AOC gateway expects this flattened
    // shape.
    //
    // The invoice PDF rides in the template's DOCUMENT HEADER — this is the ONLY
    // compliant way to deliver a document to a customer OUTSIDE the 24h session
    // window (a business-initiated template does NOT open that window, so a
    // trailing free-form document is rejected with error 131047).
    //
    // REQUIREMENT: the "invoice_ready_notification" template must be approved on
    // the AOC/Meta portal WITH a document header. If it is body-only, set
    // WHATSAPP_TEMPLATE_HAS_DOCUMENT_HEADER=false (the PDF is then sent as a
    // separate document, which only delivers inside an open 24h window).
    const templateComponents = {};

    if (templateParams.length) {
      templateComponents.body = {
        params: templateParams.map((text) => String(text)),
      };
    }

    if (TEMPLATE_HAS_DOCUMENT_HEADER) {
      templateComponents.header = {
        type: "document",
        document: {
          link: mediaUrl,
          filename: pdfFilename,
        },
      };
    }

    const templatePayload = {
      recipient_type: "individual",
      from: fromNumber.startsWith("+") ? fromNumber : `+${fromNumber}`,
      to: recipient.startsWith("+") ? recipient : `+${recipient}`,
      type: "template",
      templateName: WHATSAPP_TEMPLATE_NAME,
      campaignName: "invoice-send",
      ...(Object.keys(templateComponents).length ? { components: templateComponents } : {}),
    };

    // Diagnostics captured from AOC so we can surface WHY a send failed. Returned
    // only when NODE_ENV !== production. from is masked; no keys are included.
    const aocDebug = {
      from: maskPhone(fromNumber),
      mediaSource,
      template: null,
      text: null,
      document: null,
    };

    // POST a payload to the AOC gateway and normalize the response.
    const postAoc = async (payload) => {
      const resp = await fetch(AOC_WHATSAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify(payload),
      });
      const bodyText = await resp.text();
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = { raw: bodyText };
      }
      return { ok: resp.ok, status: resp.status, bodyText, parsed };
    };

    // Mark the invoice as sent. Never throws — a failed status write must not
    // fail the request, because the WhatsApp message was already delivered.
    const markSent = async (statusValue) => {
      try {
        await pool.execute(
          `UPDATE invoices
             SET whatsapp_sent = 1, whatsapp_sent_at = NOW(), whatsapp_status = ?
           WHERE id = ?`,
          sanitize(statusValue, id)
        );
      } catch (updateErr) {
        console.warn("WhatsApp database status update failed:", updateErr.message);
      }
    };

    // ============================================================
    // 12. SEND
    // ============================================================
    //
    // Preferred path (TEMPLATE_HAS_DOCUMENT_HEADER): a SINGLE approved template
    // whose document header carries the invoice PDF. This is the only compliant
    // cold-send — it delivers the message text and the PDF in one shot, with no
    // dependency on an open 24h session window.
    //
    // Legacy path: template/text opens the window, then the PDF is sent as a
    // separate free-form document (only delivers inside an open window).
    // ------------------------------------------------------------

    if (TEMPLATE_HAS_DOCUMENT_HEADER) {
      let tpl;
      try {
        tpl = await postAoc(templatePayload);
      } catch (err) {
        aocDebug.template = { status: 0, error: err.message };
        console.error("[WhatsApp Template+PDF] Send error:", err.message);
        return res.status(502).json({
          error: true,
          message: "Failed to reach the WhatsApp gateway while sending the invoice.",
          ...(process.env.NODE_ENV !== "production" ? { aoc: aocDebug } : {}),
        });
      }

      aocDebug.template = { status: tpl.status, body: tpl.bodyText.slice(0, 500) };
      console.log(`[WhatsApp Template+PDF] "${WHATSAPP_TEMPLATE_NAME}" status:`, tpl.status);

      if (!tpl.ok) {
        console.error("[WhatsApp Template+PDF] Rejected by AOC:", tpl.bodyText);
        return res.status(tpl.status || 502).json({
          error: true,
          message:
            "WhatsApp rejected the invoice template. Confirm the approved template name, language, " +
            "body placeholder count, and that it has a document header (see the WHATSAPP_TEMPLATE_* env vars).",
          details: tpl.bodyText,
          ...(process.env.NODE_ENV !== "production" ? { aoc: aocDebug } : {}),
        });
      }

      // Also send standalone document attachment so the customer receives the downloadable PDF file in chat
      try {
        const docPayload = {
          recipient_type: "individual",
          from: fromNumber.startsWith("+") ? fromNumber : `+${fromNumber}`,
          to: recipient.startsWith("+") ? recipient : `+${recipient}`,
          type: "document",
          document: {
            link: mediaUrl,
            filename: pdfFilename,
            caption: `📄 Invoice ${invoiceNumber} - Vasify Technologies (Total: ${formattedTotal})`,
          },
        };
        await postAoc(docPayload);
      } catch (docErr) {
        console.warn("[WhatsApp Document] Standalone document send warning:", docErr.message);
      }

      await markSent("sent");

      return res.status(200).json({
        error: false,
        message: "Invoice message and PDF sent successfully via WhatsApp.",
        data: tpl.parsed,
        whatsapp: {
          recipient,
          via: "template+document-header",
          pdfSent: true,
          mediaSource,
          filename: pdfFilename,
          status: "sent",
        },
      });
    }

    // ---------- Legacy path: open the window, then send a separate document ----------

    let openingSent = false;
    let openingVia = null;

    try {
      const tpl = await postAoc(templatePayload);
      aocDebug.template = { status: tpl.status, body: tpl.bodyText.slice(0, 500) };
      console.log(`[WhatsApp Template] "${WHATSAPP_TEMPLATE_NAME}" status:`, tpl.status);
      if (tpl.ok) {
        openingSent = true;
        openingVia = "template";
      } else {
        console.warn("[WhatsApp Template] Rejected — falling back to free-form text:", tpl.bodyText);
      }
    } catch (err) {
      aocDebug.template = { status: 0, error: err.message };
      console.warn("[WhatsApp Template] Send error — falling back to free-form text:", err.message);
    }

    // Fallback: free-form text (only delivers inside an open 24h session window)
    if (!openingSent) {
      const textPayload = {
        recipient_type: "individual",
        from: fromNumber,
        to: recipient,
        type: "text",
        text: { body: messageText },
      };
      try {
        const txt = await postAoc(textPayload);
        aocDebug.text = { status: txt.status, body: txt.bodyText.slice(0, 500) };
        console.log("[WhatsApp Text] Fallback status:", txt.status);
        if (txt.ok) {
          openingSent = true;
          openingVia = "text";
        } else {
          console.warn("[WhatsApp Text] Fallback failed:", txt.bodyText);
        }
      } catch (err) {
        aocDebug.text = { status: 0, error: err.message };
        console.warn("[WhatsApp Text] Fallback send error:", err.message);
      }
    }

    if (!openingSent) {
      console.error(
        "[WhatsApp] Could not open the conversation (template + text both failed).",
        JSON.stringify(aocDebug)
      );
      return res.status(502).json({
        error: true,
        message:
          "WhatsApp could not open the conversation. The approved template was rejected and no active 24h session window exists, so the invoice was not sent.",
        ...(process.env.NODE_ENV !== "production" ? { aoc: aocDebug } : {}),
      });
    }

    const maskedFrom =
      fromNumber && fromNumber.length > 4 ? "***" + fromNumber.slice(-4) : fromNumber || "(empty)";
    console.log("[WhatsApp Document] fromNumber (masked):", maskedFrom);

    const docPayload = {
      recipient_type: "individual",
      from: fromNumber,
      to: recipient,
      type: "document",
      document: { link: mediaUrl, filename: pdfFilename },
    };

    console.log("[WhatsApp Document] Sending PDF:", {
      recipient: maskPhone(recipient),
      filename: pdfFilename,
      mediaUrl,
    });

    let doc;
    try {
      doc = await postAoc(docPayload);
    } catch (documentError) {
      console.error("[WhatsApp Document] Send failed:", documentError.message);
      return res.status(500).json({
        error: true,
        message: "WhatsApp conversation was opened, but the invoice PDF failed to send.",
        details: documentError.message,
      });
    }

    aocDebug.document = { status: doc.status, body: doc.bodyText.slice(0, 500) };
    console.log("[WhatsApp Document] Status:", doc.status, "Response:", doc.bodyText);

    if (!doc.ok) {
      return res.status(doc.status || 500).json({
        error: true,
        message: "WhatsApp conversation was opened, but the invoice PDF failed to send.",
        details: doc.bodyText,
        pdfUrl: mediaUrl,
        ...(process.env.NODE_ENV !== "production" ? { aoc: aocDebug } : {}),
      });
    }

    await markSent("sent");

    return res.status(200).json({
      error: false,
      message: "Invoice message and PDF sent successfully via WhatsApp.",
      data: doc.parsed,
      whatsapp: {
        recipient,
        via: openingVia,
        openingSent: true,
        pdfSent: true,
        mediaSource,
        filename: pdfFilename,
        status: "sent",
      },
    });

  } catch (error) {
    console.error(
      "Send invoice WhatsApp error:",
      error
    );

    return res.status(500).json({
      error: true,
      message:
        "Failed to send WhatsApp message.",
      details: error.message,
    });
  }
});


const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

const KNOWN_INVOICE_COLUMNS = {
  gst_amount:                "DECIMAL(15,2) DEFAULT 0",
  po_number:                 "VARCHAR(100) NULL",
  terms:                     "VARCHAR(100) NULL",
  place_of_supply:           "VARCHAR(100) NULL",
  customer_name_override:    "VARCHAR(255) NULL",
  customer_email_override:   "VARCHAR(255) NULL",
  customer_phone_override:   "VARCHAR(50) NULL",
  customer_company_override: "VARCHAR(255) NULL",
  customer_address_override: "TEXT NULL",
  is_recurring:              "TINYINT(1) DEFAULT 0",
  recurring_frequency:       "VARCHAR(50) NULL",
  recurring_cycles:          "INT NULL",
  recurring_start_date:      "DATE NULL",
  recurring_end_date:        "DATE NULL",
  created_by:                "VARCHAR(36) NULL",
};

const KNOWN_INVOICE_ITEM_COLUMNS = {
  hsn:       "VARCHAR(50) DEFAULT '998313'",
  breakdown: "JSON NULL",
};

async function ensureInvoiceColumns(conn, err) {
  if (err && (err.code === "ER_BAD_FIELD_ERROR" || err.message?.includes("Unknown column"))) {
    for (const [col, colDef] of Object.entries(KNOWN_INVOICE_COLUMNS)) {
      try {
        await conn.query(`ALTER TABLE \`invoices\` ADD COLUMN \`${col}\` ${colDef}`);
      } catch (_) {}
    }
    for (const [col, colDef] of Object.entries(KNOWN_INVOICE_ITEM_COLUMNS)) {
      try {
        await conn.query(`ALTER TABLE \`invoice_items\` ADD COLUMN \`${col}\` ${colDef}`);
      } catch (_) {}
    }
    return true;
  }
  return false;
}

const toSqlDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: "Validation failed", details: errors.array() });
    return true;
  }
  return false;
};

// ─── Generate invoice number: INV-YYYYMM-XXXX (Strictly Serialwise)
// If the frontend sends its own number AND it's not a duplicate, honour it.
const generateInvNumber = async (conn) => {
  const now    = new Date();
  const ym     = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `INV-${ym}-`;

  const [rows] = await conn.execute(
    `SELECT invoice_number FROM invoices WHERE invoice_number LIKE ?`,
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
};

// camelCase → snake_case map for UPDATE (only fields that exist after migration)
const FIELD_MAP = {
  customerId:              "customer_id",
  amount:                  "amount",
  tax:                     "tax",
  gstAmount:               "gst_amount",
  total:                   "total",
  status:                  "status",
  issueDate:               "issue_date",
  dueDate:                 "due_date",
  paidDate:                "paid_date",
  notes:                   "notes",
  poNumber:                "po_number",
  terms:                   "terms",
  placeOfSupply:           "place_of_supply",
  customerName:            "customer_name_override",
  customerEmail:           "customer_email_override",
  customerPhone:           "customer_phone_override",
  customerCompany:         "customer_company_override",
  customerAddress:         "customer_address_override",
  isRecurring:             "is_recurring",
  recurringFrequency:      "recurring_frequency",
  recurringCycles:         "recurring_cycles",
  recurringStartDate:      "recurring_start_date",
  recurringEndDate:        "recurring_end_date",
};

// â”€â”€â”€ ACCESS CONTROL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const canAccessInvoice = async (req, res, invoiceId) => {
  if (req.user.role === "admin") return { ok: true };
  const [rows] = await pool.execute(
    `SELECT i.id FROM invoices i
     INNER JOIN customers c ON i.customer_id = c.id
     WHERE i.id = ? AND c.assigned_to = ?`,
    sanitize(invoiceId, req.user.id)
  );
  if (!rows.length)
    return { ok: false, response: res.status(403).json({ error: "Access denied" }) };
  return { ok: true };
};

// â”€â”€â”€ AMOUNT IN WORDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function amountInWords(amount) {
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
                 "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen",
                 "Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  function convert(n) {
    if (!n) return "";
    if (n < 20)       return ones[n] + " ";
    if (n < 100)      return tens[Math.floor(n / 10)] + " " + ones[n % 10] + " ";
    if (n < 1000)     return ones[Math.floor(n / 100)] + " Hundred " + convert(n % 100);
    if (n < 100000)   return convert(Math.floor(n / 1000))    + "Thousand " + convert(n % 1000);
    if (n < 10000000) return convert(Math.floor(n / 100000))  + "Lakh "     + convert(n % 100000);
    return               convert(Math.floor(n / 10000000)) + "Crore "    + convert(n % 10000000);
  }
  const rupees = Math.floor(amount);
  const paise  = Math.round((amount - rupees) * 100);
  let out = "Indian Rupee " + (convert(rupees).trim() || "Zero");
  if (paise) out += " and " + convert(paise).trim() + " Paise";
  return out + " Only";
}

// â”€â”€â”€ SELECT HELPER â€” always use COALESCE override â†’ live customer data â”€â”€â”€â”€â”€â”€â”€â”€â”€

const INV_SELECT = `
  SELECT
    i.*,
    COALESCE(i.customer_name_override,    c.name)    AS customer_name,
    COALESCE(i.customer_company_override, c.company) AS customer_company,
    COALESCE(i.customer_email_override,   c.email)   AS customer_email,
    COALESCE(i.customer_phone_override,   c.phone)   AS customer_phone,
    COALESCE(
      NULLIF(i.customer_address_override, ''),
      -- Build address from parts; skip country if it already appears in address
      CONCAT_WS(', ',
        NULLIF(c.address,''),
        NULLIF(c.city,''),
        NULLIF(c.state,''),
        NULLIF(c.zip_code,''),
        -- Only append country if not already in address field
        CASE WHEN c.address IS NOT NULL AND LOWER(c.address) LIKE CONCAT('%', LOWER(IFNULL(c.country,'')), '%')
             THEN NULL ELSE NULLIF(c.country,'') END
      ))                                              AS customer_address
  FROM invoices i
  LEFT JOIN customers c ON i.customer_id = c.id
`;

async function generateInvoicePdfBuffer(inv, items, logoB64 = null) {
  return new Promise((resolve, reject) => {
    try {
      let subtotal;
      if (items && items.length > 0) {
        subtotal = items.reduce((s, it) => s + Number(it.amount || 0), 0);
      } else {
        subtotal = Number(inv.amount || 0);
      }

      const gstRate = Number(inv.tax || 18);
      const halfRate = gstRate / 2;
      const cgstAmt = (subtotal * halfRate) / 100;
      const sgstAmt = cgstAmt;
      const totalAmt = subtotal + cgstAmt + sgstAmt;
      const invStatus = String(inv.status || "").trim().toLowerCase();
      const balDue = invStatus === "paid" ? 0 : totalAmt;

      const fs = require("fs");
      const path = require("path");
      const fontsDir = path.join(__dirname, "../assets/fonts");
      const fontRegular = path.join(fontsDir, "Arial.ttf");
      const fontBold = path.join(fontsDir, "Arial-Bold.ttf");
      const fontItalic = path.join(fontsDir, "Arial-Italic.ttf");

      let F_REG = "Helvetica";
      let F_BOLD = "Helvetica-Bold";
      let F_ITAL = "Helvetica-Oblique";

      const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true, bufferPages: true });

      if (fs.existsSync(fontRegular)) {
        doc.registerFont("AppRegular", fontRegular);
        F_REG = "AppRegular";
      }
      if (fs.existsSync(fontBold)) {
        doc.registerFont("AppBold", fontBold);
        F_BOLD = "AppBold";
      }
      if (fs.existsSync(fontItalic)) {
        doc.registerFont("AppItalic", fontItalic);
        F_ITAL = "AppItalic";
      }

      const termsLabel = {
        net_7: "Net 7", net_15: "Net 15", net_30: "Net 30",
        net_45: "Net 45", net_60: "Net 60",
      }[inv.terms] || "Due on Receipt";

      const fmtD = (v) => {
        if (!v) return "-";
        const d = new Date(v);
        return isNaN(d.getTime()) ? "-"
          : d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
      };
      const fmtN = (n) => Number(n || 0).toFixed(2);

      const buffers = [];
      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      const DARK = "#1A1A1A", GRAY = "#555555", LGRAY = "#888888";
      const BORD = "#CCCCCC", BGH = "#F5F5F5", BGALT = "#FAFAFA";
      const BGTOT = "#EEEEEE", BGBAL = "#E8F5E9";

      const PW = 595.28, PH = 841.89, ML = 30, MR = 30, CW = PW - ML - MR;
      const MAX_Y = PH - 50;
      let y = 30;

      const defaultLogoPath = path.join(__dirname, "../assets/vasify_logo.png");
      if (logoB64) {
        try {
          const raw = logoB64.includes(",") ? logoB64.split(",")[1] : logoB64;
          doc.image(Buffer.from(raw, "base64"), ML, y, { fit: [120, 50] });
        } catch (e) { console.warn("Logo render:", e.message); }
      } else if (fs.existsSync(defaultLogoPath)) {
        try {
          doc.image(defaultLogoPath, ML, y, { fit: [120, 50] });
        } catch (e) { console.warn("Default logo render:", e.message); }
      }

      const CX = ML + 130;
      doc.fontSize(11).font(F_BOLD).fillColor(DARK)
        .text("Vasify Technologies Pvt. Ltd.", CX, y, { width: CW - 130 });
      y += 14;
      doc.fontSize(7.5).font(F_REG).fillColor(GRAY)
        .text("Axiom Milan CHS, 607, 22 Datta Mandir road\nDhanakurwadi, Kandivali West.\nMumbai Maharashtra 400067\nIndia",
          CX, y, { width: CW - 130, lineGap: 1 });
      y += 42;
      ["Company ID : U62011MH2024PTC421417", "GSTIN: 27AAKCV0353N1ZW", "PAN: AAKCV0353N",
        "Tax ID ::MUMV33878F", "www.vasifytech.com"].forEach(l => {
          doc.fontSize(7.5).font(F_REG).fillColor(GRAY).text(l, CX, y, { width: CW - 120 });
          y += 10;
        });

      doc.fontSize(26).font(F_BOLD).fillColor(DARK)
        .text("INVOICE", PW - MR - 180, 30, { align: "right", width: 180 });

      y = Math.max(y, 122) + 4;

      const MBH = 68, HW = CW / 2;
      doc.rect(ML, y, CW, MBH).stroke(BORD);
      doc.moveTo(ML + HW, y).lineTo(ML + HW, y + MBH).stroke(BORD);
      doc.moveTo(ML, y + 14).lineTo(ML + CW, y + 14).stroke(BORD);

      const LR = [
        ["#", inv.invoice_number || "-"],
        ["Invoice Date", fmtD(inv.issue_date || inv.created_at)],
        ["Terms", termsLabel],
        ["Due Date", fmtD(inv.due_date)],
        ["P.O.#", inv.po_number || "-"],
      ];
      LR.forEach(([lbl, val], i) => {
        const ry = y + 16 + i * 10;
        doc.fontSize(6.5).font(F_BOLD).fillColor(GRAY).text(`${lbl} :`, ML + 4, ry, { width: HW * 0.42 });
        doc.fontSize(6.5).font(F_REG).fillColor(DARK).text(val, ML + HW * 0.44, ry, { width: HW * 0.54, lineBreak: false });
      });

      doc.fontSize(6.5).font(F_BOLD).fillColor(GRAY)
        .text("Place Of Supply", ML + HW + 4, y + 4, { width: 70 });
      doc.fontSize(6.5).font(F_BOLD).fillColor(DARK)
        .text(`: ${inv.place_of_supply || "Maharashtra (27)"}`, ML + HW + 76, y + 4, { width: HW - 80 });

      const RR = [
        ["Payment Status", String(inv.status || "unpaid").toUpperCase()],
        ["Tax Rate", `${gstRate}%`],
      ];
      RR.forEach(([lbl, val], i) => {
        const ry = y + 16 + i * 11;
        doc.fontSize(6.5).font(F_BOLD).fillColor(GRAY).text(`${lbl} :`, ML + HW + 4, ry, { width: 70 });
        doc.fontSize(6.5).font(F_REG).fillColor(DARK).text(val, ML + HW + 76, ry, { width: HW - 80, lineBreak: false });
      });

      y += MBH + 6;

      const AW = HW - 3, SX = ML + HW + 3;

      const rawAddr = inv.customer_address ? String(inv.customer_address).split("\n") : [];
      const addrItems = [
        inv.customer_company ? inv.customer_company : null,
        ...rawAddr,
        inv.customer_email ? `Email: ${inv.customer_email}` : null,
        inv.customer_phone ? `Phone: ${inv.customer_phone}` : null,
      ].filter(Boolean);

      doc.fontSize(9.5).font(F_BOLD);
      let calcAH = 18 + doc.heightOfString(inv.customer_name || "-", { width: AW - 12 }) + 4;
      doc.fontSize(7.5).font(F_REG);
      addrItems.forEach(l => {
        calcAH += doc.heightOfString(l, { width: AW - 12 }) + 3;
      });
      calcAH += 6;

      const AH = Math.max(90, calcAH);

      const drawAddrBox = (ox, title) => {
        doc.rect(ox, y, AW, AH).stroke(BORD);
        doc.fontSize(7.5).font(F_BOLD).fillColor(GRAY)
          .text(title, ox + 6, y + 5, { width: AW - 12, lineBreak: false });
        doc.moveTo(ox, y + 14).lineTo(ox + AW, y + 14).stroke(BORD);

        let ay = y + 18;
        doc.fontSize(9.5).font(F_BOLD).fillColor(DARK)
          .text(inv.customer_name || "-", ox + 6, ay, { width: AW - 12 });
        ay += doc.heightOfString(inv.customer_name || "-", { width: AW - 12 }) + 4;

        addrItems.forEach(l => {
          doc.fontSize(7.5).font(F_REG).fillColor(GRAY)
            .text(l, ox + 6, ay, { width: AW - 12 });
          ay += doc.heightOfString(l, { width: AW - 12 }) + 3;
        });
      };
      drawAddrBox(ML, "Bill To");
      drawAddrBox(SX, "Ship To");
      y += AH + 6;

      const subject = inv.po_number || null;
      if (subject) {
        doc.fontSize(7.5).font(F_REG);
        const subjH = doc.heightOfString(subject, { width: CW - 64 });
        const boxH = Math.max(22, subjH + 10);
        doc.rect(ML, y, CW, boxH).stroke(BORD);
        doc.fontSize(7.5).font(F_BOLD).fillColor(GRAY).text("Subject :", ML + 6, y + 7);
        doc.fontSize(7.5).font(F_REG).fillColor(DARK)
          .text(subject, ML + 58, y + 7, { width: CW - 64 });
        y += boxH + 6;
      }

      const CWS = { sr: 22, desc: 143, hsn: 42, qty: 28, rate: 55, cp: 25, ca: 45, sp: 25, sa: 45, amt: 0 };
      CWS.amt = CW - CWS.sr - CWS.desc - CWS.hsn - CWS.qty - CWS.rate - CWS.cp - CWS.ca - CWS.sp - CWS.sa;

      const CXS = {};
      let ax = ML;
      for (const [k, w] of Object.entries(CWS)) { CXS[k] = ax; ax += w; }

      const vLines = (fy, ty) =>
        Object.values(CXS).slice(1).forEach(x => doc.moveTo(x, fy).lineTo(x, ty).stroke(BORD));

      const renderTableHeader = (currentY) => {
        const HDR_H = 28;
        doc.rect(ML, currentY, CW, HDR_H).fill(BGH).stroke(BORD);
        vLines(currentY, currentY + HDR_H);

        const cgstSpan = CWS.cp + CWS.ca, sgstSpan = CWS.sp + CWS.sa;
        doc.fontSize(6.5).font(F_BOLD).fillColor(DARK)
          .text("CGST", CXS.cp, currentY + 3, { width: cgstSpan, align: "center" });
        doc.fontSize(6.5).font(F_BOLD).fillColor(DARK)
          .text("SGST", CXS.sp, currentY + 3, { width: sgstSpan, align: "center" });
        doc.moveTo(CXS.cp, currentY + 13).lineTo(CXS.sp + sgstSpan, currentY + 13).stroke(BORD);

        const HL = currentY + 15;
        doc.fontSize(6).font(F_BOLD).fillColor(DARK);
        doc.text("#", CXS.sr, HL, { width: CWS.sr, align: "center" });
        doc.text("Item & Description", CXS.desc + 3, HL, { width: CWS.desc - 6, align: "left" });
        doc.text("HSN\n/SAC", CXS.hsn, HL, { width: CWS.hsn, align: "center" });
        doc.text("Qty", CXS.qty, HL, { width: CWS.qty, align: "center" });
        doc.text("Rate", CXS.rate, HL, { width: CWS.rate - 3, align: "right" });
        doc.text("%", CXS.cp, HL, { width: CWS.cp, align: "center" });
        doc.text("Amt", CXS.ca, HL, { width: CWS.ca - 3, align: "right" });
        doc.text("%", CXS.sp, HL, { width: CWS.sp, align: "center" });
        doc.text("Amt", CXS.sa, HL, { width: CWS.sa - 3, align: "right" });
        doc.text("Amount", CXS.amt, HL, { width: CWS.amt - 3, align: "right" });

        return currentY + HDR_H;
      };

      y = renderTableHeader(y);

      const fmtRate = (r) => Number.isInteger(r) ? String(r) : r.toFixed(1).replace(/\.0$/, "");
      const rateLabel = fmtRate(halfRate);

      const tableRows = items && items.length
        ? items
        : [{ description: "Service Charges", quantity: 1, rate: subtotal, amount: subtotal, hsn: "" }];

      tableRows.forEach((item, idx) => {
        const ra = Number(item.amount || 0);
        const rq = Number(item.quantity || 1);
        const rawRate = Number(item.rate) || 0;
        const derivedRate = rq > 0 ? ra / rq : ra;
        const rateMatchesAmount = Math.abs(rawRate * rq - ra) < Math.max(ra * 0.01, 0.01);
        const rr = (rawRate > 0 && rateMatchesAmount) ? rawRate : derivedRate;
        const rc = (ra * halfRate) / 100;

        const itemDesc = String(item.description || "Service");
        doc.fontSize(7).font(F_REG);
        const descH = doc.heightOfString(itemDesc, { width: CWS.desc - 6 });
        const hsnText = String(item.hsn || "998313");
        const hsnH = doc.heightOfString(hsnText, { width: CWS.hsn });
        const RH = Math.max(22, descH + 10, hsnH + 10);

        if (y + RH > MAX_Y) {
          doc.addPage();
          y = 30;
          y = renderTableHeader(y);
        }

        if (idx % 2 === 1) doc.rect(ML, y, CW, RH).fill(BGALT);
        doc.rect(ML, y, CW, RH).stroke(BORD);
        vLines(y, y + RH);

        const cy = y + 6;
        doc.fillColor(DARK).fontSize(7).font(F_REG);
        doc.text(String(idx + 1), CXS.sr, cy, { width: CWS.sr, align: "center" });
        doc.text(itemDesc, CXS.desc + 3, cy, { width: CWS.desc - 6 });
        doc.text(hsnText, CXS.hsn, cy, { width: CWS.hsn, align: "center" });
        doc.text(String(rq), CXS.qty, cy, { width: CWS.qty, align: "center" });
        doc.text(fmtN(rr), CXS.rate, cy, { width: CWS.rate - 3, align: "right" });
        doc.text(`${rateLabel}%`, CXS.cp, cy, { width: CWS.cp, align: "center" });
        doc.text(fmtN(rc), CXS.ca, cy, { width: CWS.ca - 3, align: "right" });
        doc.text(`${rateLabel}%`, CXS.sp, cy, { width: CWS.sp, align: "center" });
        doc.text(fmtN(rc), CXS.sa, cy, { width: CWS.sa - 3, align: "right" });
        doc.font(F_BOLD)
          .text(fmtN(ra), CXS.amt, cy, { width: CWS.amt - 3, align: "right" });

        y += RH;
      });

      y += 8;

      const TW = 220, TX = ML + CW - TW, LW = 110, VX = TX + LW, VW = TW - LW;
      const totalsHeight = 5 * 18;
      if (y + totalsHeight > MAX_Y) {
        doc.addPage();
        y = 30;
      }

      const totRow = (lbl, val, bold = false, bg = null) => {
        if (bg) doc.rect(TX, y, TW, 18).fill(bg);
        doc.rect(TX, y, TW, 18).stroke(BORD);
        doc.moveTo(VX, y).lineTo(VX, y + 18).stroke(BORD);
        const sz = bold ? 8 : 7.5, fn = bold ? F_BOLD : F_REG;
        doc.fontSize(sz).font(fn).fillColor(DARK).text(lbl, TX + 4, y + 5, { width: LW - 6 });
        doc.fontSize(sz).font(fn).fillColor(DARK).text(val, VX + 2, y + 5, { width: VW - 8, align: "right" });
        y += 18;
      };

      totRow("Sub Total", `₹ ${fmtN(subtotal)}`);
      totRow(`CGST (${rateLabel}%)`, `₹ ${fmtN(cgstAmt)}`);
      totRow(`SGST (${rateLabel}%)`, `₹ ${fmtN(sgstAmt)}`);
      totRow("Total", `₹ ${fmtN(totalAmt)}`, true, BGTOT);
      totRow("Balance Due", `₹ ${fmtN(balDue)}`, true, BGBAL);

      y += 10;

      const LCW = CW * 0.60;
      const wordsText = amountInWords(totalAmt);
      doc.fontSize(7.5).font(F_ITAL);
      const wordsH = doc.heightOfString(wordsText, { width: LCW });
      if (y + 12 + wordsH + 16 > MAX_Y) {
        doc.addPage();
        y = 30;
      }

      doc.fontSize(7.5).font(F_BOLD).fillColor(DARK).text("Total In Words", ML, y);
      y += 12;
      doc.fontSize(7.5).font(F_ITAL).fillColor(DARK)
        .text(wordsText, ML, y, { width: LCW });
      y += wordsH + 16;

      const notesLines = [
        "Thanks for your business.",
        "VASIFY TECHNOLOGIES PRIVATE LIMITED",
        "www.vasifytech.com  |  UIN : U62011MH2024PTC421417"
      ];
      if (y + 11 + notesLines.length * 10 + 14 > MAX_Y) {
        doc.addPage();
        y = 30;
      }

      doc.fontSize(7.5).font(F_BOLD).fillColor(DARK).text("Notes", ML, y);
      y += 11;
      notesLines.forEach(l => {
        doc.fontSize(7.5).font(F_REG).fillColor(GRAY).text(l, ML, y, { width: LCW });
        y += 10;
      });
      y += 14;

      const tcLines = [
        "1. Payment due within 5 to 7  days of the invoice date.",
        "2. Invoice disputes must be communicated within 15 days of the invoice date.",
        "3. Contact us at sushil@vasifytech.com for any payment-related inquiries."
      ];
      if (y + 7 + 12 + tcLines.length * 9 + 14 > MAX_Y) {
        doc.addPage();
        y = 30;
      }

      doc.moveTo(ML, y).lineTo(ML + CW, y).stroke(BORD);
      y += 7;
      doc.fontSize(7.5).font(F_BOLD).fillColor(DARK).text("Terms & Conditions", ML, y);
      y += 12;
      tcLines.forEach(t => {
        doc.fontSize(7).font(F_REG).fillColor(GRAY).text(t, ML, y, { width: LCW });
        y += 9;
      });
      y += 14;

      const paymentLines = [
        "Bank Name: HDFC Bank",
        "Account Name: VASIFY TECHNOLOGIES PRIVATE LIMITED",
        "Account Number: 50200096181775",
        "IFSC Code: HDFC0000548",
        "Branch: KANDIVALI EAST - THAKUR COMPLEX",
        "Account Type: CURRENT",
        "UPI ID: vasifytechnologiesprivatelimited.63009088@hdfcbank"
      ];
      const payH = 12 + paymentLines.length * 10;
      if (y + Math.max(payH, 110) > MAX_Y) {
        doc.addPage();
        y = 30;
      }

      const payStartY = y;
      doc.fontSize(7.5).font(F_BOLD).fillColor(DARK).text("Payment Details", ML, y);
      y += 12;

      paymentLines.forEach(l => {
        doc.fontSize(7).font(F_REG).fillColor(GRAY).text(l, ML, y, { width: LCW });
        y += 10;
      });

      const QR_ZONE_X = ML + LCW + 12;
      const QR_ZONE_W = CW - LCW - 12;
      const QR_SIZE = Math.min(110, QR_ZONE_W - 10);

      const QR_X = QR_ZONE_X + (QR_ZONE_W - QR_SIZE) / 2;
      const QR_Y = payStartY - 8;

      const qrPath = path.join(__dirname, "../assets/vasify_Payment_scanner.jpeg");
      try {
        doc.rect(QR_X - 3, QR_Y - 3, QR_SIZE + 6, QR_SIZE + 6).stroke(BORD);
        doc.image(qrPath, QR_X, QR_Y, { width: QR_SIZE, height: QR_SIZE });
        doc.fontSize(7).font(F_REG).fillColor(LGRAY)
          .text("Scan to Pay", QR_X - 3, QR_Y + QR_SIZE + 5,
            { width: QR_SIZE + 6, align: "center" });
      } catch (e) {
        console.warn("QR code image not found:", e.message);
      }

      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const FY = PH - 36;
        doc.moveTo(ML, FY - 4).lineTo(ML + CW, FY - 4).stroke(BORD);
        doc.fontSize(7).font(F_REG).fillColor(LGRAY)
          .text("This electronically generated invoice does not necessitate a signature.",
            ML + CW * 0.5, FY, { width: CW * 0.5, align: "right" });
        if (range.count > 1) {
          doc.fontSize(7).font(F_REG).fillColor(LGRAY)
            .text(`Page ${i + 1} of ${range.count}`, ML, FY, { width: CW * 0.5, align: "left" });
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── GET NEXT INVOICE NUMBER (SERIALWISE) ───────────────────────────────────

router.get("/next-number", authenticateToken, async (req, res) => {
  try {
    const nextNumber = await generateInvNumber(pool);
    res.json({ nextNumber });
  } catch (err) {
    console.error("next-number error:", err);
    res.status(500).json({ error: "Failed to generate next invoice number", detail: err.message });
  }
});

// ─── PDF GENERATION ROUTE ──────────────────────────────────────────────────
// Exactly matches Vasify Technologies sample invoice (INV-000076):
// Logo | Company header | TAX INVOICE title
// Meta box | Bill To / Ship To | Subject
// Items table (HSN/SAC, Qty, Rate, CGST%, CGST Amt, SGST%, SGST Amt, Amount)
// Totals | Amount in words | Notes | T&C | Payment details | Footer

router.post("/:id/download", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const access = await canAccessInvoice(req, res, id);
    if (!access.ok) return;

    const [invRows] = await pool.execute(
      INV_SELECT + " WHERE i.id = ?",
      sanitize(id)
    );
    if (!invRows.length) return res.status(404).json({ error: "Invoice not found" });

    const [items] = await pool.execute(
      "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
      sanitize(id)
    );

    const inv = invRows[0];
    const pdfBuffer = await generateInvoicePdfBuffer(inv, items, req.body?.logoBase64);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=invoice-${inv.invoice_number || "NA"}.pdf`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("PDF error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// ─── PUBLIC SIGNED PDF ROUTE (FOR META / WHATSAPP FETCH) ───────────────────

router.get("/:id/public-pdf", async (req, res) => {
  try {
    const { id } = req.params;
    const { e, s } = req.query;

    const expiresAt = Number(e);
    if (!expiresAt || Date.now() > expiresAt) {
      return res.status(403).json({ error: "PDF link has expired" });
    }

    const expectedSig = signPdfLink(id, expiresAt);
    if (!safeEqualHex(s, expectedSig)) {
      return res.status(403).json({ error: "Invalid signature for PDF link" });
    }

    const [invRows] = await pool.execute(
      INV_SELECT + " WHERE i.id = ?",
      sanitize(id)
    );
    if (!invRows.length) return res.status(404).json({ error: "Invoice not found" });

    const [items] = await pool.execute(
      "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
      sanitize(id)
    );

    const inv = invRows[0];
    const pdfBuffer = await generateInvoicePdfBuffer(inv, items);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader("Content-Disposition", `inline; filename=invoice-${inv.invoice_number || "NA"}.pdf`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("Public PDF fetch error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to fetch PDF" });
  }
});

// â”€â”€â”€ GET ALL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get("/", authenticateToken, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const { search, status, customerId, isRecurring, dueDateFrom, dueDateTo } = req.query;

    let where = "WHERE 1=1";
    const p   = [];

    if (req.user.role !== "admin") { where += " AND c.assigned_to = ?"; p.push(req.user.id); }
    if (search) {
      where += " AND (i.invoice_number LIKE ? OR COALESCE(i.customer_name_override,c.name) LIKE ?)";
      p.push(`%${search}%`, `%${search}%`);
    }
    if (status)       { where += " AND i.status = ?";       p.push(status); }
    if (customerId)   { where += " AND i.customer_id = ?";  p.push(customerId); }
    if (isRecurring !== undefined) {
      where += " AND i.is_recurring = ?";
      p.push(isRecurring === "true" ? 1 : 0);
    }
    if (dueDateFrom) { where += " AND i.due_date >= ?"; p.push(dueDateFrom); }
    if (dueDateTo)   { where += " AND i.due_date <= ?"; p.push(dueDateTo); }

    const [invoices] = await pool.execute(
      `${INV_SELECT} ${where} ORDER BY i.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      sanitize(...p)
    );

    if (invoices.length) {
      const ids  = invoices.map(i => i.id);
      const ph   = ids.map(() => "?").join(",");
      const [all] = await pool.execute(
        `SELECT * FROM invoice_items WHERE invoice_id IN (${ph}) ORDER BY created_at`,
        sanitize(...ids)
      );
      invoices.forEach(inv => { inv.items = all.filter(it => it.invoice_id === inv.id); });
    }

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id ${where}`,
      sanitize(...p)
    );

    res.json({
      invoices,
      pagination: {
        page, limit, total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    console.error("Invoices fetch:", err);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

// â”€â”€â”€ STATS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get("/stats/overview", authenticateToken, async (req, res) => {
  try {
    let where = "WHERE 1=1";
    const p   = [];
    if (req.user.role !== "admin") { where += " AND c.assigned_to = ?"; p.push(req.user.id); }

    const [statusStats] = await pool.execute(
      `SELECT i.status, COUNT(*) AS count, COALESCE(SUM(i.total),0) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id ${where} GROUP BY i.status`,
      sanitize(...p)
    );
    const [monthly] = await pool.execute(
      `SELECT DATE_FORMAT(i.created_at,'%Y-%m') AS month, COUNT(*) AS count, COALESCE(SUM(i.total),0) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       ${where} AND i.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY month ORDER BY month`,
      sanitize(...p)
    );
    const [[overdue]] = await pool.execute(
      `SELECT COUNT(*) AS count, COALESCE(SUM(i.total),0) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       ${where} AND i.status IN ('sent','overdue','pending') AND i.due_date < CURDATE()`,
      sanitize(...p)
    );
    const [[recurring]] = await pool.execute(
      `SELECT COUNT(*) AS count, COALESCE(SUM(i.total),0) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       ${where} AND i.is_recurring = 1`,
      sanitize(...p)
    );

    res.json({ statusBreakdown: statusStats, monthlyTrend: monthly, overdue, recurring });
  } catch (err) {
    console.error("Stats:", err);
    res.status(500).json({ error: "Failed to fetch invoice statistics" });
  }
});

// â”€â”€â”€ GET SINGLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await canAccessInvoice(req, res, id);
    if (!access.ok) return;

    const [[inv]] = await pool.execute(INV_SELECT + " WHERE i.id = ?", sanitize(id));
    if (!inv) return res.status(404).json({ error: "Invoice not found" });

    const [items] = await pool.execute(
      "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at", sanitize(id)
    );
    inv.items = items;
    res.json({ invoice: inv });
  } catch (err) {
    console.error("Get invoice:", err);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

// â”€â”€â”€ CREATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post(
  "/",
  authenticateToken,
  [
    body("customerId").notEmpty().withMessage("Customer ID is required"),
    body("items").isArray({ min: 1 }).withMessage("At least one item is required"),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      const {
        customerId, items,
        isRecurring, recurringFrequency, recurringCycles,
        recurringStartDate, recurringEndDate,
        customerName, customerEmail, customerPhone, customerCompany, customerAddress,
        poNumber, terms, placeOfSupply,
      } = req.body;

      // Validate customer
      const [custs] = await conn.execute(
        `SELECT id, assigned_to, default_tax_rate, default_due_days, default_invoice_notes
         FROM customers WHERE id = ?`,
        sanitize(customerId)
      );
      if (!custs.length) {
        await conn.rollback(); conn.release();
        return res.status(400).json({ error: "Customer not found" });
      }
      const cust = custs[0];
      if (req.user.role !== "admin" && cust.assigned_to !== req.user.id) {
        await conn.rollback(); conn.release();
        return res.status(403).json({ error: "No permission to invoice this customer" });
      }

      // Financials
      const subtotal  = req.body.amount !== undefined
        ? Number(req.body.amount)
        : items.reduce((s, i) => s + Number(i.amount || 0), 0);
      const taxRate   = req.body.tax !== undefined ? Number(req.body.tax) : Number(cust.default_tax_rate || 18);
      const gstAmt    = (subtotal * taxRate) / 100;
      const total     = req.body.total !== undefined ? Number(req.body.total) : subtotal + gstAmt;
      const status    = req.body.status || "draft";
      const issueDate = toSqlDate(req.body.issueDate || new Date());
      const dueDate   = toSqlDate(req.body.dueDate   || (() => {
        const d = new Date(); d.setDate(d.getDate() + Number(cust.default_due_days || 5)); return d;
      })());
      const notes = req.body.notes ?? cust.default_invoice_notes ?? null;

      // Invoice number: use supplied if valid & unique, else auto-generate
      let invNum = String(req.body.invoiceNumber || "").trim();
      if (invNum) {
        const [dup] = await conn.execute(
          "SELECT id FROM invoices WHERE invoice_number = ?", sanitize(invNum)
        );
        if (dup.length) invNum = await generateInvNumber(conn);
      } else {
        invNum = await generateInvNumber(conn);
      }

      const invoiceId = uuidv4();

      const executeInvoiceInsert = async () => {
        await conn.execute(
          `INSERT INTO invoices
             (id, customer_id, invoice_number, amount, tax, gst_amount, total, status,
              issue_date, due_date, notes,
              po_number, terms, place_of_supply,
              customer_name_override, customer_email_override,
              customer_phone_override, customer_company_override, customer_address_override,
              is_recurring, recurring_frequency, recurring_cycles,
              recurring_start_date, recurring_end_date)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          sanitize(
            invoiceId, customerId, invNum, subtotal, taxRate, gstAmt, total, status,
            issueDate, dueDate, notes,
            poNumber        || null,
            terms           || "due_on_receipt",
            placeOfSupply   || "Maharashtra (27)",
            customerName    || null,
            customerEmail   || null,
            customerPhone   || null,
            customerCompany || null,
            customerAddress || null,
            isRecurring ? 1 : 0,
            recurringFrequency  || null,
            recurringCycles     ? Number(recurringCycles) : null,
            recurringStartDate  ? toSqlDate(recurringStartDate) : null,
            recurringEndDate    ? toSqlDate(recurringEndDate)   : null
          )
        );

        for (const item of items) {
          await conn.execute(
            `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount, hsn, breakdown)
             VALUES (?,?,?,?,?,?,?,?)`,
            sanitize(
              uuidv4(), invoiceId,
              item.description, item.quantity || 1, item.rate || 0, item.amount || 0,
              item.hsn || "998313",
              item.breakdown ? JSON.stringify(item.breakdown) : null
            )
          );
        }
      };

      try {
        await executeInvoiceInsert();
      } catch (insertErr) {
        if (await ensureInvoiceColumns(conn, insertErr)) {
          await executeInvoiceInsert();
        } else {
          throw insertErr;
        }
      }

      await conn.commit();

      const [[created]] = await conn.execute(INV_SELECT + " WHERE i.id = ?", sanitize(invoiceId));
      const [createdItems] = await conn.execute(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at", sanitize(invoiceId)
      );
      created.items = createdItems;

      res.status(201).json({ message: "Invoice created successfully", invoice: created });
    } catch (err) {
      await conn.rollback();
      console.error("Create invoice:", err);
      res.status(500).json({ error: "Failed to create invoice", details: err.message });
    } finally {
      conn.release();
    }
  }
);

// â”€â”€â”€ UPDATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.put("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  // Existence check first (gives 404 not 403 for missing rows)
  const [ex] = await pool.execute("SELECT id FROM invoices WHERE id = ?", sanitize(id));
  if (!ex.length) return res.status(404).json({ error: "Invoice not found" });

  const access = await canAccessInvoice(req, res, id);
  if (!access.ok) return;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const data = { ...req.body };

    // Auto-set paidDate when marking paid
    if (data.status === "paid" && !data.paidDate) data.paidDate = toSqlDate(new Date());

    // Normalise dates
    ["issueDate","dueDate","paidDate","recurringStartDate","recurringEndDate"].forEach(k => {
      if (data[k]) data[k] = toSqlDate(data[k]);
    });

    const fields = [], values = [];
    for (const [key, value] of Object.entries(data)) {
      if (key === "items" || value === undefined) continue;
      const col = FIELD_MAP[key];
      if (!col) continue;
      fields.push(`${col} = ?`);
      values.push(key === "isRecurring" ? (value ? 1 : 0) : (value === "" ? null : value));
    }

    if (fields.length) {
      await conn.execute(
        `UPDATE invoices SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        sanitize(...values, id)
      );
    }

    if (Array.isArray(data.items)) {
      await conn.execute("DELETE FROM invoice_items WHERE invoice_id = ?", sanitize(id));
      for (const item of data.items) {
        await conn.execute(
          `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount, hsn, breakdown)
           VALUES (?,?,?,?,?,?,?,?)`,
          sanitize(
            uuidv4(), id,
            item.description, item.quantity || 1, item.rate || 0, item.amount || 0,
            item.hsn || "998313",
            item.breakdown ? JSON.stringify(item.breakdown) : null
          )
        );
      }
    }

    await conn.commit();

    const [[updated]] = await conn.execute(INV_SELECT + " WHERE i.id = ?", sanitize(id));
    const [updItems]  = await conn.execute(
      "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at", sanitize(id)
    );
    updated.items = updItems;

    res.json({ message: "Invoice updated successfully", invoice: updated });
  } catch (err) {
    await conn.rollback();
    console.error("Update invoice:", err);
    res.status(500).json({ error: "Failed to update invoice" });
  } finally {
    conn.release();
  }
});

// â”€â”€â”€ DELETE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.delete("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  const [ex] = await pool.execute("SELECT id FROM invoices WHERE id = ?", sanitize(id));
  if (!ex.length) return res.status(404).json({ error: "Invoice not found" });

  const access = await canAccessInvoice(req, res, id);
  if (!access.ok) return;

  try {
    await pool.execute("DELETE FROM invoice_items WHERE invoice_id = ?", sanitize(id));
    await pool.execute("DELETE FROM invoices WHERE id = ?", sanitize(id));
    res.json({ message: "Invoice deleted successfully" });
  } catch (err) {
    console.error("Delete invoice:", err);
    res.status(500).json({ error: "Failed to delete invoice" });
  }
});

module.exports = router;
// Exposed for unit tests (see test/invoicePdf.test.js). Express ignores extra
// properties on the router, so this is safe for mounting.
module.exports.generateInvoicePdfBuffer = generateInvoicePdfBuffer;


