// ================================================================================
// AiCFO · Billing Gate (付费门禁 / Paywall Middleware)
// ================================================================================
// 核心业务规则: 用户付完费, 才能进入真正的记账、报税、财务服务
//
// 提供:
//   1. checkoutOrder(orderId)        — 创建支付会话 (mock / stripe)
//   2. markPaid(orderId, paymentId)  — 标记付款成功 (Stripe webhook 或 mock)
//   3. requirePaid(req, res, next)   — Express 中间件, 从 company_id 推断付费状态
//   4. companyActivationStatus(id)   — 查询公司当前激活状态 (draft | paid | live)
//
// 激活状态机:
//   draft   → 未付款 / 未提交 (只能用注册流程的前 6 关)
//   paid    → 已付款 (解锁 Bookkeeping / Invoices, 但 UEN 未下发, Tax 还没激活)
//   live    → 已下发 UEN + FYE 首周期开始 (所有 Tax/GST/CPF/AR 功能解锁)
//   suspended → 欠费 / 违规 (只读)
// ================================================================================

const { v4: uuid } = require('uuid');
const db = require('../db/schema');

// --------------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------------
function getConfig() {
  const row = db.prepare(`SELECT value FROM system_settings WHERE key='billing_config'`).get();
  const defaults = {
    mode: 'mock',                    // mock | stripe
    currency: 'SGD',
    stripe: { publishable_key: '', secret_key: '', webhook_secret: '' },
    success_url: '/#/order',
    cancel_url: '/#/dashboard'
  };
  if (!row) return defaults;
  try { return { ...defaults, ...JSON.parse(row.value) }; } catch { return defaults; }
}

