const db = require('../../database/db');
const crypto = require('crypto');

/**
 * Non-blocking usage tracking middleware
 * Hooks into res.on('finish') to execute asynchronous fire-and-forget UPSERT
 * without delaying client HTTP response.
 */
function usageTracker(moduleKey, featureKeyOverride = null) {
  return (req, res, next) => {
    // Continue request execution immediately
    next();

    // Hook into response finish event
    res.on('finish', () => {
      // Only track successful or client responses (status < 400)
      if (res.statusCode >= 400) return;

      setImmediate(async () => {
        try {
          // Determine tenant ID and user ID
          const tenantId = req.user?.company_id || req.user?.tenant_id || req.user?.id || req.headers['x-tenant-id'] || 'tenant-default';
          const userId = req.user?.id ? String(req.user.id) : 'anonymous';
          
          // Determine feature key from endpoint path or override
          const featureKey = featureKeyOverride || req.route?.path || req.path || 'general';
          const dateStr = new Date().toISOString().slice(0, 10);
          
          const recordId = `usg-${tenantId}-${moduleKey}-${dateStr}`.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 60);
          const activeUsersJson = JSON.stringify([userId]);

          await db.query(
            `INSERT INTO module_usage_stats (id, tenant_id, module_key, feature_key, date, request_count, active_user_ids, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, NOW())
             ON DUPLICATE KEY UPDATE 
               request_count = request_count + 1,
               updated_at = NOW()`,
            [recordId, tenantId, moduleKey, featureKey, dateStr, activeUsersJson]
          );
        } catch (err) {
          console.warn('[UsageTracker] Tracking UPSERT error:', err.message);
        }
      });
    });
  };
}

module.exports = usageTracker;
