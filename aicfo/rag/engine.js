// AiCFO RAG Engine - 4-layer knowledge retrieval (Regulatory / Practice / Pricing / Customer)
// Uses mock embeddings (cosine similarity over 16-dim deterministic vectors) for MVP.
// In production, swap the embed() + search() implementations for BGE-M3 + Qdrant.

const db = require('../backend/db/schema');
const { v4: uuid } = require('uuid');

function embed(text) {
  const vec = new Array(16).fill(0);
  const t = text.toLowerCase();
  for (let i = 0; i < t.length; i++) vec[i % 16] += t.charCodeAt(i) / 255;
  const n = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => +(v / n).toFixed(4));
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

function keywordScore(text, query) {
  const tq = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const tt = text.toLowerCase();
  return tq.reduce((s, w) => s + (tt.includes(w) ? 1 : 0), 0) / Math.max(1, tq.length);
}

// Chunk text into ~400-char segments with overlap
function chunk(text, size = 400, overlap = 80) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + size));
    i += size - overlap;
  }
  return out;
}

function ingest({ layer, source, title, content, metadata = {}, company_id = null }) {
  const docId = `rag_doc_${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO rag_documents (id,layer,source,title,content,metadata,chunk_count,company_id,status)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(
    docId, layer, source, title, content,
    JSON.stringify(metadata), 0, company_id, 'indexed'
  );
  const chunks = chunk(content);
  const stmt = db.prepare(`INSERT INTO rag_chunks
    (id,document_id,layer,content,embedding,token_count,chunk_index) VALUES (?,?,?,?,?,?,?)`);
  chunks.forEach((c, idx) => {
    stmt.run(`chunk_${uuid().slice(0, 8)}`, docId, layer, c,
      JSON.stringify(embed(c)), c.split(/\s+/).length, idx);
  });
  db.prepare(`UPDATE rag_documents SET chunk_count=? WHERE id=?`).run(chunks.length, docId);
  return { docId, chunks: chunks.length };
}

function search({ query, layers = ['L1_regulatory', 'L2_practice', 'L3_pricing', 'L4_customer'], k = 5, company_id = null }) {
  const qVec = embed(query);
  // Pull all chunks in requested layers (small corpus for MVP).
  const placeholders = layers.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT c.*, d.title, d.source, d.metadata, d.company_id AS doc_company
     FROM rag_chunks c JOIN rag_documents d ON c.document_id = d.id
     WHERE c.layer IN (${placeholders})`
  ).all(...layers);

  const scored = rows
    .filter(r => r.layer !== 'L4_customer' || r.doc_company === company_id)
    .map(r => {
      const vec = JSON.parse(r.embedding || '[]');
      const vectorScore = vec.length ? cosine(qVec, vec) : 0;
      const kwScore = keywordScore(r.content, query);
      const hybrid = 0.65 * vectorScore + 0.35 * kwScore;
      return { ...r, vectorScore: +vectorScore.toFixed(4), kwScore: +kwScore.toFixed(4), score: +hybrid.toFixed(4) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return scored.map(s => ({
    chunk_id: s.id,
    document_id: s.document_id,
    layer: s.layer,
    title: s.title,
    source: s.source,
    content: s.content,
    score: s.score,
    vectorScore: s.vectorScore,
    kwScore: s.kwScore
  }));
}

function runTrainingJob({ name, layer, docs, user_id }) {
  const jobId = `job_${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO rag_training_jobs (id,name,layer,status,started_at,created_by,logs)
              VALUES (?,?,?,?,?,?,?)`).run(
    jobId, name, layer, 'running', new Date().toISOString(), user_id,
    JSON.stringify([{ ts: Date.now(), msg: 'Job started' }])
  );

  let totalChunks = 0, totalTokens = 0;
  const logs = [{ ts: Date.now(), msg: 'Job started' }];

  docs.forEach((d, i) => {
    try {
      const r = ingest({ layer, ...d });
      totalChunks += r.chunks;
      totalTokens += d.content.split(/\s+/).length;
      logs.push({ ts: Date.now(), msg: `[${i + 1}/${docs.length}] Ingested "${d.title}" → ${r.chunks} chunks` });
    } catch (e) {
      logs.push({ ts: Date.now(), msg: `[ERROR] ${d.title}: ${e.message}` });
    }
  });

  db.prepare(`UPDATE rag_training_jobs SET status=?, docs_processed=?, chunks_created=?,
              tokens_embedded=?, finished_at=?, logs=? WHERE id=?`).run(
    'completed', docs.length, totalChunks, totalTokens, new Date().toISOString(),
    JSON.stringify(logs), jobId
  );

  return { jobId, docs_processed: docs.length, chunks_created: totalChunks, tokens_embedded: totalTokens };
}

function stats() {
  const layers = db.prepare(`SELECT layer, COUNT(*) as docs FROM rag_documents GROUP BY layer`).all();
  const chunks = db.prepare(`SELECT layer, COUNT(*) as chunks FROM rag_chunks GROUP BY layer`).all();
  const jobs = db.prepare(`SELECT COUNT(*) as n, status FROM rag_training_jobs GROUP BY status`).all();
  const feedback = db.prepare(`SELECT AVG(rating) as avg_rating, COUNT(*) as n FROM rag_feedback`).get();
  return { layers, chunks, jobs, feedback };
}

function submitFeedback({ query, answer, chunk_ids, rating, comment, user_id }) {
  const id = `fb_${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO rag_feedback (id,query,answer,chunk_ids,rating,comment,user_id)
              VALUES (?,?,?,?,?,?,?)`).run(id, query, answer, JSON.stringify(chunk_ids || []), rating, comment, user_id);
  return { id };
}

// Reinforcement: promote high-rated answers into L4 (customer layer) for future recall.
function learnFromFeedback() {
  const rows = db.prepare(`SELECT * FROM rag_feedback WHERE rating >= 4 AND used_for_training = 0`).all();
  let promoted = 0;
  rows.forEach(fb => {
    const title = `High-rated answer: ${fb.query.slice(0, 60)}`;
    ingest({ layer: 'L4_customer', source: 'feedback_loop', title,
      content: `Q: ${fb.query}\n\nA: ${fb.answer}`,
      metadata: { rating: fb.rating, feedback_id: fb.id }
    });
    db.prepare(`UPDATE rag_feedback SET used_for_training=1 WHERE id=?`).run(fb.id);
    promoted++;
  });
  return { promoted };
}

module.exports = { embed, ingest, search, runTrainingJob, stats, submitFeedback, learnFromFeedback, chunk };
