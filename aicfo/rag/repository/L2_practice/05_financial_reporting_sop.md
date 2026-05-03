# SOP-05 财务报表生成标准作业流程（SFRS for SE）

- 适用范围：小型实体（Small Entity）按 SFRS for SE 编制一般目的财务报表（GPFS）。
- 法定依据：Companies Act 1967 第 201 条；ACRA Simplified XBRL；SFRS for Small Entities。

## 1. 月结作业顺序
1. 银行对账（bank_reconcile）。
2. 应收/应付账龄分析（ageing_ar / ageing_ap）。
3. 折旧与摊销（depreciation_run）——直线法，残值 0。
4. 应计与递延（accruals / prepayments）。
5. 外币重估（fx_revalue）——月末按 MAS 中间价。
6. 关账：锁定期间，禁止回填。
7. 试算表（Trial Balance）——借贷必须平衡，差异 < S$0.5。

## 2. 五大报表生成规则
| 报表 | 关键科目映射 |
|---|---|
| **Profit and Loss** | Revenue, Cost of Sales, Gross Profit, Operating Expenses, EBITDA, Finance Cost, Tax Expense, Net Profit |
| **Balance Sheet** | 资产 = 负债 + 权益（偏差 < S$0.5） |
| **Cash Flow (Indirect)** | 经营 = 净利 + 折旧 ± 营运资本变动；投资；筹资 |
| **Statement of Changes in Equity** | 期初权益 + 本期综合收益 − 股利 = 期末权益 |
| **Notes to FS** | 最少包含：编制基础、收入确认、员工福利/CPF、所得税、GST、关联方、资本承诺 |

## 3. XBRL 简化报送
- 使用 ACRA **Simplified XBRL Template**，仅填报 50 个核心元素（如 Revenue, TotalAssets, TotalLiabilities, ProfitLoss, OperatingCashFlow 等）。
- 文件扩展名：`.xbrl`，通过 BizFile+ **Financial Statement Filing** 渠道递交。
- 附上经董事签字的完整 PDF GPFS。

## 4. 报表时效
- 财政年度结束后 **6 个月内** 召开 AGM（或以无会议决议替代）。
- AGM 后 **7 个月内** 完成年报 Annual Return + XBRL 提交。
- 逾期每日产生 S$15-600 罚款。

## 5. 自检清单（生成前必须通过）
- [ ] Trial Balance 借贷差 < S$0.5
- [ ] Balance Sheet assets − (liabilities + equity) 差 < S$0.5
- [ ] Cash Flow 期末现金与 Balance Sheet 现金一致
- [ ] Equity 期末值与 Balance Sheet 权益一致
- [ ] 所有披露项目至少一条 note
