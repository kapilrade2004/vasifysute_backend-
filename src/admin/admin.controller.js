const adminService = require('./admin.service');

/**
 * POST /api/admin/login
 */
async function handleLogin(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await adminService.loginAdmin(email, password, ipAddress);

    if (!result.success) {
      return res.status(401).json({ success: false, error: result.message });
    }

    res.json({
      success: true,
      message: 'Master Admin authentication successful.',
      token: result.token,
      admin: result.admin
    });
  } catch (err) {
    console.error('[AdminController] Login Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error during admin authentication.' });
  }
}

/**
 * GET /api/admin/stats
 */
async function handleGetStats(req, res) {
  try {
    const stats = await adminService.getPlatformStats();
    res.json({ success: true, ...stats });
  } catch (err) {
    console.error('[AdminController] Stats Error:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve platform stats.' });
  }
}

/**
 * GET /api/admin/companies
 */
async function handleGetCompanies(req, res) {
  try {
    const result = await adminService.getCompanies(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[AdminController] Companies Error:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve companies list.' });
  }
}

/**
 * GET /api/admin/companies/:id
 */
async function handleGetCompanyById(req, res) {
  try {
    const company = await adminService.getCompanyById(req.params.id);
    if (!company) {
      return res.status(404).json({ success: false, error: 'Company record not found.' });
    }
    res.json({ success: true, ...company });
  } catch (err) {
    console.error('[AdminController] Get Company Error:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve company details.' });
  }
}

/**
 * PUT /api/admin/companies/:id/suspend
 */
async function handleSuspendCompany(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.admin.id;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const result = await adminService.suspendCompany(id, adminId, ipAddress, reason);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[AdminController] Suspend Error:', err);
    res.status(500).json({ success: false, error: 'Failed to suspend company.' });
  }
}

/**
 * DELETE /api/admin/companies/:id/delete
 */
async function handleDeleteCompany(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.admin.id;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const result = await adminService.deleteCompany(id, adminId, ipAddress, reason);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[AdminController] Delete Error:', err);
    res.status(500).json({ success: false, error: 'Failed to soft delete company.' });
  }
}

/**
 * GET /api/admin/invoices
 */
