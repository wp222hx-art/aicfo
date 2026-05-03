#!/usr/bin/env node
// AiCFO AI 健康检测入口脚本
// 用法：node scripts/health-check.js
//      或：npm run health
const { healthCheck } = require('../config/ai.config');

(async () => {
  const r = await healthCheck({ verbose: true });
  // 以 JSON 形式输出详细结果（便于 CI / 监控消费）
  console.log('\n--- 详细结果 (JSON) ---');
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.overall === 'healthy' ? 0 : r.overall === 'missing_credentials' ? 2 : 1);
})();
