---
layer: L2_practice
source: AiCFO 运营手册 — SOP-REG-001
title: 新加坡 Pte Ltd 注册标准作业流程（SOP）
version: 2025.11
tags: [registration, SOP, BizFile+, constitution]
---

# 新加坡 Pte Ltd 注册 SOP（AiCFO 推荐流程）

## Stage 0 — 预检（≤ 30 秒，全 AI）
1. 名称合规（ACRA Name Search）
   - 禁用词：bank, finance, insurance, solicitor, temasek, MAS, ACRA 等（持牌方可用）
   - 敏感词：capital, trust, fund（触发人工复核）
2. SSIC 行业代码推荐（基于业务描述 → 匹配官方 2020 版 SSIC）
3. 实控人架构初筛（股东 > 20 人则不适用 Pte Ltd，需 Ltd）

## Stage 1 — 数据采集（≤ 5 分钟）
- 公司基本信息：名称、SSIC、FYE、实缴资本、业务描述
- 股东/董事：姓名、国籍、NRIC/FIN/护照、持股比例
- 注册地址（不可 PO Box；若使用 AiCFO 地址服务需签署 Address Use Agreement）

## Stage 2 — KYC（并行执行，≤ 3 分钟/人）
- SG 本地：Singpass OAuth → MyInfo 自动填充（IDV confidence ≥ 0.98）
- 外国人：护照 OCR + 活体检测 + AML 筛查（Dow Jones）
- UBO ≥ 25% 自动标记
- 任何命中：升级 CSP 人审

## Stage 3 — 章程生成（≤ 1 分钟）
- 使用 ACRA Model Constitution 模板 + AI 定制条款
- 默认：1 股 = 1 票，无优先股；股东同意可修改
- 输出双语（EN + 中文草案用于客户理解，正式版仅 EN）

## Stage 4 — BizFile+ 提交（RPA / API）
- 材料清单：NRIC 副本、章程、Form 45（董事同意书）、Form 24（股份分配表）
- 政府费用：S$315（名称 S$15 + 注册 S$300）
- 通常审批时长：15 分钟 – 60 分钟；涉及敏感 SSIC 需 14 天

## Stage 5 — 后成立（UEN 下达后）
- 注册银行账户（DBS / UOB / OCBC 电子开户优先）
- 公司印章（可选，Singapore 非强制）
- 任命公司秘书（成立后 6 个月内强制）
- 注册 CorpPass（政府服务数字证书）
- GST 评估：若预计年营业额 > S$1M 须注册

## 价格参考（AiCFO 2025 定价）
| 档位 | 注册费 | 年秘书 | GST 季申报 |
|------|-------|-------|-----------|
| 基础版 | S$388 | S$600/年 | S$80/季 |
| 专业版 | S$588 | S$1,200/年 | S$150/季 |
| 企业版 | S$1,888+ | Custom | Custom |
