#!/usr/bin/env node
// ================================================================================
// AiCFO RAG 标准学习仓库种子加载器
// ================================================================================
// 扫描 rag/repository/{L1_regulatory,L2_practice,L3_pricing,L4_customer}/*.md
// 将每篇文档通过 rag/engine.ingest() 注入到 sqlite 数据库
// 首次启动或 --reset 时会清空再重建
// ================================================================================
const fs = require('fs');
const path = require('path');
const db = require('../backend/db/schema');
const rag = require('../rag/engine');

const REPO_ROOT = path.join(__dirname, '..', 'rag', 'repository');
const LAYERS = {
  L1_regulatory: 'L1_regulatory',
  L2_practice:   'L2_practice',
  L3_pricing:    'L3_pricing',
  L4_customer:   'L4_customer'
};

function shouldReset() {
  return process.argv.includes('--reset');
}

function resetCorpus() {
  console.log('🧹 重置 RAG 语料库 ...');
  db.prepare('DELETE FROM rag_chunks').run();
  db.prepare('DELETE FROM rag_documents').run();
}

function seed() {
  if (shouldReset()) resetCorpus();

  let total = 0;
  const byLayer = {};

  for (const [dir, layer] of Object.entries(LAYERS)) {
    const folder = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(folder)) continue;

    const files = fs.readdirSync(folder).filter(f => f.endsWith('.md'));
    byLayer[layer] = 0;

    for (const f of files) {
      const full = path.join(folder, f);
      const content = fs.readFileSync(full, 'utf8');
      const firstLine = content.split('\n')[0].replace(/^#\s*/, '').trim();
      const title = firstLine || f.replace(/\.md$/, '');
      const source = `rag/repository/${dir}/${f}`;

      // L4 客户资料默认绑定 Skyhawk demo company
      const company_id = layer === 'L4_customer' ? 'co_skyhawk_001' : null;

      // 去重：若已存在同 source + 未 reset，则跳过
      const exist = db.prepare('SELECT id FROM rag_documents WHERE source = ?').get(source);
      if (exist && !shouldReset()) {
        console.log(`  ↩  跳过（已索引）: ${source}`);
        continue;
      }
      if (exist && shouldReset()) {
        // 理论上 resetCorpus 已清空，此处兜底
        db.prepare('DELETE FROM rag_documents WHERE id = ?').run(exist.id);
      }

      const r = rag.ingest({
        layer, source, title, content,
        metadata: { file: f, ingested_at: new Date().toISOString() },
        company_id
      });
      total++;
      byLayer[layer]++;
      console.log(`  ✓ [${layer}] ${title} → ${r.chunks} chunks`);
    }
  }

  console.log('\n📊 RAG 语料库加载汇总:');
  for (const [k, v] of Object.entries(byLayer)) console.log(`   ${k}: ${v} 篇`);
  console.log(`   合计: ${total} 篇\n`);

  // 快速一致性检查
  const docs = db.prepare('SELECT COUNT(*) c FROM rag_documents').get().c;
  const chunks = db.prepare('SELECT COUNT(*) c FROM rag_chunks').get().c;
  console.log(`✅ DB 状态: rag_documents=${docs}, rag_chunks=${chunks}`);

  return { total, byLayer, docs, chunks };
}

if (require.main === module) {
  try {
    const r = seed();
    console.log('\n🎉 RAG 学习仓库已就绪。用法：');
    console.log('   • 增量加载: node scripts/rag-seed.js');
    console.log('   • 全量重建: node scripts/rag-seed.js --reset');
    process.exit(r.total >= 0 ? 0 : 1);
  } catch (e) {
    console.error('❌ RAG 种子加载失败:', e);
    process.exit(1);
  }
}

module.exports = { seed };
