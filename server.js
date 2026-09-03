const express = require('express');
const cors = require('cors');
require('dotenv').config();

const userRoutes = require('./routes/user.routes');
const invoiceRoutes = require('./routes/invoice.routes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', userRoutes);
app.use('/api/invoices', invoiceRoutes);

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
