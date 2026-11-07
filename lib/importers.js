// Leitura de extratos bancários (OFX e CSV) e transformação em lançamentos.
// Para cada linha identifica: conta (banco + tipo + titular), destino/origem
// (contraparte), categoria sugerida, valor em centavos, data e forma de
// pagamento. Funciona igual no servidor e nos testes (CommonJS, sem deps).

const crypto = require('crypto');
const { CATEGORY_GROUPS, suggestCategory, normalize } = require('./finance-categories');

const BANKS = {
  '001': 'Banco do Brasil', '033': 'Santander', '070': 'BRB', '077': 'Inter', '104': 'Caixa',
  '237': 'Bradesco', '260': 'Nubank', '290': 'PagBank', '323': 'Mercado Pago', '336': 'C6 Bank',
  '341': 'Itaú', '380': 'PicPay', '403': 'Cora', '422': 'Safra', '748': 'Sicredi', '756': 'Sicoob',
  '655': 'Neon', '212': 'Original', '208': 'BTG Pactual', '102': 'XP',
};
const BANK_HINTS = [
  [/nubank|nu pagamentos|\bnu_|^nu\b/, 'Nubank'], [/\binter\b|bancointer/, 'Inter'], [/itau|itaú/, 'Itaú'],
  [/bradesco/, 'Bradesco'], [/santander/, 'Santander'], [/caixa|cef\b/, 'Caixa'], [/\bbb\b|banco do brasil|bancodobrasil/, 'Banco do Brasil'],
  [/\bc6\b|c6bank/, 'C6 Bank'], [/picpay/, 'PicPay'], [/mercado ?pago/, 'Mercado Pago'], [/pagbank|pagseguro/, 'PagBank'],
  [/sicoob/, 'Sicoob'], [/sicredi/, 'Sicredi'], [/neon/, 'Neon'], [/btg/, 'BTG Pactual'], [/\bxp\b/, 'XP'],
];

const HOLDERS = {
  salomao: { label: 'Salomão', names: ['salomao salim', 'salomao batista', 'salomao s da silva', 'salomao salim da silva batista'] },
  elizandra: { label: 'Elizandra', names: ['elizandra andre', 'elizandra a de oliveira', 'elizandra andre de oliveira'] },
};

const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);