function setConfig(patch) {
  const cur = getConfig();
  const next = { ...cur, ...patch };
  db.prepare(`INSERT INTO system_settings (key,value) VALUES ('billing_config', ?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify(next));
  return next;
}

// --------------------------------------------------------------------------------
// Create checkout session
// --------------------------------------------------------------------------------
async function checkoutOrder(orderId) {
  const order = db.prepare(`SELECT * FROM registration_orders WHERE id=?`).get(orderId);
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.payment_status === 'paid') {
    return { ok: true, already_paid: true, order_id: orderId, paid_at: order.paid_at };
  }

  const cfg = getConfig();
  const paymentId = `pay_${uuid().slice(0, 10)}`;
  const amount = Number(order.price_sgd || 388);

  // Insert into payments table (使用 payments 表实际列: user_id, amount_sgd, method, status, gateway_ref)
  db.prepare(`INSERT INTO payments (id, user_id, amount_sgd, method, status, gateway_ref, created_at)
              VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .run(paymentId, order.user_id, amount, cfg.mode, 'processing', orderId);

  db.prepare(`UPDATE registration_orders SET payment_status='processing', stripe_payment_intent=? WHERE id=?`)
    .run(paymentId, orderId);

  if (cfg.mode === 'stripe' && cfg.stripe.secret_key) {
    // TODO: 真实 Stripe Checkout Session 创建位点
    return {
      ok: true,
      order_id: orderId,
      payment_id: paymentId,
      amount, currency: cfg.currency,
      mode: 'stripe',
      checkout_url: `https://checkout.stripe.com/pay/${paymentId}`,
      expires_in: 1800
    };
  }

  // Mock checkout: 返回一个"收银台"页面占位, 用户可立刻调 /api/billing/:id/mock-pay 完成
  return {
    ok: true,
    order_id: orderId,
    payment_id: paymentId,
    amount, currency: cfg.currency,
    mode: 'mock',
    checkout_url: `/mock-checkout.html?payment_id=${paymentId}&order_id=${orderId}&amount=${amount}`,
    mock_confirm_endpoint: `/api/billing/orders/${orderId}/mock-pay`,
    expires_in: 1800
  };
}

// --------------------------------------------------------------------------------
// Mark paid (called by Stripe webhook OR /mock-pay)
// --------------------------------------------------------------------------------
function markPaid(orderId, paymentId) {
  const order = db.prepare(`SELECT * FROM registration_orders WHERE id=?`).get(orderId);
  if (!order) return { ok: false, error: 'Order not found' };

  const now = new Date().toISOString();
  db.prepare(`UPDATE payments SET status='succeeded', paid_at=? WHERE id=?`).run(now, paymentId);
  db.prepare(`UPDATE registration_orders SET payment_status='paid', paid_at=? WHERE id=?`).run(now, orderId);

  // Company: draft → paid
  db.prepare(`UPDATE companies SET activation_status='paid' WHERE id=? AND activation_status='draft'`)
    .run(order.company_id);

  // Gate G7 自动通过
  const gates = JSON.parse(order.gates || '{}');
  gates.G7_payment = { status: 'passed', at: now, actor: 'billing-gate', artifact_id: paymentId };
  db.prepare(`UPDATE registration_orders SET gates=? WHERE id=?`).run(JSON.stringify(gates), orderId);

  return { ok: true, order_id: orderId, payment_id: paymentId, paid_at: now,
           company_id: order.company_id, activation_status: 'paid' };
}

// --------------------------------------------------------------------------------
// Activate (when UEN issued — company goes paid → live)
// --------------------------------------------------------------------------------
function activateCompany(companyId) {
  const row = db.prepare(`SELECT activation_status, uen FROM companies WHERE id=?`).get(companyId);
  if (!row) return { ok: false, error: 'Company not found' };
  if (!row.uen) return { ok: false, error: 'UEN not yet issued' };
  if (row.activation_status === 'draft') return { ok: false, error: 'Company not yet paid' };
  db.prepare(`UPDATE companies SET activation_status='live' WHERE id=?`).run(companyId);
  return { ok: true, company_id: companyId, activation_status: 'live' };
}

// --------------------------------------------------------------------------------
// Query: company activation status
// --------------------------------------------------------------------------------
function companyActivationStatus(companyId) {
  const row = db.prepare(`SELECT id, uen, activation_status FROM companies WHERE id=?`).get(companyId);
  if (!row) return { ok: false, error: 'Company not found' };
  return {
    ok: true,
    company_id: row.id,
    uen: row.uen || null,
    activation_status: row.activation_status || 'draft',
    can_bookkeeping: ['paid', 'live'].includes(row.activation_status),
    can_tax_filing:  row.activation_status === 'live' && !!row.uen,
    can_payroll:     row.activation_status === 'live'
  };
}

// --------------------------------------------------------------------------------
// Middleware: requirePaid(feature)
// feature: 'bookkeeping' | 'tax' | 'payroll'
// --------------------------------------------------------------------------------
function requirePaid(feature = 'bookkeeping') {
  return (req, res, next) => {
    // 允许从 query 或 body 传 company_id
    const companyId = req.query.company_id || req.body?.company_id || req.params.company_id;
    if (!companyId) {
      // 没有 company_id 的读接口放行 (会返回空列表)
      return next();
    }
    const s = companyActivationStatus(companyId);
    if (!s.ok) return res.status(404).json({ error: s.error, code: 'COMPANY_NOT_FOUND' });

    let allowed = false;
    if (feature === 'bookkeeping') allowed = s.can_bookkeeping;
    else if (feature === 'tax')    allowed = s.can_tax_filing;
    else if (feature === 'payroll')allowed = s.can_payroll;
    else allowed = true;

    if (!allowed) {
      return res.status(402).json({
        error: 'Payment required to unlock this feature',
        code: 'PAYMENT_REQUIRED',
        feature,
        company_id: companyId,
        activation_status: s.activation_status,
        uen: s.uen,
        hint: s.activation_status === 'draft'
          ? '请先完成注册流程并支付注册费 (进入 流程图页面 → 第 7 关 Payment)'
          : feature === 'tax'
            ? '公司尚未下发 UEN, 税务功能将在 ACRA 核发 UEN 后自动解锁'
            : '请联系客服激活此功能',
        checkout_url: `/#/regFlow?company=${companyId}`
      });
    }
    next();
  };
}

module.exports = {
  getConfig, setConfig,
  checkoutOrder, markPaid, activateCompany,
  companyActivationStatus, requirePaid
};
