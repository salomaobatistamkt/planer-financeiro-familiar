const test = require('node:test');
const assert = require('node:assert/strict');
const imp = require('../lib/importers');

test('parseAmount entende formatos brasileiros e internacionais', () => {
  assert.equal(imp.parseAmount('1.234,56'), 123456);
  assert.equal(imp.parseAmount('-1.234,56'), -123456);
  assert.equal(imp.parseAmount('R$ 39,90'), 3990);
  assert.equal(imp.parseAmount('1234.56'), 123456);
  assert.equal(imp.parseAmount('-45.5'), -4550);
  assert.equal(imp.parseAmount('(10,00)'), -1000);
  assert.equal(imp.parseAmount('50,00 D'), -5000);
});

test('parseDate', () => {
  assert.equal(imp.parseDate('01/05/2026'), '2026-05-01');
  assert.equal(imp.parseDate('20260501120000[-3:BRT]'), '2026-05-01');
  assert.equal(imp.parseDate('2026-05-01'), '2026-05-01');
});

test('destino extraído das descrições do banco', () => {
  assert.equal(imp.extractCounterparty('Transferência enviada pelo Pix - 53.577.772 JACKSIELLI FREITAS JUSTINO ALVES - 53.577.772/0001-57 - CLOUDWALK IP LTDA (0542) Agência: 1 Conta: 18506358-8'), 'Jacksielli Freitas Justino Alves');
  assert.equal(imp.extractCounterparty('Pix enviado — Igreja Batista Regular Central De Mossoro  Ibrecem'), 'Igreja Batista Regular Central de Mossoro Ibrecem');
  assert.equal(imp.extractCounterparty('Compra no débito - NORDESTAO'), 'Nordestao');
  assert.equal(imp.extractCounterparty('Sesc Mossoro - Parcela 1/3'), 'Sesc Mossoro');
});

const NUBANK_CONTA = `Data,Valor,Identificador,Descrição
01/05/2026,-59.38,6630a1b2-0001,Transferência enviada pelo Pix - SHPP BRASIL INSTITUICAO DE PAG - 38.372.267/0001-82 - BCO SANTANDER (BRASIL) S.A. (0033) Agência: 1 Conta: 1-1
05/05/2026,500.00,6630a1b2-0002,Transferência recebida pelo Pix - SALOMAO SALIM DA SILVA BATISTA - •••.111.222-•• - BCO DO BRASIL S.A. (0001)
09/05/2026,-428.64,6630a1b2-0003,Compra no débito - DIA A DIA ATACADO
10/05/2026,-1200.00,6630a1b2-0004,Pagamento de fatura
12/05/2026,-1207.00,6630a1b2-0005,Aplicação RDB
`;

test('Nubank conta: conta, destino, categoria, valor e transferência entre titulares', () => {
  const r = imp.buildImport(NUBANK_CONTA, { filename: 'NU_123_01MAI2026_31MAI2026.csv', titular: 'elizandra' });
  assert.equal(r.bank, 'Nubank');
  assert.equal(r.kind, 'checking');
  assert.equal(r.account.label, 'Nubank · Conta (Elizandra)');
  const [shopee, salomao, mercado, fatura, rdb] = r.items;
  assert.equal(shopee.txn.type, 'expense');
  assert.equal(shopee.txn.amount, 5938);
  assert.equal(shopee.txn.counterparty, 'Shpp Brasil Instituicao de Pag');
  assert.equal(shopee.txn.category, 'Tecnologia');
  assert.equal(shopee.txn.paymentMethod, 'pix');
  assert.equal(salomao.internal, true);
  assert.equal(salomao.include, false);
  assert.equal(mercado.txn.category, 'Alimentacao');
  assert.equal(mercado.txn.paymentMethod, 'debit');
  assert.equal(fatura.internal, true);
  assert.equal(rdb.txn.category, 'Investimentos');
  assert.deepEqual(r.months['2026-05'], { income: 0, expense: 5938 + 42864 + 120700, count: 3 });
});

test('reimportar o mesmo arquivo não duplica', () => {
  const first = imp.buildImport(NUBANK_CONTA, { filename: 'nubank.csv', titular: 'elizandra' });
  const existing = first.items.map(i => i.txn);
  const again = imp.buildImport(NUBANK_CONTA, { filename: 'nubank.csv', titular: 'elizandra', existing });
  assert.equal(again.totals.novos, 0);
  assert.equal(again.totals.duplicados, 5);
});

