const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'vasifytech_super_secret_jwt_key_2026';

function verifyTokenPayload(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Mandatory Auth Middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers['x-auth-token'];
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
      error: 'Authentication token required.',
      message: 'Authentication token required.'
    });
  }

  const decoded = verifyTokenPayload(token);
  if (!decoded) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token.',
      message: 'Invalid or expired token.'
    });
  }

  req.user = decoded;
  req.userId = decoded.id;
  next();
}

// Optional Auth Middleware (attaches user if present, proceeds either way)
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers['x-auth-token'];
  let token = null;

  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
    }
  }

  if (token) {
    const decoded = verifyTokenPayload(token);
    if (decoded) {
      req.user = decoded;
      req.userId = decoded.id;
    }
  }

  next();
}

module.exports = {
  requireAuth,
  optionalAuth,
  JWT_SECRET
};
