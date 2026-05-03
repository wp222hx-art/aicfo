// ================================================================================
// AiCFO 文件上传与解析服务
// ================================================================================
// 支持：
//   • PDF（合同、章程、财务报表、税票）
//   • Excel / CSV（银行流水、账目、发票清单）
//   • TXT / MD（法规条款、SOP）
//   • 图片发票（走 GPT-4 式多模态 OCR，回退到 schema 解析）
// 出口：
//   • parseBuffer(buffer, mimeOrExt) -> { text, rows?, format }
//   • ingestAsRagDoc({buffer, filename, mime, layer, title, company_id})
//   • extractInvoiceWithAI(text, opts) -> 结构化发票
//   • extractTransactionsWithAI(text, opts) -> 结构化流水
// ================================================================================
const path = require('path');
const rag  = require('../../rag/engine');
const gateway = require('./llm-gateway');

let xlsx;       try { xlsx = require('xlsx'); }           catch (_) { xlsx = null; }
let pdfParse;   try { pdfParse = require('pdf-parse'); }  catch (_) { pdfParse = null; }
let csvParse;   try { csvParse = require('csv-parse/sync'); } catch (_) { csvParse = null; }

function client() {
  if (process.env.AICFO_LLM_OFFLINE === '1') return null;
  return gateway.getClient();
}

// --------------------------------------------------------------------------------
// 1. 缓冲区 → 纯文本 / 表格行
// --------------------------------------------------------------------------------
function detectFormat(filename, mime) {
  const ext = (path.extname(filename || '').replace('.', '') || '').toLowerCase();
  if (['pdf'].includes(ext) || /pdf/i.test(mime || '')) return 'pdf';
  if (['xlsx','xls'].includes(ext) || /spreadsheetml|excel/i.test(mime || '')) return 'xlsx';
  if (['csv'].includes(ext) || /csv/i.test(mime || '')) return 'csv';
  if (['txt','md','log'].includes(ext) || /text\//i.test(mime || '')) return 'text';
  if (['png','jpg','jpeg','webp'].includes(ext) || /image\//i.test(mime || '')) return 'image';
  return 'unknown';
}

async function parseBuffer(buffer, filename, mime) {
  const fmt = detectFormat(filename, mime);
  if (fmt === 'pdf' && pdfParse) {
    const r = await pdfParse(buffer);
    return { format: fmt, text: r.text || '', pages: r.numpages, info: r.info };
  }
  if (fmt === 'xlsx' && xlsx) {
    const wb = xlsx.read(buffer, { type: 'buffer' });
    const sheets = {};
    let allText = '';
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
      sheets[name] = rows;
      allText += `\n## Sheet: ${name}\n` + xlsx.utils.sheet_to_csv(ws);
    });
    return { format: fmt, text: allText, sheets };
  }
  if (fmt === 'csv' && csvParse) {
    const text = buffer.toString('utf8');
    const rows = csvParse.parse(text, { columns: true, skip_empty_lines: true, trim: true });
    return { format: fmt, text, rows };
  }
  if (fmt === 'text') {
    return { format: fmt, text: buffer.toString('utf8') };
  }
  if (fmt === 'image') {
    // 直接把 base64 交给 AI 提取（下游 extractInvoiceWithAI 处理）
    return { format: fmt, text: '', base64: buffer.toString('base64'), mime };
  }
  // 兜底：尝试当文本
  try { return { format: 'text', text: buffer.toString('utf8') }; }
  catch (_) { return { format: 'unknown', text: '' }; }
}

// --------------------------------------------------------------------------------
// 2. 将任意文本/PDF/TXT 注入为 RAG 文档
// --------------------------------------------------------------------------------
async function ingestAsRagDoc({ buffer, filename, mime, layer = 'L4_customer', title, company_id = null }) {
  const parsed = await parseBuffer(buffer, filename, mime);
  const text = (parsed.text || '').trim();
  if (!text || text.length < 50) throw new Error('无法从文件提取有效文本（过短或格式不支持）');
  const r = rag.ingest({
    layer, source: `upload/${filename}`,
    title: title || filename || 'uploaded-doc',
    content: text,
    metadata: { uploaded_at: new Date().toISOString(), format: parsed.format, mime },
    company_id
  });
  return { ...r, format: parsed.format, chars: text.length };
}

