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

// Platform Telemetry
router.get('/stats', adminController.handleGetStats);

// Tenant Companies Management
router.get('/companies', adminController.handleGetCompanies);
router.get('/companies/:id', adminController.handleGetCompanyById);
router.put('/companies/:id/suspend', adminController.handleSuspendCompany);
router.put('/companies/:id/extend-plan', adminController.handleExtendPlan);
router.put('/users/:id/extend-plan', adminController.handleExtendPlan);
router.delete('/companies/:id/delete', adminController.handleDeleteCompany);

// Cross-Tenant Audits & Queue
router.get('/invoices', adminController.handleGetInvoices);
router.get('/tickets', adminController.handleGetTickets);

// Master Admin Audit Logs
router.get('/audit-logs', adminController.handleGetAuditLogs);

module.exports = router;
