# L3-01 新加坡 CSP/会计服务市场定价基准（2025）

## 1. 公司注册（Incorporation）
| 套餐 | 价格区间（SGD） | 备注 |
|---|---|---|
| 基础注册（Exempt Private Company） | 299 – 699 | 含 ACRA 官费 S$315，名称核查 S$15 |
| 含 Nominee Director | +1,800 – 3,600/年 | 外资非居民必须 |
| 含注册地址 | +180 – 480/年 | 市中心溢价约 30% |

## 2. 公司秘书（Corporate Secretary）
- 基础：S$480 – 900/年（含法定会议纪要 2 次、ACRA 年检 1 次）。
- 股权变更附加：S$180/次。
- EGM/股东决议起草：S$150/份。

## 3. 簿记与账务（Bookkeeping）
| 月均交易量 | 基础月费（SGD） | 说明 |
|---|---|---|
| ≤ 50 笔 | 200 – 350 | Xero/QuickBooks 入账 + 月结 |
| 51 – 150 笔 | 400 – 650 | 含 AP/AR 管理 |
| 151 – 400 笔 | 700 – 1,200 | 含月度管理报告 |
| > 400 笔 | 项目报价 | 通常 2 – 3 SGD/笔 |

## 4. 税务（Tax Compliance）
- ECI + Form C-S 合计：S$600 – 1,200（基础版）；Form C：S$1,500 起。
- GST F5 季度申报：S$250 – 450/次。
- IR8A/IR21：S$45 – 80/员工。

## 5. 年度合规（Annual Return + XBRL）
- Annual Return：S$150 – 350。
- Simplified XBRL：S$300 – 600。
- Full XBRL（大型公司）：S$900 – 1,800。

## 6. 审计（Audit）
- 小型豁免：大多数私人公司满足 S$10M 营收/资产/50 人其中任二条件方需审计。
- 强制审计费：S$3,000 起（营收 S$1M 以下）；S$8,000 – 25,000（营收 S$1 – 10M）。

## 7. AiCFO 定价模型变量
```
最终价 = median_base × complexity_multiplier × region_premium × urgency_premium
```
- complexity_multiplier：股东 1-2 人 1.0；3-5 人 1.15；外资 PR/EP 1.25；VCC 架构 1.80。
- region_premium：本地 1.00；亚洲跨境 1.10；欧美跨境 1.25。
- urgency_premium：标准 1.00；加急 7 天 1.15；48 小时 1.35。

## 8. 数据来源
- ACRA BizFile+ fee schedule 2025-01
- 本地主流 CSP 公开报价（Sleek、Osome、Rikvin、3E Accounting）
- AiCFO 内部成交样本（2024-Q1 至 2025-Q3，n=412）
