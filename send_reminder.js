const { sendTrialEmail } = require('./services/email.service');

async function main() {
  const targetEmail = 'baapt9674@gmail.com';
  const subject = '⚠️ Reminder: Your VasifyTech 7-Day Free Trial ends in 2 days';
  const text = 'Hi Kapil! Your 7-Day Free Trial for VasifyTech Suite ends in 2 days. Upgrade to Premium to keep uninterrupted access!';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #1DA851; margin: 0;">VasifyTech <span style="color: #0f172a;">Suite</span></h2>
      </div>
      <div style="background: #fffbeb; border: 1px solid #fef08a; padding: 18px; border-radius: 12px; margin-bottom: 20px;">
        <h3 style="color: #b45309; margin-top: 0;">⚠️ Your Free Trial is Ending Soon!</h3>
        <p style="color: #92400e; font-size: 14.5px; line-height: 1.5;">
          Hi <strong>Kapil</strong>, your 7-Day Free Trial for <strong>VasifyTech Suite</strong> ends in <strong>2 days</strong>. Upgrade to Premium to keep uninterrupted access!
        </p>
      </div>
      <div style="text-align: center; margin-top: 24px;">
        <a href="http://localhost:3000/pricing" style="background: #1DA851; color: #ffffff; padding: 12px 24px; border-radius: 30px; text-decoration: none; font-weight: bold; display: inline-block;">Upgrade to Premium Plan</a>
      </div>
    </div>
  `;

  console.log(`Sending 2-Day Trial Expiry Reminder to ${targetEmail}...`);
  const res = await sendTrialEmail(targetEmail, subject, text, html);
  console.log('RESULT:', res);
}

main();
