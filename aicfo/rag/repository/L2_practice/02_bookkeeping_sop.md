---
layer: L2_practice
source: AiCFO 运营手册 — SOP-BOOK-001
title: 月结账务标准作业流程
version: 2025.11
tags: [bookkeeping, month-end-close, reconciliation, journal]
---

# 月结账务 SOP

## Day 1-3（次月初）—— 数据归集
1. **银行流水**：API 拉取（DBS IDEAL / UOB Infinity）或 CSV 上传
2. **发票**：邮件转发到 `invoices@<tenant>.aicfo.sg`，自动 OCR
3. **费用报销**：员工提交 → Expense Agent 审批
4. **工资单**：HR 系统导出 → Payroll Agent 计算 CPF/SDL

## Day 4-6 —— AI 自动分录
- Bookkeeping Agent 逐笔生成分录（借贷+科目代码）
- 置信度 ≥ 0.92：自动入账
- 置信度 0.75–0.92：标记「To Review」
- 置信度 < 0.75：升级人工

## Day 7-9 —— 对账
- 银行对账（Cash 1000）：账面余额 ≡ 银行对账单
- AR/AP 对账：应收 1100、应付 2000
- GST 中间科目对账：进项 2100 + 销项 2200

## Day 10 —— 月报表生成
- P&L（损益表）
- Balance Sheet（资产负债表）
- Cash Flow（现金流量表，间接法）
- Aging Report（应收账龄）

## Day 12 —— 管理层复盘
- 与 Budget/Forecast 对比
- 现金跑道（Runway）更新
- 主要波动分析

## 科目表（COA）— 新加坡中小企业精简版
| 代码 | 科目 | 类型 |
|------|------|------|
| 1000 | 银行存款 | Current Asset |
| 1100 | 应收账款 | Current Asset |
| 1500 | 固定资产 | Non-Current Asset |
| 2000 | 应付账款 | Current Liability |
| 2100 | GST 进项 | Current Asset (contra-liability) |
| 2200 | GST 销项 | Current Liability |
| 2300 | 应付工资 | Current Liability |
| 2400 | 应缴 CPF | Current Liability |
| 3000 | 股本 | Equity |
| 3500 | 留存收益 | Equity |
| 4000 | 营业收入 | Revenue |
| 5000 | 营业成本 | Expense |
| 5100 | 员工成本 | Expense |
| 5200 | 租金 | Expense |
| 5300 | IT/SaaS | Expense |
| 5400 | 营销 | Expense |
| 5500 | 专业服务 | Expense |
| 5900 | 利息支出 | Expense |
| 6000 | 所得税 | Expense |
