// AiCFO Simulation Data Generator
// Creates a realistic year-to-date transaction set for a Singapore Pte Ltd (Jan–Nov 2025)
// including revenue, salaries (CPF), rent, SaaS, marketing, bank charges, FX, etc.
// Used to seed full financial statements + the November monthly report pack.

const db = require('../db/schema');
const { v4: uuid } = require('uuid');

const DEMO_EMPLOYEES = [
  { name: 'James Chen',       nric_fin: 'S8812345A', designation: 'CEO',             monthly_salary: 12000, bonus: 24000, age: 34, residency: 'citizen' },
  { name: 'Aisha Rahman',     nric_fin: 'S9234567B', designation: 'COO',             monthly_salary: 9000,  bonus: 18000, age: 31, residency: 'citizen' },
  { name: 'Liu Wei',          passport_no: 'E12345678', designation: 'Senior Engineer', monthly_salary: 8500, bonus: 12000, age: 29, residency: 'pr_year2' },
  { name: 'Tan Mei Ling',     nric_fin: 'S9312345C', designation: 'Product Manager', monthly_salary: 7500,  bonus: 9000,  age: 28, residency: 'citizen' },
  { name: 'Raj Kumar',        nric_fin: 'S9487654D', designation: 'Sales Lead',      monthly_salary: 6500,  bonus: 8000,  age: 30, residency: 'pr_year1' }
];

const VENDORS = [
  { name: 'Amazon Web Services',        category: 'IT/Cloud',    amount_range: [800, 1800] },
  { name: 'Google Workspace',           category: 'IT/SaaS',     amount_range: [180, 260] },
  { name: 'Slack Technologies',         category: 'IT/SaaS',     amount_range: [120, 280] },
  { name: 'GitHub Enterprise',          category: 'IT/SaaS',     amount_range: [220, 420] },
  { name: 'Notion Labs',                category: 'IT/SaaS',     amount_range: [80, 180] },
  { name: 'Figma Inc',                  category: 'IT/SaaS',     amount_range: [75, 300] },
  { name: 'CapitaLand Commercial',      category: 'Rent',        amount_range: [5500, 5500] },
  { name: 'SP Group',                   category: 'Utilities',   amount_range: [420, 680] },
  { name: 'Singtel Enterprise',         category: 'Utilities',   amount_range: [280, 380] },
  { name: 'Meta Ads (Facebook)',        category: 'Marketing',   amount_range: [1200, 3500] },
  { name: 'Google Ads',                 category: 'Marketing',   amount_range: [1500, 4200] },
  { name: 'LinkedIn Marketing',         category: 'Marketing',   amount_range: [600, 1500] },
  { name: 'PwC Singapore',              category: 'Professional',amount_range: [2500, 6000] },
  { name: 'Rajah & Tann Asia',          category: 'Legal',       amount_range: [1800, 4500] },
  { name: 'DBS Bank',                   category: 'Bank Charges',amount_range: [15, 85] },
  { name: 'Stripe Fees',                category: 'Bank Charges',amount_range: [95, 420] },
  { name: 'Canva Pro',                  category: 'IT/SaaS',     amount_range: [45, 45] },
  { name: 'Zoom Communications',        category: 'IT/SaaS',     amount_range: [95, 195] }
];

const CUSTOMERS = [
  { name: 'ABC Ventures Pte Ltd',           typical: [8000, 18000] },
  { name: 'DEF Holdings Pte Ltd',           typical: [12000, 35000] },
  { name: 'TechCorp Asia Ltd',              typical: [15000, 42000] },
  { name: 'Orchard Retail Group',           typical: [6000, 14000] },
  { name: 'Greenfield Capital Pte Ltd',     typical: [22000, 55000] },
  { name: 'Marina Bay Consulting',          typical: [7500, 16500] },
  { name: 'Suntec Advisory Pte Ltd',        typical: [9000, 24000] }
];

