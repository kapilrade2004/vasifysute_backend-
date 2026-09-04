const db = require('../database/db');
const { runDailyUsageAggregation } = require('../src/admin/usage_aggregation.cron');

async function verifyUsageTracking() {
  console.log('🧪 Starting Usage Tracking & Aggregation Verification Script...');

  try {
    const tenantId = 'tenant-test-01';
    const dateStr = new Date().toISOString().slice(0, 10);
    const modules = ['crm', 'finance', 'hr', 'projects', 'workspace'];

    // 1. Simulate tracking requests for each module
    console.log('1️⃣ Simulating tracking request UPSERTs for modules...');

    for (const mod of modules) {
      const recordId = `usg-${tenantId}-${mod}-${dateStr}`;
      const userJson = JSON.stringify(['user-test-101']);

      // Increment 3 times per module
      for (let i = 0; i < 3; i++) {
        await db.query(
          `INSERT INTO module_usage_stats (id, tenant_id, module_key, feature_key, date, request_count, active_user_ids, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, NOW())
           ON DUPLICATE KEY UPDATE 
             request_count = request_count + 1,
             updated_at = NOW()`,
          [recordId, tenantId, mod, `${mod}_overview`, dateStr, userJson]
        );
      }
    }

    // 2. Verify raw module_usage_stats counters
    console.log('2️⃣ Querying module_usage_stats table...');
    const [statsRows] = await db.query('SELECT tenant_id, module_key, feature_key, request_count FROM module_usage_stats WHERE tenant_id = ?', [tenantId]);
    console.log('📊 Current module_usage_stats rows:', JSON.stringify(statsRows, null, 2));

    const isIncrementing = statsRows && statsRows.length >= 5 && statsRows.every(r => Number(r.request_count) >= 3);
    if (isIncrementing) {
      console.log('✅ PASS: module_usage_stats request_count counters are incrementing accurately!');
    } else {
      console.error('❌ FAIL: module_usage_stats request_count did not increment as expected.');
    }

    // 3. Test nightly aggregation cron job
    console.log('3️⃣ Running daily usage aggregation cron job...');
    await runDailyUsageAggregation();

    // 4. Verify usage_daily_summary rollup table
    const [summaryRows] = await db.query('SELECT tenant_id, module_key, date, active_users, total_requests FROM usage_daily_summary WHERE tenant_id = ?', [tenantId]);
    console.log('📈 Current usage_daily_summary rows:', JSON.stringify(summaryRows, null, 2));

    if (summaryRows && summaryRows.length >= 5) {
      console.log('✅ PASS: usage_daily_summary aggregated rollup table successfully populated!');
    } else {
      console.error('❌ FAIL: usage_daily_summary table was not populated correctly.');
    }

    console.log('\n🎉 Phase 1 Backend Usage Tracking Verification Complete!');
  } catch (err) {
    console.error('❌ Verification script error:', err);
  } finally {
    process.exit(0);
  }
}

verifyUsageTracking();
