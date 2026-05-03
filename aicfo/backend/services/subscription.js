// Subscription & Mock Payment service
const { v4: uuid } = require('uuid');
const db = require('../db/schema');

const PLANS = {
  starter: {
    code: 'starter',
    name: 'Starter 起步版',
    price_sgd: 88,
    billing_cycle: 'monthly',
    features: ['AI 财务记账', 'WhatsApp 专属 Bot', '每月 50 张发票 OCR', 'GST F5 自动生成', '邮件支持']
  },
  growth: {
    code: 'growth',
    name: 'Growth 成长版',
    price_sgd: 288,
    billing_cycle: 'monthly',
    features: ['Starter 全部功能', '无限发票 OCR', 'SFRS 全套 5 大财务报表', 'XBRL 自动生成', 'CPF 月度申报', 'ECI / Form C-S 辅助', '7×10 在线客服']
  },
  enterprise: {
    code: 'enterprise',
    name: 'Enterprise 企业版',
    price_sgd: 888,
    billing_cycle: 'monthly',
    features: ['Growth 全部功能', '多公司合并报表', '审计 / 尽调 Agent', '专属持牌 CSP 顾问', '自定义 RAG 知识库训练', '7×24 优先支持']
  }
};

function listPlans() { return Object.values(PLANS); }

function createSubscription({ user_id, company_id, plan_code }) {
  const plan = PLANS[plan_code];
  if (!plan) return { ok: false, error: 'invalid plan' };
  const id = 'sub_' + uuid().slice(0, 8);
  db.prepare(`INSERT INTO subscription_plans(id,user_id,company_id,plan_code,plan_name,price_sgd,billing_cycle,features,status,created_at)
              VALUES(?,?,?,?,?,?,?,?, 'pending_payment', CURRENT_TIMESTAMP)`)
    .run(id, user_id, company_id, plan.code, plan.name, plan.price_sgd, plan.billing_cycle, JSON.stringify(plan.features));
  return { ok: true, subscription_id: id, plan };
}

function payMock({ user_id, subscription_id, method = 'mock_card', card_last4 = '4242' }) {
  const sub = db.prepare(`SELECT * FROM subscription_plans WHERE id=?`).get(subscription_id);
  if (!sub) return { ok: false, error: 'subscription not found' };
  if (sub.status === 'active') return { ok: true, already: true, subscription: sub };

  const payId = 'pay_' + uuid().slice(0, 8);
  const gatewayRef = 'mock_' + uuid().replace(/-/g, '').slice(0, 16);
  db.prepare(`INSERT INTO payments(id,user_id,subscription_id,amount_sgd,method,status,gateway_ref,paid_at,created_at)
              VALUES(?,?,?,?,?, 'succeeded', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run(payId, user_id, subscription_id, sub.price_sgd, `${method}-${card_last4}`, gatewayRef);

  const expires = new Date(Date.now() + 30 * 86400000).toISOString();
  db.prepare(`UPDATE subscription_plans SET status='active', paid_at=CURRENT_TIMESTAMP, expires_at=? WHERE id=?`)
    .run(expires, subscription_id);

  return { ok: true, payment_id: payId, gateway_ref: gatewayRef, subscription: { ...sub, status: 'active', expires_at: expires } };
}

function getUserSubscription(user_id) {
  return db.prepare(`SELECT * FROM subscription_plans WHERE user_id=? ORDER BY created_at DESC LIMIT 1`).get(user_id);
}

module.exports = { PLANS, listPlans, createSubscription, payMock, getUserSubscription };