// --------------------------------------------------------------------------------
// 3. AI 结构化抽取：发票 / 税票
// --------------------------------------------------------------------------------
async function extractInvoiceWithAI({ text, base64, mime, hint_vendor } = {}) {
  const c = client();
  const sysPrompt = `你是新加坡会计票据信息提取器。仅输出 JSON，字段：
{vendor_name, invoice_number, issue_date(YYYY-MM-DD), due_date, currency, subtotal, gst_rate, gst_amount, total, line_items:[{desc, qty, unit_price, amount}], gst_box_guess, confidence(0-1)}
规则：GST 9% 自 2024-01；若 vendor_name 含 "GST Reg No"/"GST#" 视为 GST-registered；若识别不到 gst_amount 但 total 含税，按 9/109 倒推。`;
  if (!c) {
    // 离线兜底：基于正则抽取
    const out = { vendor_name: hint_vendor || '(unknown)', invoice_number: null, issue_date: null,
      currency: 'SGD', subtotal: 0, gst_rate: 0.09, gst_amount: 0, total: 0, line_items: [], confidence: 0.4 };
    const amt = (text || '').match(/(?:total|合计)[^\d]*([\d,]+\.\d{2})/i);
    if (amt) { out.total = parseFloat(amt[1].replace(/,/g, '')); out.subtotal = +(out.total / 1.09).toFixed(2); out.gst_amount = +(out.total - out.subtotal).toFixed(2); }
    const inv = (text || '').match(/(?:inv(?:oice)?[\s#:-]*)([A-Z0-9\-/]{3,})/i);
    if (inv) out.invoice_number = inv[1];
    return out;
  }
  const userContent = base64
    ? [
        { type: 'text',      text: `请解析以下发票图片（vendor 提示: ${hint_vendor || 'unknown'}）。` },
        { type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,${base64}` } }
      ]
    : `请解析以下发票文本（vendor 提示: ${hint_vendor || 'unknown'}）：\n\n${(text || '').slice(0, 6000)}`;

  const r = await gateway.chat({
    messages: [
      { role: 'system', content: sysPrompt + '\n\n仅输出一个 JSON 对象，不要 markdown 代码块。' },
      { role: 'user',   content: userContent }
    ],
    purpose: 'invoice_ocr',  // → tier_by_purpose 默认 fast
    json: true
  });
  const raw = r.content || '{}';
  try { return JSON.parse(raw); }
  catch (_) { return { _raw: raw, _error: 'json_parse_failed', confidence: 0 }; }
}

// --------------------------------------------------------------------------------
// 4. AI 结构化抽取：银行流水 / 交易表
// --------------------------------------------------------------------------------
async function extractTransactionsWithAI({ text, rows } = {}) {
  const c = client();
  // 如果已有结构化 rows，直接归一化
  if (rows && rows.length) {
    return rows.map((r, i) => {
      const pickKey = (k) => {
        const hit = Object.keys(r).find(x => new RegExp(k, 'i').test(x));
        return hit ? r[hit] : null;
      };
      const date = pickKey('date|日期');
      const amt  = pickKey('amount|debit|credit|金额');
      const desc = pickKey('desc|narrat|detail|摘要|description');
      return {
        row: i + 1,
        date: date ? String(date).slice(0, 10) : new Date().toISOString().slice(0, 10),
        amount: parseFloat(String(amt || 0).replace(/[,\s]/g, '')) || 0,
        description: String(desc || ''),
        counterparty: String(desc || '').split(/\s|-/)[0]
      };
    });
  }
  if (!c || !text) return [];
  const r = await gateway.chat({
    messages: [
      { role: 'system', content: '你是银行对账单解析器。仅输出 JSON：{"rows":[{date,amount(+收/-支),description,counterparty}]}，不要 markdown。' },
      { role: 'user',   content: (text || '').slice(0, 8000) }
    ],
    purpose: 'ocr',
    json: true
  });
  try {
    const j = JSON.parse(r.content || '{}');
    return Array.isArray(j.rows) ? j.rows : [];
  } catch (_) { return []; }
}

module.exports = {
  parseBuffer, detectFormat,
  ingestAsRagDoc,
  extractInvoiceWithAI, extractTransactionsWithAI,
  isReady: () => !!client()
};
