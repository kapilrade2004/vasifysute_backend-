const express = require('express');
const cors = require('cors');
require('dotenv').config();

const userRoutes = require('./routes/user.routes');
const invoiceRoutes = require('./routes/invoice.routes');
const leadsRoutes = require('./routes/leads');
const publicLeadsRoutes = require('./routes/public-leads');
const crmInvoicesRoutes = require('./routes/invoices');
const saasInvoicesRoutes = require('./routes/saas-invoices');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', userRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/public-leads', publicLeadsRoutes);
app.use('/api/crm-invoices', crmInvoicesRoutes);
app.use('/api/saas-invoices', saasInvoicesRoutes);

// Root health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'VT Suite Backend API Services'
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 VT Suite Backend running on http://localhost:${PORT}`);
});
