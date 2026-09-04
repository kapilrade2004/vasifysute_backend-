const express = require('express');
const cors = require('cors');
require('dotenv').config();

// ── Fail-fast env validation ──────────────────────────────────────────────────
const REQUIRED_ENV = ['DB_HOST', 'DB_USER', 'DB_NAME'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`❌ Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example → .env and fill in values.');
  process.exit(1);
}

const userRoutes     = require('./routes/user.routes');
const authRoutes      = require('./routes/auth.routes');
const customerRoutes  = require('./routes/customers.routes');
const invoiceRoutes   = require('./routes/invoice.routes');
const leadsRoutes     = require('./routes/leads.routes');
const dealsRoutes     = require('./routes/deals.routes');
const tasksRoutes     = require('./routes/tasks.routes');
const hrRoutes        = require('./routes/hr.routes');
const projectRoutes   = require('./routes/projects.routes');
const workspaceRoutes = require('./routes/workspace.routes');
const masterAdminRoutes = require('./src/admin/admin.routes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/admin', masterAdminRoutes);

// Root + health check endpoints
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'VasifyTech Suite Unified Backend API Services',
    version: '2.0.0',
    endpoints: [
      '/api/auth',
      '/api/users',
      '/api/customers',
      '/api/leads',
      '/api/deals',
      '/api/tasks',
      '/api/invoices',
      '/api/hr/employees',
      '/api/hr/attendance',
      '/api/hr/leaves',
      '/api/hr/payroll',
      '/api/projects',
      '/api/workspace/events',
      '/api/workspace/tickets',
      '/api/admin'
    ]
  });
});

app.get('/health', async (req, res) => {
  const db = require('./database/db');
  try {
    await db.query('SELECT 1');
    res.json({ status: 'healthy', db: 'connected', ts: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'unhealthy', db: 'disconnected', error: e.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 VT Suite Backend running on http://localhost:${PORT}`);
});