test('fatura Nubank (positivo = compra) e parcelas', () => {
  const csv = `date,title,amount
2026-05-03,Ifood *Ifood,44.98
2026-05-04,Sesc Mossoro - Parcela 1/3,68.56
2026-05-10,Pagamento recebido,-900.00
2026-05-11,Estorno Uber,-6.15
`;
  const r = imp.buildImport(csv, { filename: 'Nubank_2026-05-15.csv', titular: 'elizandra' });
  assert.equal(r.kind, 'card');
  assert.equal(r.account.label, 'Nubank · Cartão (Elizandra)');
  assert.equal(r.items[0].txn.type, 'expense');
  assert.equal(r.items[0].txn.category, 'Restaurante');
  assert.equal(r.items[0].txn.paymentMethod, 'credit');
  assert.equal(r.items[1].txn.installments, 3);
  assert.equal(r.items[1].txn.installmentMonth, 1);
  assert.equal(r.items[1].txn.category, 'Educacao');
  assert.equal(r.items[2].internal, true);
  assert.equal(r.items[3].txn.type, 'income');
});

test('Banco do Brasil CSV com colunas Lançamento + Detalhes', () => {
  const csv = `"Data","Lançamento","Detalhes","Nº documento","Valor","Tipo Lançamento"
"01/05/2026","Saldo Anterior","","","1.000,00",""
"04/05/2026","Pix - Enviado","04/05 10:22 Pao Nosso Oliver Delivery","123","-26,60","Saída"
"05/05/2026","Pix - Recebido","05/05 09:01 Kiwify Pagamentos","124","492,33","Entrada"
"06/05/2026","Pagamento de Boleto","UNIMED NATAL","125","-458,54","Saída"
`;
  const r = imp.buildImport(csv, { filename: 'extrato-bb.csv', titular: 'salomao' });
  assert.equal(r.bank, 'Banco do Brasil');
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].txn.amount, 2660);
  assert.equal(r.items[0].txn.category, 'Restaurante');
  assert.equal(r.items[1].txn.type, 'income');
  assert.equal(r.items[1].txn.category, 'Renda Extra');
  assert.equal(r.items[2].txn.category, 'Saude');
  assert.equal(r.items[2].txn.paymentMethod, 'boleto');
});

test('Inter CSV com ; e débito/crédito separados', () => {
  const csv = `Extrato Conta Corrente
Conta ;12345
Data Lançamento;Histórico;Descrição;Valor;Saldo
02/05/2026;Pix enviado ;Uber do Brasil;-6,15;993,85
03/05/2026;Pix recebido;Matheus da Silva;892,00;1.885,85
`;
  const r = imp.buildImport(csv, { filename: 'Extrato-Inter.csv', titular: 'salomao' });
  assert.equal(r.bank, 'Inter');
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].txn.category, 'Transporte');
  assert.equal(r.items[1].txn.amount, 89200);
});

test('OFX de conta corrente (SGML) e de cartão', () => {
  const ofx = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>0341<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260512000000[-3:BRT]<TRNAMT>-562.30<FITID>A1<MEMO>PIX ENVIADO IGREJA BATISTA IBRECEM</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260506<TRNAMT>2299.32<FITID>A2<NAME>AMARKETING & VENDAS LTDA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260530<TRNAMT>-30.00<FITID>A3<MEMO>RECARGA TIM</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const r = imp.buildImport(ofx, { filename: 'extrato.ofx', titular: 'salomao' });
  assert.equal(r.format, 'ofx');
  assert.equal(r.bank, 'Itaú');
  assert.equal(r.account.number, '12345-6');
  assert.equal(r.items[0].txn.category, 'Religiao');
  assert.equal(r.items[1].txn.category, 'Freelance');
  assert.equal(r.items[1].txn.counterparty, 'Amarketing & Vendas Ltda');
  assert.equal(r.items[2].txn.category, 'Comunicacao');
  const again = imp.buildImport(ofx, { filename: 'outro-nome.ofx', titular: 'salomao', existing: r.items.map(i => i.txn) });
  assert.equal(again.totals.novos, 0);

  const card = `<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260503</DTPOSTED><TRNAMT>-44.98</TRNAMT><FITID>c1</FITID><MEMO>iFood</MEMO></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
  const c = imp.buildImport(card, { filename: 'nubank-fatura.ofx', titular: 'elizandra', bank: 'Nubank' });
  assert.equal(c.kind, 'card');
  assert.equal(c.items[0].txn.type, 'expense');
  assert.equal(c.items[0].txn.paymentMethod, 'credit');
});

test('categoria aprendida com correção anterior vale para o mesmo destino', () => {
  const csv = `Data,Valor,Identificador,Descrição\n01/06/2026,-80.00,x1,Transferência enviada pelo Pix - DANIELLE LOUISE FERNANDES - 123\n`;
  const r = imp.buildImport(csv, { filename: 'nubank.csv', titular: 'elizandra', learned: { 'danielle louise fernandes': 'Casa' } });
  assert.equal(r.items[0].txn.category, 'Casa');
  assert.equal(r.items[0].txn.group, 'necessidades');
  assert.equal(r.items[0].reason, 'aprendido');
});