// ---------- números e datas ----------
function parseAmount(raw) {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim().replace(/\s|R\$| /g, '');
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/[-−]$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (/^[-−]/.test(s)) { neg = !neg; s = s.slice(1); }
  if (/^\+/.test(s)) s = s.slice(1);
  if (/[DC]$/i.test(s)) { if (/D$/i.test(s)) neg = !neg; s = s.slice(0, -1); }
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma !== -1) s = s.replace(/,/g, '');
  else if (lastComma === -1 && (s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round((neg ? -n : n) * 100);
}

function parseDate(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/); // 2026-05-01, 20260501(OFX)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); // 01/05/2026
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

// ---------- texto ----------
function decodeEntities(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}
function titleCase(s) {
  const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ')
    .map((w, i) => (i > 0 && small.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Extrai o destino (saída) ou a origem (entrada) do texto do banco.
function extractCounterparty(description) {
  let d = decodeEntities(description).replace(/\s+/g, ' ').trim();
  if (!d) return '';
  // "Transferência enviada pelo Pix - NOME - doc - BANCO (0001) Agência..."
  let m = d.match(/^(?:transfer[eê]ncia|pix|ted|doc|pagamento|compra|envio|recebimento)[^-–—:]*[-–—:]\s*(.+)$/i);
  if (m) d = m[1];
  d = d.replace(/\s*\((?:transfer[eê]ncia|pix)[^)]*\)\s*$/i, '');
  d = d.split(/\s+[-–—]\s+/)[0];
  d = d.replace(/^\d{2}\.\d{3}\.\d{3}\s+/, '') // CNPJ raiz no início (MEI)
    .replace(/^\d{6,}\s*/, '')
    .replace(/\s+-\s*parcela\s+\d+\/\d+$/i, '')
    .replace(/\s+parcela\s+\d+\/\d+$/i, '')
    .replace(/[•*]{2,}.*$/, '')
    .replace(/\b(dl|ifd|pg|mp|pag|ec|ebn|shp|htm)\s*\*/i, '')
    .replace(/\*/g, ' ')
    .trim();
  if (!d) return '';
  return titleCase(d).slice(0, 80);
}

function detectHolderMention(text) {
  const n = normalize(text);
  for (const [id, h] of Object.entries(HOLDERS)) if (h.names.some(name => n.includes(name))) return id;
  return null;
}

function detectInstallments(description) {
  const m = String(description || '').match(/parcela\s+(\d+)\s*\/\s*(\d+)|\b(\d{1,2})\/(\d{1,2})\s*$/i);
  if (!m) return null;
  const cur = Number(m[1] || m[3]), tot = Number(m[2] || m[4]);
  if (!tot || tot < 2 || cur > tot || tot > 60) return null;
  return { current: cur, total: tot };
}

function detectPaymentMethod(description, kind) {
  const n = normalize(description);
  if (kind === 'card') return 'credit';
  if (/\bpix\b/.test(n)) return 'pix';
  if (/boleto|pagamento de conta|pagto conta|titulo/.test(n)) return 'boleto';
  if (/debito|compra no cartao|compra cartao|\bcd\b/.test(n)) return 'debit';
  if (/saque|dinheiro/.test(n)) return 'cash';
  if (/ted|doc|transfer/.test(n)) return 'pix';
  return 'debit';
}

function detectBank(text) {
  const n = String(text || '').toLowerCase();
  const hit = BANK_HINTS.find(([re]) => re.test(n));
  return hit ? hit[1] : null;
}

function accountId(bank, kind, titular) {
  return normalize(`${bank || 'banco'} ${kind} ${titular || ''}`).replace(/ /g, '-');
}
function accountLabel(bank, kind, titular) {
  const h = HOLDERS[titular];
  return `${bank || 'Banco'} · ${kind === 'card' ? 'Cartão' : 'Conta'}${h ? ` (${h.label})` : ''}`;
}

// ---------- OFX ----------
function ofxTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? decodeEntities(m[1].trim()) : '';
}

function parseOFX(text) {
  const isCard = /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(text);
  const bankId = ofxTag(text, 'BANKID');
  const org = ofxTag(text, 'ORG') || ofxTag(text, 'FID');
  const acct = ofxTag(text, 'ACCTID');
  const bank = BANKS[String(bankId).padStart(3, '0').slice(-3)] || detectBank(org) || null;
  const rows = [];
  const re = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi;
  let m;
  while ((m = re.exec(text))) {
    const b = m[1];
    const amount = parseAmount(ofxTag(b, 'TRNAMT'));
    const date = parseDate(ofxTag(b, 'DTPOSTED'));
    if (!date || !Number.isFinite(amount) || amount === 0) continue;
    const name = ofxTag(b, 'NAME'), memo = ofxTag(b, 'MEMO');
    const description = [memo, name].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' - ') || ofxTag(b, 'TRNTYPE');
    rows.push({ date, amount, description, fitid: ofxTag(b, 'FITID'), trnType: ofxTag(b, 'TRNTYPE') });
  }
  return { format: 'ofx', kind: isCard ? 'card' : 'checking', bank, accountNumber: acct, rows, cardSign: 'signed' };
}

// ---------- CSV ----------
function splitCSVLine(line, sep) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

const H = {
  date: /^(data|date|dt|data lancamento|data de lancamento|data da transacao|data movimento|data mov)/,
  desc: /(descri|histor|title|titulo|lancamento|detalhe|estabelecimento|memo|nome|identificacao)/,
  amount: /^(valor|amount|value|valor r|valor \(r\)|quantia|montante)/,
  credit: /^(credito|entrada|entradas|valor credito)/,
  debit: /^(debito|saida|saidas|valor debito)/,
  dc: /^(tipo|d c|natureza|tipo lancamento|tipo de lancamento)$/,
  id: /^(identificador|id|fitid|documento|n documento|numero documento)$/,
  balance: /^(saldo)/,
};

function parseCSV(text, filename = '') {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { format: 'csv', rows: [], kind: 'checking', bank: null };
  // Header = primeira linha que tenha cara de cabeçalho (bancos colocam linhas de título antes).
  let hi = lines.findIndex(l => /data|date/i.test(l) && /valor|amount|value|cr[eé]dito|d[eé]bito/i.test(l));
  if (hi < 0) hi = 0;
  const headerLine = lines[hi];
  const sep = [';', ',', '\t', '|'].map(s => [s, headerLine.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const header = splitCSVLine(headerLine, sep).map(h => normalize(h));
  const col = key => header.findIndex(h => H[key].test(h));
  let iDate = col('date'), iAmount = col('amount'), iCredit = col('credit'), iDebit = col('debit');
  let iDc = col('dc'), iId = col('id');
  // descrição: junta todas as colunas descritivas (ex.: BB "Lançamento" + "Detalhes")
  const descCols = header.map((h, i) => (H.desc.test(h) && i !== iDate && i !== iAmount && i !== iId && !H.dc.test(h) ? i : -1)).filter(i => i >= 0);
  if (iDate < 0) iDate = 0;
  const isNubankCard = header.includes('title') && header.includes('amount');
  const lowerName = filename.toLowerCase();
  const kind = isNubankCard || /fatura|cartao|cartão|card|credit/.test(lowerName) ? 'card' : 'checking';
  const bank = detectBank(lowerName) || (isNubankCard || (header.includes('identificador') && header.includes('descricao')) ? 'Nubank' : null)
    || detectBank(lines.slice(0, hi).join(' '));
  const rows = [];
  for (const line of lines.slice(hi + 1)) {
    const c = splitCSVLine(line, sep);
    if (c.length < 2) continue;
    const date = parseDate(c[iDate]);
    if (!date) continue;
    let amount = NaN;
    if (iAmount >= 0) amount = parseAmount(c[iAmount]);
    if (!Number.isFinite(amount) && (iCredit >= 0 || iDebit >= 0)) {
      const cr = iCredit >= 0 ? parseAmount(c[iCredit]) : NaN, db = iDebit >= 0 ? parseAmount(c[iDebit]) : NaN;
      if (Number.isFinite(cr) && cr !== 0) amount = Math.abs(cr);
      else if (Number.isFinite(db) && db !== 0) amount = -Math.abs(db);
    }
    if (iDc >= 0 && Number.isFinite(amount)) {
      const t = normalize(c[iDc]);
      if (/^(d|debito|saida)/.test(t)) amount = -Math.abs(amount);
      else if (/^(c|credito|entrada)/.test(t)) amount = Math.abs(amount);
    }
    if (!Number.isFinite(amount) || amount === 0) continue;
    const description = descCols.map(i => c[i]).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' - ');
    if (/^saldo|saldo (anterior|do dia|final)|^s a l d o/i.test(normalize(description))) continue;
    rows.push({ date, amount, description: description || '(sem descrição)', fitid: iId >= 0 ? c[iId] : '' });
  }
  // Fatura Nubank (date,title,amount): positivo = compra. Demais CSVs: negativo = saída.
  return { format: 'csv', kind, bank, rows, cardSign: isNubankCard ? 'positive-is-expense' : 'signed' };
}

function parseStatement(text, filename = '') {
  const t = String(text || '');
  if (/<OFX>|OFXHEADER|<STMTTRN>/i.test(t)) return parseOFX(t);
  return parseCSV(t, filename);
}

// ---------- transformação em lançamentos ----------
function signatureOf(t) {
  return [t.date, t.type, Number(t.amount) || 0, normalize(t.description)].join('|');
}

/**
 * opts: { filename, titular, kind?, bank?, accountId?, accountLabel?, invertSign?,
 *         existing?: [], learned?: {normalizedCounterparty: category} }
 */
function buildImport(text, opts = {}) {
  const parsed = parseStatement(text, opts.filename || '');
  const kind = opts.kind || parsed.kind;
  const bank = opts.bank || parsed.bank || 'Banco';
  const titular = opts.titular || 'salomao';
  const accId = opts.accountId || accountId(bank, kind, titular);
  const accLabel = opts.accountLabel || accountLabel(bank, kind, titular);
  const otherHolder = titular === 'salomao' ? 'elizandra' : 'salomao';
  const learned = opts.learned || {};

  let invert = false;
  if (opts.invertSign !== undefined) invert = !!opts.invertSign;
  else if (parsed.cardSign === 'positive-is-expense') invert = true;

  const existingIds = new Set((opts.existing || []).map(t => t.id));
  const existingImportIds = new Set((opts.existing || []).map(t => t.importRecordId).filter(Boolean));
  const existingSig = new Map();
  (opts.existing || []).forEach(t => { const s = signatureOf(t); existingSig.set(s, (existingSig.get(s) || 0) + 1); });

  const seen = new Map();
  const items = parsed.rows.map(r => {
    const signed = invert ? -r.amount : r.amount;
    const type = signed < 0 ? 'expense' : 'income';
    const amount = Math.abs(signed);
    const counterparty = extractCounterparty(r.description);
    const [y, mo] = r.date.split('-').map(Number);
    const baseKey = r.fitid ? `fitid|${accId}|${r.fitid}` : `${accId}|${r.date}|${signed}|${normalize(r.description)}`;
    const n = (seen.get(baseKey) || 0) + 1; seen.set(baseKey, n);
    const id = `imp-${sha(`${baseKey}|${r.fitid ? '' : n}`)}`;

    const nDesc = normalize(r.description);
    const mention = detectHolderMention(`${r.description}`);
    const cardBill = /pagamento (de )?fatura|pgto fatura|pagamento recebido|fatura (do )?cartao/.test(nDesc);
    const internal = mention === otherHolder || mention === titular || cardBill;

    let { category, group } = suggestCategory(type, `${r.description} ${counterparty}`);
    const learnedCat = learned[normalize(counterparty)];
    let reason = 'regra';
    if (learnedCat) { category = learnedCat; group = type === 'expense' ? (CATEGORY_GROUPS[learnedCat] || 'a_classificar') : null; reason = 'aprendido'; }
    if (internal) { category = 'Transferencias'; group = type === 'expense' ? 'fora_orcamento' : null; reason = cardBill ? 'fatura' : 'entre-titulares'; }

    const inst = detectInstallments(r.description);
    const txn = {
      id, type, description: r.description.slice(0, 240), amount, category, group,
      subcategory: 'variable', status: type === 'income' ? 'received' : 'paid',
      paymentMethod: detectPaymentMethod(r.description, kind), date: r.date, month: mo, year: y,
      installments: inst ? inst.total : 1, installmentMonth: inst ? inst.current : null,
      titular, account: accId, counterparty, source: `${parsed.format}:${bank}`, importRecordId: id,
    };

    let duplicate = existingIds.has(id) || existingImportIds.has(id);
    if (!duplicate) {
      const s = signatureOf(txn);
      const left = existingSig.get(s) || 0;
      if (left > 0) { duplicate = true; existingSig.set(s, left - 1); }
    }
    return { txn, duplicate, internal, reason, include: !duplicate && !internal };
  });

  const months = {};
  items.filter(i => i.include).forEach(({ txn }) => {
    const k = `${txn.year}-${String(txn.month).padStart(2, '0')}`;
    months[k] = months[k] || { income: 0, expense: 0, count: 0 };
    months[k][txn.type] += txn.amount; months[k].count++;
  });

  return {
    format: parsed.format, kind, bank, titular, inverted: invert,
    account: { id: accId, label: accLabel, bank, kind, titular, number: parsed.accountNumber || '' },
    items, months,
    totals: {
      rows: items.length,
      novos: items.filter(i => i.include).length,
      duplicados: items.filter(i => i.duplicate).length,
      internos: items.filter(i => i.internal && !i.duplicate).length,
    },
  };
}

module.exports = {
  BANKS, HOLDERS, parseAmount, parseDate, parseOFX, parseCSV, parseStatement, extractCounterparty,
  detectHolderMention, detectInstallments, detectPaymentMethod, detectBank, accountId, accountLabel,
  buildImport, signatureOf, titleCase,
};
