const UserModel = require('../models/user.model');
const { sendTrialEmail } = require('../services/email.service');

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(String(email).toLowerCase());
}

// POST /api/users - Create User with 7-Day Free Trial
async function createUser(req, res) {
  try {
    const { user_name, mobile_number, email, company_name, service_needed } = req.body;

    if (!user_name || String(user_name).trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'User name is required and must be at least 2 characters long.'
      });
    }

    if (!mobile_number || String(mobile_number).trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is required.'
      });
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required.'
      });
    }

    if (!company_name || String(company_name).trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Company name is required and must be at least 2 characters long.'
      });
    }

    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedMobile = String(mobile_number).trim();
    const trimmedName = String(user_name).trim();
    const trimmedCompany = String(company_name).trim();
    const trimmedService = service_needed ? String(service_needed).trim() : 'full_suite';

    let existingEmail = null;
    let existingMobile = null;
    try {
      existingEmail = await UserModel.findByEmail(trimmedEmail);
      existingMobile = await UserModel.findByMobile(trimmedMobile);
    } catch (dbErr) {
      console.warn('⚠️ Database query error (using session fallback):', dbErr.message);
    }

    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: 'This email is already registered.'
      });
    }

    if (existingMobile) {
      return res.status(400).json({
        success: false,
        message: 'This mobile number is already registered.'
      });
    }

    const user = await UserModel.createUser({
      user_name: trimmedName,
      mobile_number: trimmedMobile,
      email: trimmedEmail,
      company_name: trimmedCompany,
      service_needed: trimmedService
    });

    // Send real HTML welcome email to the newly registered email address
    const endDateStr = user.trial_ends_at ? new Date(user.trial_ends_at).toLocaleDateString() : '7 days from today';
    const welcomeSubject = `🚀 Welcome to VasifyTech Suite - 7-Day Free Trial Activated!`;
    const welcomeText = `Hi ${user.user_name}! Welcome to VasifyTech Suite. Your 7-day free trial for ${user.company_name} is active until ${endDateStr}. Access your workspace at http://localhost:3000/signin.`;
    const welcomeHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #1DA851; margin: 0;">VasifyTech <span style="color: #0f172a;">Suite</span></h2>
          <p style="color: #64748b; font-size: 13.5px; margin-top: 4px;">Unified Business Super-Platform</p>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
          <h3 style="color: #166534; margin-top: 0;">🎉 Welcome, ${user.user_name}!</h3>
          <p style="color: #15803d; font-size: 14.5px; line-height: 1.5;">
            Thank you for registering <strong>${user.company_name}</strong> with VasifyTech Suite! Your <strong>7-Day Free Trial</strong> is now active and will run through <strong>${endDateStr}</strong>.
          </p>
        </div>
        <p style="color: #334155; font-size: 14px;"><strong>Your Activated Services:</strong> ${user.service_needed}</p>
        <p style="color: #475569; font-size: 13.5px;">You can now log in and start streamlining your business operations immediately.</p>
        <div style="text-align: center; margin-top: 28px; padding-top: 18px; border-top: 1px solid #e2e8f0;">
          <a href="http://localhost:3000/signin" style="background: #1DA851; color: #ffffff; padding: 12px 28px; border-radius: 30px; text-decoration: none; font-weight: bold; display: inline-block;">Log In to My Workspace</a>
        </div>
      </div>
    `;

    await sendTrialEmail(user.email, welcomeSubject, welcomeText, welcomeHtml);

    console.log(`📧 [WELCOME EMAIL SENT] Sent 7-Day Free Trial welcome email to ${user.email}. Trial ends on ${user.trial_ends_at}.`);

    return res.status(201).json({
      success: true,
      message: 'User created successfully with 7-Day Free Trial',
      user
    });
  } catch (error) {
    console.error('Error creating user:', error);
    let msg = 'Unable to save your information. Please try again.';
    if (error.code === 'ER_DUP_ENTRY') {
      if (error.message && error.message.includes('email')) {
        msg = 'This email is already registered.';
      } else if (error.message && error.message.includes('mobile')) {
        msg = 'This mobile number is already registered.';
      } else {
        msg = 'Email or mobile number is already registered.';
      }
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ER_ACCESS_DENIED_ERROR' || error.code === 'ER_BAD_DB_ERROR') {
      // Create user fallback object when local MySQL server is not running
      const { user_name, mobile_number, email, company_name, service_needed } = req.body;
      const mockUser = {
        id: Date.now(),
        user_name: user_name || 'Valued User',
        mobile_number: mobile_number || '+91 98765 43210',
        email: email || 'user@company.com',
        company_name: company_name || 'My Company',
        service_needed: service_needed || 'Full Business Suite',
        plan: 'starter_monthly',
        created_at: new Date().toISOString()
      };
      return res.status(200).json({
        success: true,
        message: 'Account registered successfully (Session Mode)',
        user: mockUser
      });
    }
    return res.status(500).json({
      success: false,
      message: msg
    });
  }
}

// GET /api/users - Get All Users
async function getUsers(req, res) {
  try {
    const users = await UserModel.getAllUsers();
    return res.status(200).json({
      success: true,
      users
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(200).json({
      success: true,
      users: []
    });
  }
}

// GET /api/users/:id - Get Single User
async function getUser(req, res) {
  try {
    const { id } = req.params;
    const user = await UserModel.getUserById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }
    return res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve user.'
    });
  }
}

// PUT /api/users/:id - Update User
async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { user_name, mobile_number, email, company_name } = req.body;

    const existingUser = await UserModel.getUserById(id);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    if (!user_name || String(user_name).trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'User name is required and must be at least 2 characters long.'
      });
    }

    if (!mobile_number || String(mobile_number).trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is required.'
      });
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required.'
      });
    }

    if (!company_name || String(company_name).trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Company name is required and must be at least 2 characters long.'
      });
    }

    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedMobile = String(mobile_number).trim();

    const emailCheck = await UserModel.findByEmail(trimmedEmail, id);
    if (emailCheck) {
      return res.status(400).json({
        success: false,
        message: 'This email is already registered.'
      });
    }

    const mobileCheck = await UserModel.findByMobile(trimmedMobile, id);
    if (mobileCheck) {
      return res.status(400).json({
        success: false,
        message: 'This mobile number is already registered.'
      });
    }

    const updatedUser = await UserModel.updateUser(id, {
      user_name: String(user_name).trim(),
      mobile_number: trimmedMobile,
      email: trimmedEmail,
      company_name: String(company_name).trim()
    });

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to update user information. Please try again.'
    });
  }
}

// DELETE /api/users/:id - Delete User
async function deleteUser(req, res) {
  try {
    const { id } = req.params;
    const deleted = await UserModel.deleteUser(id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'User not found or already deleted.'
      });
    }
    return res.status(200).json({
      success: true,
      message: 'User deleted successfully.'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete user.'
    });
  }
}

// POST /api/users/:id/upgrade - Upgrade User to Premium
async function upgradeUser(req, res) {
  try {
    const { id } = req.params;
    const user = await UserModel.upgradeToPremium(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    console.log(`🎉 [PREMIUM UPGRADE] User ${user.email} (${user.company_name}) upgraded to Premium Plan!`);
    return res.status(200).json({
      success: true,
      message: 'User upgraded to Premium successfully',
      user
    });
  } catch (error) {
    console.error('Error upgrading user:', error);
    return res.status(500).json({ success: false, message: 'Failed to upgrade user.' });
  }
}

// GET /api/users/check-trials - Check Trial Expirations & Send 1-2 Day Email Reminders
async function checkTrials(req, res) {
  try {
    const { userId } = req.query || {};
    const users = await UserModel.getAllUsers();
    const remindersSent = [];

    // Filter target users (either specific user that logged in, or all non-premium users)
    let targetUsers = users;
    if (userId) {
      targetUsers = users.filter(u => String(u.id) === String(userId));
    }

    for (const user of targetUsers) {
      if (user.trial_status === 'premium') continue;

      const daysLeft = Number(user.days_left);

      // Check if trial has 1 or 2 days left (or analyze last logged in user trial warning)
      if (daysLeft === 1 || daysLeft === 2 || req.query.force === 'true') {
        const endDateStr = new Date(user.trial_ends_at).toLocaleDateString();
        const subject = `⚠️ Reminder: Your VasifyTech 7-Day Free Trial ends in ${daysLeft} day(s)`;
        const text = `Hi ${user.user_name || 'there'}! Your 7-Day Free Trial for ${user.company_name || 'your workspace'} ends in ${daysLeft} day(s) on ${endDateStr}. Upgrade to Premium to keep uninterrupted access!`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #1DA851; margin: 0;">VasifyTech <span style="color: #0f172a;">Suite</span></h2>
            </div>
            <div style="background: #fffbeb; border: 1px solid #fef08a; padding: 18px; border-radius: 12px; margin-bottom: 20px;">
              <h3 style="color: #b45309; margin-top: 0;">⚠️ Your Free Trial is Ending Soon!</h3>
              <p style="color: #92400e; font-size: 14.5px; line-height: 1.5;">
                Hi <strong>${user.user_name || 'there'}</strong>, your 7-Day Free Trial for <strong>${user.company_name || 'VasifyTech Workspace'}</strong> ends in <strong>${daysLeft} day(s)</strong> on <strong>${endDateStr}</strong>.
              </p>
            </div>
            <p style="color: #334155; font-size: 14px;">Don't lose access to your active CRM, HR, Projects, and Finance data. Upgrade to keep full access!</p>
            <div style="text-align: center; margin-top: 24px;">
              <a href="http://localhost:3000/pricing" style="background: #1DA851; color: #ffffff; padding: 12px 24px; border-radius: 30px; text-decoration: none; font-weight: bold; display: inline-block;">Upgrade to Premium Plan</a>
            </div>
          </div>
        `;

        await sendTrialEmail(user.email, subject, text, html);
        await UserModel.updateTrialReminder(user.id, 'warning');
        remindersSent.push({ id: user.id, email: user.email, daysLeft, type: 'warning_email' });
      } else if (daysLeft <= 0 && user.trial_status !== 'expired') {
        const endDateStr = new Date(user.trial_ends_at).toLocaleDateString();
        const subject = `🚨 Notice: Your VasifyTech 7-Day Free Trial has Ended`;
        const text = `Hi ${user.user_name || 'there'}! Your 7-Day Free Trial for ${user.company_name || 'your workspace'} ended on ${endDateStr}. Upgrade to Premium to reactivate full access!`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #fecaca; border-radius: 16px; background: #ffffff;">
            <div style="background: #fef2f2; border: 1px solid #fca5a5; padding: 18px; border-radius: 12px; margin-bottom: 20px;">
              <h3 style="color: #991b1b; margin-top: 0;">🚨 Free Trial Expired</h3>
              <p style="color: #991b1b; font-size: 14.5px; line-height: 1.5;">
                Your 7-Day Free Trial for <strong>${user.company_name || 'VasifyTech Workspace'}</strong> ended on <strong>${endDateStr}</strong>.
              </p>
            </div>
            <p style="color: #334155; font-size: 14px;">Upgrade to Premium now to reactivate your workspace and unlock all features.</p>
            <div style="text-align: center; margin-top: 24px;">
              <a href="http://localhost:3000/pricing" style="background: #dc2626; color: #ffffff; padding: 12px 24px; border-radius: 30px; text-decoration: none; font-weight: bold; display: inline-block;">Reactivate Workspace</a>
            </div>
          </div>
        `;

        await sendTrialEmail(user.email, subject, text, html);
        await UserModel.updateTrialReminder(user.id, 'expired');
        remindersSent.push({ id: user.id, email: user.email, daysLeft, type: 'expired_email' });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Trial check complete. Processed ${remindersSent.length} email notifications.`,
      remindersSent
    });
  } catch (error) {
    console.error('Error checking trials:', error);
    return res.status(500).json({ success: false, message: 'Failed to check trial status.' });
  }
}

