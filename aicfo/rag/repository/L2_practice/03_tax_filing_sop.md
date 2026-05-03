---
layer: L2_practice
source: AiCFO 运营手册 — SOP-TAX-001
title: 税务申报标准作业流程
version: 2025.11
tags: [tax, ECI, Form-CS, GST, withholding]
---

# 税务申报年度时间轴（以 FYE = 12-31 为例）

| 月份 | 事件 | 截止日 | 渠道 |
|------|------|-------|------|
| 1 月 | GST Q4 F5 | 1 月 31 日 | myTax Portal |
| 3 月 | IR8A / IR21 | 3 月 1 日 | AIS |
| 3 月 | ECI（如 FYE 12-31） | 3 月 31 日 | myTax Portal |
| 4 月 | GST Q1 F5 | 4 月 30 日 | myTax Portal |
| 6 月 | AGM 召开（首次） | FYE+6 月 | — |
| 7 月 | GST Q2 F5 | 7 月 31 日 | myTax Portal |
| 7 月 | AR 提交（如 AGM 在 6 月） | AGM+30 日 | BizFile+ |
| 10 月 | GST Q3 F5 | 10 月 31 日 | myTax Portal |
| 11 月 | Form C-S / C | 11 月 30 日 | myTax Portal |

## ECI 计算流程
1. 拉取 YTD P&L（Bookkeeping Agent 已生成）
2. 调整：不可扣除支出（罚款、招待 50%+、私人车辆）、不应税收入（股息、资本利得）
3. 应用 SUTE / PTE 免税
4. 应税收入 × 17%
5. 输出 ECI 预估值 + 法条引用 + 置信度

## Form C-S 准备清单
- [ ] 审计/未审计财务报表
- [ ] 详细利润表（Profit & Loss Schedule）
- [ ] 固定资产登记册与折旧计算（按 IRAS 资本减免规则）
- [ ] 研发支出申请 Enhanced Deduction（2024 IIT：100% + 400% 上限 S$400K）
- [ ] GST 调节（若已注册）

## GST F5 编制流程
1. Trial Balance → 过滤 GST 科目（2100/2200）
2. 销售：按 Zero / Standard / Exempt 分类
3. 进项税抵扣：仅限业务用途、有 tax invoice、7%+ GST line
4. Box 1-8 填列
5. 提交前 Reflexion 校验：Box 4 = Box 1 + 2 + 3，Box 8 = Box 6 − 7

## 预扣税（Withholding Tax）
- 支付给非居民的利息、特许权使用费、服务费需预扣
- 典型税率：10%（利息、特许权使用费）、17%（董事酬劳、技术服务）
- 截止：付款后次月 15 日（Form IR37）