async function handleGetInvoices(req, res) {
  try {
    const result = await adminService.getInvoices(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[AdminController] Invoices Error:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve cross-tenant invoices.' });
  }
}

/**
 * GET /api/admin/tickets
 */
async function handleGetTickets(req, res) {
  try {
    const result = await adminService.getTickets(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[AdminController] Tickets Error:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve support tickets.' });
  }
}

/**
 * GET /api/admin/audit-logs
 */
async function handleGetAuditLogs(req, res) {
  try {
    const result = await adminService.getAuditLogs(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[AdminController] Audit Logs Error:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve audit logs.' });
  }
}

/**
 * PUT /api/admin/companies/:id/extend-plan
 */
async function handleExtendPlan(req, res) {
  try {
    const { id } = req.params;
    const { days } = req.body;
    const daysNum = parseInt(days, 10);
    if (isNaN(daysNum) || daysNum <= 0) {
      return res.status(400).json({ success: false, error: 'Valid positive number of days is required.' });
    }

    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const result = await adminService.extendTenantPlan(id, daysNum, adminId, ipAddress);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[AdminController] Extend Plan Error:', err);
    res.status(500).json({ success: false, error: 'Failed to extend tenant plan days.' });
  }
}

/**
 * POST /api/admin/companies
 */
async function handleCreateCompany(req, res) {
  try {
    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await adminService.createCompany(req.body, adminId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[AdminController] Create Company Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to create company.' });
  }
}

/**
 * PUT /api/admin/companies/:id
 */
async function handleUpdateCompany(req, res) {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await adminService.updateCompany(id, req.body, adminId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[AdminController] Update Company Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to update company.' });
  }
}

/**
 * POST /api/admin/companies/:id/reset-password
 */
async function handleResetCompanyPassword(req, res) {
  try {
    const { id } = req.params;
    const { password } = req.body;
    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await adminService.resetCompanyPassword(id, password, adminId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[AdminController] Reset Password Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to reset password.' });
  }
}

/**
 * POST /api/admin/users
 */
async function handleCreateUser(req, res) {
  try {
    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await adminService.createUser(req.body, adminId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[AdminController] Create User Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to create user.' });
  }
}

/**
 * PUT /api/admin/users/:id
 */
async function handleUpdateUser(req, res) {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await adminService.updateUser(id, req.body, adminId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[AdminController] Update User Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to update user.' });
  }
}

/**
 * DELETE /api/admin/users/:id
 */
async function handleDeleteUser(req, res) {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await adminService.deleteUser(id, adminId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[AdminController] Delete User Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to delete user.' });
  }
}

/**
 * GET /api/admin/users
 */
async function handleGetUsers(req, res) {
  try {
    const result = await adminService.getUsersDirectory(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[AdminController] Get Users Error:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve platform users.' });
  }
}

/**
 * GET /api/admin/users/:id/data
 * 360° User Inspector Aggregator
 */
async function handleGetUserData(req, res) {
  try {
    const { id } = req.params;
    const data = await adminService.getUserFull360Data(id);
    res.json(data);
  } catch (err) {
    console.error('[AdminController] Get User 360 Data Error:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve comprehensive user data.' });
  }
}

/**
 * POST /api/admin/users/:id/reset-password
 */
async function handleResetUserPassword(req, res) {
  try {
    const { id } = req.params;
    const { password } = req.body;
    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await adminService.resetUserPassword(id, password, adminId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[AdminController] Reset User Password Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to reset user password.' });
  }
}

/**
 * POST /api/admin/users/:id/impersonate
 */
async function handleImpersonateUser(req, res) {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await adminService.impersonateUser(id, adminId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[AdminController] Impersonate User Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to initialize impersonation session.' });
  }
}

/**
 * PUT /api/admin/invoices/:id/status
 */
async function handleUpdateInvoiceStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await adminService.updateInvoiceStatus(id, status, adminId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[AdminController] Update Invoice Status Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to update invoice status.' });
  }
}

/**
 * POST /api/admin/tickets
 */
async function handleCreateTicket(req, res) {
  try {
    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await adminService.createTicket(req.body, adminId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[AdminController] Create Ticket Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to create ticket.' });
  }
}

/**
 * PUT /api/admin/tickets/:id
 */
async function handleUpdateTicket(req, res) {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await adminService.updateTicket(id, req.body, adminId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[AdminController] Update Ticket Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to update ticket.' });
  }
}

/**
 * GET /api/admin/system-health
 */
async function handleGetSystemHealth(req, res) {
  try {
    const health = await adminService.getSystemHealth();
    res.json({ success: true, ...health });
  } catch (err) {
    console.error('[AdminController] System Health Error:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve system health.' });
  }
}

/**
 * POST /api/admin/test-email
 */
async function handleTestAdminEmail(req, res) {
  try {
    const { targetEmail } = req.body;
    const adminId = req.admin?.id || 'admin-super-root';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const result = await adminService.sendAdminTestEmail(targetEmail, adminId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[AdminController] Test Email Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to dispatch test email.' });
  }
}

module.exports = {
  handleLogin,
  handleGetStats,
  handleGetCompanies,
  handleGetCompanyById,
  handleCreateCompany,
  handleUpdateCompany,
  handleResetCompanyPassword,
  handleSuspendCompany,
  handleDeleteCompany,
  handleExtendPlan,
  handleGetUsers,
  handleGetUserData,
  handleCreateUser,
  handleUpdateUser,
  handleDeleteUser,
  handleResetUserPassword,
  handleImpersonateUser,
  handleGetInvoices,
  handleUpdateInvoiceStatus,
  handleGetTickets,
  handleCreateTicket,
  handleUpdateTicket,
  handleGetAuditLogs,
  handleGetSystemHealth,
  handleTestAdminEmail
};


