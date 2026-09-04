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

module.exports = {
  handleLogin,
  handleGetStats,
  handleGetCompanies,
  handleGetCompanyById,
  handleSuspendCompany,
  handleDeleteCompany,
  handleExtendPlan,
  handleGetInvoices,
  handleGetTickets,
  handleGetAuditLogs
};