function randBetween(lo, hi) { return +(lo + Math.random() * (hi - lo)).toFixed(2); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pad(n) { return String(n).padStart(2, '0'); }

// Generate JAN–NOV transactions for the given company (with realistic seasonality)
function generateYTDTransactions({ company_id, year = 2025, endMonth = 11 }) {
  // Clean existing demo txns + journals for idempotency
  const existing = db.prepare(`SELECT id FROM transactions WHERE company_id=? AND description LIKE '[SIM]%'`).all(company_id);
  if (existing.length) {
    const ids = existing.map(r => r.id);
    db.prepare(`UPDATE transactions SET journal_entry_id=NULL WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    db.prepare(`DELETE FROM journal_entries WHERE source_txn_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    db.prepare(`DELETE FROM transactions WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  }
  db.prepare(`DELETE FROM invoices WHERE company_id=? AND vendor_name LIKE '[SIM]%'`).run(company_id);

  const insertTxn = db.prepare(`INSERT INTO transactions (id,company_id,transaction_date,amount,currency,description,counterparty,journal_entry_id)
                                VALUES (?,?,?,?,?,?,?,NULL)`);
  const insertInv = db.prepare(`INSERT INTO invoices (id,company_id,vendor_name,invoice_number,issue_date,total,gst_amount,currency,ocr_confidence,status)
                                VALUES (?,?,?,?,?,?,?,?,?,?)`);

  let totalRev = 0, totalExp = 0, totalInvoices = 0;
  const addTxn = (dateStr, amount, description, counterparty) => {
    const id = `txn_${uuid().slice(0, 8)}`;
    insertTxn.run(id, company_id, dateStr, amount, 'SGD', `[SIM] ${description}`, counterparty);
    if (amount > 0) totalRev += amount; else totalExp += -amount;
    return id;
  };
  const addInv = (dateStr, vendor, amount) => {
    const id = `inv_${uuid().slice(0, 8)}`;
    const gst = +(amount * 0.09 / 1.09).toFixed(2);
    insertInv.run(id, company_id, `[SIM] ${vendor}`, `INV-${dateStr.replace(/-/g, '')}-${Math.floor(Math.random()*9000+1000)}`, dateStr, amount, gst, 'SGD', 0.97, 'matched');
    totalInvoices++;
  };

  // Seasonal multipliers (growth toward year-end)
  const monthlyMultiplier = {1: 0.7, 2: 0.75, 3: 0.85, 4: 0.9, 5: 1.0, 6: 1.05, 7: 1.1, 8: 1.15, 9: 1.2, 10: 1.3, 11: 1.4, 12: 1.35};

  for (let m = 1; m <= endMonth; m++) {
    const mult = monthlyMultiplier[m] || 1;

    // --- Revenue: 3-6 customer invoices per month ---
    const nInvoices = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < nInvoices; i++) {
      const customer = pick(CUSTOMERS);
      const day = pad(2 + Math.floor(Math.random() * 25));
      const amt = randBetween(customer.typical[0], customer.typical[1]) * mult;
      const dateStr = `${year}-${pad(m)}-${day}`;
      addTxn(dateStr, +amt.toFixed(2), `Invoice payment from ${customer.name}`, customer.name);
    }

    // --- Salaries: on the 25th ---
    const salaryDate = `${year}-${pad(m)}-25`;
    DEMO_EMPLOYEES.forEach(e => {
      addTxn(salaryDate, -e.monthly_salary, `Salary - ${e.name} (${e.designation})`, 'Payroll');
    });
    // CPF employer portion (simplified sum)
    const totalEmployerCPF = DEMO_EMPLOYEES.reduce((s, e) => {
      const ow = Math.min(e.monthly_salary, 7400);
      const rate = e.residency === 'pr_year1' ? 0.04 : (e.residency === 'pr_year2' ? 0.09 : 0.17);
      return s + ow * rate;
    }, 0);
    addTxn(`${year}-${pad(m)}-${pad(Math.min(m === 12 ? 28 : 14, 28))}`,
      -+totalEmployerCPF.toFixed(2), `CPF Employer Contribution - ${year}-${pad(m)}`, 'CPF Board');

    // --- Rent: 1st of month ---
    const rentDate = `${year}-${pad(m)}-01`;
    addTxn(rentDate, -5500, `Office rent - 160 Robinson Road`, 'CapitaLand Commercial');
    addInv(rentDate, 'CapitaLand Commercial', 5500);

    // --- SaaS subscriptions: around 5th ---
    ['Amazon Web Services', 'Google Workspace', 'Slack Technologies', 'GitHub Enterprise', 'Notion Labs', 'Figma Inc', 'Zoom Communications', 'Canva Pro'].forEach((vendorName, i) => {
      const v = VENDORS.find(x => x.name === vendorName);
      const day = pad(3 + i);
      const amt = randBetween(v.amount_range[0], v.amount_range[1]);
      const dateStr = `${year}-${pad(m)}-${day}`;
      addTxn(dateStr, -amt, `${vendorName} - monthly subscription`, vendorName);
      addInv(dateStr, vendorName, amt);
    });

    // --- Utilities ---
    const utilDate = `${year}-${pad(m)}-08`;
    const spAmt = randBetween(420, 680);
    addTxn(utilDate, -spAmt, `SP Group electricity+water`, 'SP Group');
    addInv(utilDate, 'SP Group', spAmt);
    const telAmt = randBetween(280, 380);
    addTxn(`${year}-${pad(m)}-09`, -telAmt, `Singtel Enterprise - fibre + mobile`, 'Singtel Enterprise');
    addInv(`${year}-${pad(m)}-09`, 'Singtel Enterprise', telAmt);

    // --- Marketing (stepped up from May onwards) ---
    if (m >= 5) {
      const adDate = `${year}-${pad(m)}-12`;
      const metaAmt = randBetween(1200, 3500) * (m >= 9 ? 1.4 : 1);
      const googleAmt = randBetween(1500, 4200) * (m >= 9 ? 1.5 : 1);
      addTxn(adDate, -+metaAmt.toFixed(2), `Meta Ads - performance marketing campaign`, 'Meta Ads (Facebook)');
      addTxn(`${year}-${pad(m)}-13`, -+googleAmt.toFixed(2), `Google Ads - SEM campaign`, 'Google Ads');
      if (m % 2 === 1) {
        const liAmt = randBetween(600, 1500);
        addTxn(`${year}-${pad(m)}-15`, -liAmt, `LinkedIn Marketing Solutions`, 'LinkedIn Marketing');
      }
    }

    // --- Professional fees (quarterly) ---
    if ([3, 6, 9, 11].includes(m)) {
      const feeDate = `${year}-${pad(m)}-20`;
      const pwcAmt = randBetween(2500, 6000);
      addTxn(feeDate, -pwcAmt, `PwC Singapore - quarterly review + tax advisory`, 'PwC Singapore');
      addInv(feeDate, 'PwC Singapore', pwcAmt);
    }
    if ([4, 8, 11].includes(m)) {
      const rtaAmt = randBetween(1800, 4500);
      addTxn(`${year}-${pad(m)}-18`, -rtaAmt, `Rajah & Tann Asia - contract review`, 'Rajah & Tann Asia');
      addInv(`${year}-${pad(m)}-18`, 'Rajah & Tann Asia', rtaAmt);
    }

    // --- Bank / Stripe fees (continuous) ---
    const dbsFee = randBetween(15, 85);
    addTxn(`${year}-${pad(m)}-28`, -dbsFee, `DBS Bank - monthly account fee`, 'DBS Bank');
    const stripeFee = randBetween(95, 420) * mult;
    addTxn(`${year}-${pad(m)}-30`, -+stripeFee.toFixed(2), `Stripe processing fees`, 'Stripe Fees');

    // --- One-off items by month (narrative realism) ---
    if (m === 1) addTxn(`${year}-01-15`, -8000, `Office furniture & equipment purchase (capitalised)`, 'IKEA Business');
    if (m === 3) addTxn(`${year}-03-10`, -12000, `Annual insurance premium - Office + D&O`, 'AIA Singapore');
    if (m === 7) addTxn(`${year}-07-22`, -3500, `Team offsite - Bintan retreat`, 'Nirwana Resort');
    if (m === 10) addTxn(`${year}-10-05`, 50000, `Strategic client - DEF Holdings annual contract`, 'DEF Holdings Pte Ltd');
    if (m === 11) addTxn(`${year}-11-18`, -6500, `Year-end CNY gift hampers for top clients`, 'Grand Hyatt Singapore');
  }

  return {
    transactions_inserted: db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE company_id=? AND description LIKE '[SIM]%'`).get(company_id).n,
    invoices_inserted: db.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE company_id=? AND vendor_name LIKE '[SIM]%'`).get(company_id).n,
    period: `${year}-01 to ${year}-${pad(endMonth)}`,
    employees: DEMO_EMPLOYEES.length,
    totals_preview: { revenue: +totalRev.toFixed(2), expenses: +totalExp.toFixed(2), net: +(totalRev - totalExp).toFixed(2) }
  };
}

module.exports = { generateYTDTransactions, DEMO_EMPLOYEES, VENDORS, CUSTOMERS };
