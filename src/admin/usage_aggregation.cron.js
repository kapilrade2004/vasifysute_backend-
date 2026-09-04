const db = require('../../database/db');

/**
 * Nightly Aggregation Cron Task
 * 1. Rolls module_usage_stats into usage_daily_summary
 * 2. Prunes raw module_usage_stats older than 90 days
 */
async function runDailyUsageAggregation() {
  console.log('⏳ Running Nightly Usage Aggregation & Pruning Job...');
  try {
    // 1. Rollup raw stats into usage_daily_summary
    await db.query(`
      INSERT INTO usage_daily_summary (tenant_id, module_key, date, active_users, total_requests, updated_at)
      SELECT 
        tenant_id,
        module_key,
        date,
        COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(active_user_ids, '$[0]'))) as active_users,
        SUM(request_count) as total_requests,
        NOW() as updated_at
      FROM module_usage_stats
      GROUP BY tenant_id, module_key, date
      ON DUPLICATE KEY UPDATE
        active_users = VALUES(active_users),
        total_requests = VALUES(total_requests),
        updated_at = NOW()
    `);

    console.log('✅ Daily usage summary successfully updated.');

    // 2. Prune raw rows older than 90 days
    const [pruneResult] = await db.query(`
      DELETE FROM module_usage_stats 
      WHERE date < DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    `);

    console.log(`🧹 Pruned ${pruneResult.affectedRows || 0} raw stats rows older than 90 days.`);
    return true;
  } catch (err) {
    console.error('❌ Daily Usage Aggregation failed:', err);
    throw err;
  }
}

module.exports = { runDailyUsageAggregation };
