const { sendTrialEmail } = require('../services/email.service');

async function test() {
  console.log('Sending test email via Gmail SMTP...');
  const res = await sendTrialEmail(
    'kapilrade2004@gmail.com',
    '🚀 VasifyTech Suite Real Email Delivery Active!',
    'Your Gmail App Password integration is configured and active!',
    `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #10b981; border-radius: 16px; background: #f0fdf4;">
        <h2 style="color: #166534; margin: 0 0 12px;">🎉 Email Service Active!</h2>
        <p style="color: #15803d; font-size: 14.5px; line-height: 1.5;">
          Your Gmail App Password (<strong>kapilrade22712@gmail.com</strong>) has been successfully verified! All new registered users will receive real HTML welcome & trial notification emails in their inbox automatically.
        </p>
      </div>
    `
  );
  console.log('Email delivery result:', res);
}

test();
