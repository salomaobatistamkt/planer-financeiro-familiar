export const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
export const MONTHS_F = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
export const CATS_EXP = ['Casa','Alimentacao','Transporte','Saude','Educacao','Comunicacao','Trabalho','Pet','Compromissos','Tarifas','Religiao','Dividas','Investimentos','Streaming','Restaurante','Tecnologia','Presentes','Vestuario','Lazer','Pessoal','Transferencias','Outros','A classificar'];
export const CATS_INC = ['Salario','Freelance','Bonus','Renda Extra','Investimentos','Transferencias','Outra Fonte'];
export const CAT_LABELS = { Alimentacao:'Alimentação', Saude:'Saúde', Educacao:'Educação', Comunicacao:'Comunicação', Religiao:'Religião / Dízimo', Dividas:'Dívidas', Vestuario:'Vestuário', Transferencias:'Transferências', Salario:'Salário', Bonus:'Bônus' };
export const catLabel = c => CAT_LABELS[c] || c;
export const PAY_LABELS = { pix:'Pix', credit:'Crédito', debit:'Débito', boleto:'Boleto', cash:'Dinheiro' };
export const HOLDER_LABELS = { salomao:'Salomão', elizandra:'Elizandra' };
export const fmt = c => 'R$ ' + (Math.abs(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
export const fmtDate = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
export const monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
export const monthLabel = k => { const [y, m] = k.split('-').map(Number); return `${MONTHS[m - 1]}/${String(y).slice(2)}`; };

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (res.status === 401) { window.location.href = '/login'; throw new Error('Sessão expirada'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

// Lê o arquivo respeitando a codificação (bancos costumam usar Windows-1252 no OFX/CSV).
export async function readFileText(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('windows-1252').decode(buf);
}
