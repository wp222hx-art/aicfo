# SOP-04 CPF 与薪资月度处理标准作业流程

- 适用范围：新加坡公民（SC）与永久居民（PR）雇员的月度公积金（CPF）与薪资处理。
- 法定依据：CPF Act（Cap. 36）；CPF Board 2025-01 起生效费率。

## 1. 输入数据要求
| 字段 | 说明 |
|---|---|
| employee_id | 员工编号 |
| nric_fin | NRIC/FIN 号 |
| residency | citizen / pr_year1 / pr_year2 / ep |
| age | 用于年龄段费率判定 |
| monthly_salary | 普通工资（Ordinary Wage, OW） |
| additional_wage | 额外工资（奖金/佣金, AW） |

## 2. 计算规则（2025-01 生效）
1. OW Ceiling：**S$7,400/月**（2026-01 起升至 S$8,000）。
2. AW Ceiling：S$102,000 − 年度 OW 合计。
3. 雇主 CPF：55 岁及以下 17%；56-60 15.5%；61-65 12%；66-70 9%；>70 7.5%。
4. 雇员 CPF：20% / 15% / 9% / 7.5% / 5%。
5. PR 第 1 年：4%/5%（雇员/雇主），PR 第 2 年：9%/15%，第 3 年起转正常费率。
6. SDL：工资 × 0.25%，每月上限 S$11.25。

## 3. 输出产物
- **CPF Monthly Contribution CSV**：按 CPF Board 上传格式（Submission Number、CSN、OW、AW、Employee Share、Employer Share、Total）。
- **Net Pay Report**：雇员实发工资 = OW − 雇员 CPF − 其他扣减。
- **Employer Cost Report**：雇主总成本 = OW + 雇主 CPF + SDL + 福利。

## 4. 申报时点
- **缴纳截止**：次月 14 日（节假日顺延至下一工作日）。
- **IR8A**：年度 3 月 1 日前通过 AIS 电子提交。
- **Form IR21**：外籍雇员离职 / 结束雇佣前至少 1 个月提交税务清算。

## 5. 风险点与合规提示
- PR 首两年默认按 Graduated/Graduated 费率，需雇员书面选择 Full/Full 方可调整。
- 过晚申报将产生 1.5%/月迟缴利息。
- 薪资单须列明 OW、AW、CPF 扣减、净薪、雇主 CPF，符合 MOM Itemised Payslip 要求。

## 6. 引用资料
- CPF Board - Rates for CPF Contribution https://www.cpf.gov.sg
- MOM Employment Act Itemised Payslip Guide