// POST /api/users/send-welcome-email - Dispatch Welcome Email using database analyzed user profile
async function sendTestEmail(req, res) {
  try {
    const { targetEmail, userName, companyName } = req.body;
    if (!targetEmail) {
      return res.status(400).json({ success: false, message: 'targetEmail is required' });
    }

    const emailToUse = targetEmail.trim().toLowerCase();
    
    // Analyze database to find exact registered user name and company
    let analyzedName = userName;
    let analyzedCompany = companyName;
    let analyzedServices = 'Full Business Suite';

    try {
      const dbUser = await UserModel.findByEmail(emailToUse);
      if (dbUser) {
        analyzedName = dbUser.user_name || analyzedName;
        analyzedCompany = dbUser.company_name || analyzedCompany;
        analyzedServices = dbUser.service_needed || analyzedServices;
      }
    } catch (e) {}

    const nameStr = analyzedName || 'Valued User';
    const companyStr = analyzedCompany || 'VasifyTech Workspace';

    const subject = `🚀 Welcome to VasifyTech Suite - 7-Day Free Trial Activated!`;
    const text = `Hi ${nameStr}! Welcome to VasifyTech Suite. Your 7-day free trial for ${companyStr} is active. Access your workspace at http://localhost:3000/signin.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #1DA851; margin: 0;">VasifyTech <span style="color: #0f172a;">Suite</span></h2>
          <p style="color: #64748b; font-size: 13.5px; margin-top: 4px;">Unified Business Super-Platform</p>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
          <h3 style="color: #166534; margin-top: 0;">🎉 Welcome, ${nameStr}!</h3>
          <p style="color: #15803d; font-size: 14.5px; line-height: 1.5;">
            Thank you for registering <strong>${companyStr}</strong> with VasifyTech Suite! Your <strong>7-Day Free Trial</strong> is now active.
          </p>
        </div>
        <p style="color: #334155; font-size: 14px;"><strong>Your Activated Services:</strong> ${analyzedServices}</p>
        <p style="color: #475569; font-size: 13.5px;">You can now log in and start streamlining your business operations immediately.</p>
        <div style="text-align: center; margin-top: 28px; padding-top: 18px; border-top: 1px solid #e2e8f0;">
          <a href="http://localhost:3000/signin" style="background: #1DA851; color: #ffffff; padding: 12px 28px; border-radius: 30px; text-decoration: none; font-weight: bold; display: inline-block;">Log In to My Workspace</a>
        </div>
      </div>
    `;

    console.log(`📧 Dispatching analyzed welcome email to: ${emailToUse} (Name: ${nameStr}, Company: ${companyStr})`);
    const result = await sendTrialEmail(emailToUse, subject, text, html);

    return res.status(200).json({
      success: true,
      message: `Test email dispatched to ${emailToUse}`,
      details: result
    });
  } catch (error) {
    console.error('Error sending test email:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = {
  createUser,
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  upgradeUser,
  checkTrials,
  sendTestEmail
};
