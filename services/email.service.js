const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function sendTrialEmail(toEmail, subject, text, html) {
  try {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass || pass === 'your_16_digit_app_password') {
      console.log(`ℹ️ SMTP credentials not configured. Simulated sending email to ${toEmail}: "${subject}"`);
      return { success: true, simulated: true };
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });

    const info = await transporter.sendMail({
      from: `"VasifyTech Suite Support" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: subject,
      text: text,
      html: html
    });

    console.log(`✅ [REAL EMAIL SENT] Email delivered to ${toEmail}. MessageID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`❌ [EMAIL SEND ERROR] Failed to send email to ${toEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendTrialEmail };
