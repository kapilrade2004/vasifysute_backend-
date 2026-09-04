const jwt = require('jsonwebtoken');

// Distinct ADMIN_JWT_SECRET environment variable for Master Admin authentication
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'vt_master_admin_jwt_secret_key_2026_x893#';

// In-memory rate limiting map for /api/admin/login (IP -> { count, resetTime })
const loginAttempts = new Map();

/**
 * Rate Limiter middleware for Admin Login
 * Limits max 5 login attempts per 15 minutes per IP address
 */
const loginRateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;

  const record = loginAttempts.get(ip);

  if (record) {
    if (now > record.resetTime) {
      loginAttempts.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (record.count >= maxAttempts) {
      const minutesRemaining = Math.ceil((record.resetTime - now) / 60000);
      return res.status(429).json({
        success: false,
        error: `Too many login attempts. Please try again after ${minutesRemaining} minute(s).`
      });
    }

    record.count += 1;
  } else {
    loginAttempts.set(ip, { count: 1, resetTime: now + windowMs });
  }

  next();
};

/**
 * Middleware to verify Master Admin JWT Token
 * Token must be signed with ADMIN_JWT_SECRET
 */
const verifyAdminToken = (req, res, next) => {
  const authHeader = req.headers['authorization'] || req.headers['x-admin-token'];
  let token = null;

  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
    }
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access denied. Master Admin authorization token is missing.'
    });
  }

  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    if (!decoded || !decoded.adminId || !decoded.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired Master Admin session token.'
      });
    }

    req.admin = {
      id: decoded.adminId,
      name: decoded.name,
      email: decoded.email,
      role: decoded.role
    };

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Session expired or invalid Master Admin authorization token.'
    });
  }
};

/**
 * Role-Based Access Control middleware for Master Admin roles
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: '${req.admin.role}' role does not have permission to execute this action.`
      });
    }

    next();
  };
};

module.exports = {
  ADMIN_JWT_SECRET,
  loginRateLimiter,
  verifyAdminToken,
  requireRole
};
