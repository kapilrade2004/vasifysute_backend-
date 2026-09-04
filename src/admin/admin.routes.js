const express = require('express');
const router = express.Router();
const adminController = require('./admin.controller');
const { loginRateLimiter, verifyAdminToken, requireRole } = require('./admin.middleware');

// ── Public Auth Route ─────────────────────────────────────────────────────────
// POST /api/admin/login (Rate Limited, uses ADMIN_JWT_SECRET)
router.post('/login', loginRateLimiter, adminController.handleLogin);

// ── Guarded Master Admin Routes ───────────────────────────────────────────────
// Protected by verifyAdminToken + requireRole('super_admin')
router.use(verifyAdminToken);
router.use(requireRole('super_admin'));

// Platform Telemetry & System Health
router.get('/stats', adminController.handleGetStats);
router.get('/system-health', adminController.handleGetSystemHealth);
router.post('/test-email', adminController.handleTestAdminEmail);

// Tenant Companies Management
router.get('/companies', adminController.handleGetCompanies);
router.post('/companies', adminController.handleCreateCompany);
router.get('/companies/:id', adminController.handleGetCompanyById);
router.put('/companies/:id', adminController.handleUpdateCompany);
router.post('/companies/:id/reset-password', adminController.handleResetCompanyPassword);
router.put('/companies/:id/suspend', adminController.handleSuspendCompany);
router.put('/companies/:id/extend-plan', adminController.handleExtendPlan);
router.delete('/companies/:id/delete', adminController.handleDeleteCompany);

// User Directory Management
router.post('/users', adminController.handleCreateUser);
router.put('/users/:id', adminController.handleUpdateUser);
router.put('/users/:id/extend-plan', adminController.handleExtendPlan);
router.delete('/users/:id', adminController.handleDeleteUser);

// Cross-Tenant Invoices Audit
router.get('/invoices', adminController.handleGetInvoices);
router.put('/invoices/:id/status', adminController.handleUpdateInvoiceStatus);

// Cross-Tenant Support Tickets Queue
router.get('/tickets', adminController.handleGetTickets);
router.post('/tickets', adminController.handleCreateTicket);
router.put('/tickets/:id', adminController.handleUpdateTicket);

// Master Admin Audit Logs
router.get('/audit-logs', adminController.handleGetAuditLogs);

module.exports = router;
