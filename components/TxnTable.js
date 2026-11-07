import { useState } from 'react';
import { fmt, fmtDate, catLabel, CATS_EXP, CATS_INC, PAY_LABELS, HOLDER_LABELS } from '../lib/format';

const GROUP_LABELS = { necessidades:'Necessidade', desejos:'Desejo', futuro:'Futuro', fora_orcamento:'Fora do orçamento', a_classificar:'A classificar' };

export default function TxnTable({ type, title, rows, accounts, onEdit, onDelete, onCategory, onNew }) {
  const [q, setQ] = useState('');
  const [acc, setAcc] = useState('all');
  const [holder, setHolder] = useState('all');
  const [cat, setCat] = useState('all');
  const [pay, setPay] = useState('all');
  const [sort, setSort] = useState('date-desc');

  const accIds = [...new Set(rows.map(t => t.account).filter(Boolean))];
  const cats = [...new Set(rows.map(t => t.category))].sort();
  const n = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const filtered = rows.filter(t => {
    const qq = n(q);
    return (!qq || n(t.description).includes(qq) || n(t.counterparty).includes(qq) || n(t.category).includes(qq) || String(t.amount / 100).includes(qq))
      && (acc === 'all' || t.account === acc)
      && (holder === 'all' || t.titular === holder)
      && (cat === 'all' || t.category === cat)
      && (pay === 'all' || t.paymentMethod === pay);
  }).sort((a, b) => {
    if (sort === 'amount-desc') return b.amount - a.amount;
    if (sort === 'amount-asc') return a.amount - b.amount;
    if (sort === 'date-asc') return a.date.localeCompare(b.date);
    return b.date.localeCompare(a.date);
  });
  const total = filtered.reduce((s, t) => s + t.amount, 0);
  const accName = id => (accounts[id] && accounts[id].label) || id || '—';

  return (
    <div className="table-wrap">
      <div className="table-header">
        <div className="table-title">{title} <span className="count">{filtered.length}</span></div>
        <div className="table-controls">
          <input className="search" placeholder="Buscar descrição, destino, valor…" value={q} onChange={e => setQ(e.target.value)} />
          <select value={holder} onChange={e => setHolder(e.target.value)}><option value="all">Titular</option>{Object.entries(HOLDER_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
          <select value={acc} onChange={e => setAcc(e.target.value)}><option value="all">Todas as contas</option>{accIds.map(id => <option key={id} value={id}>{accName(id)}</option>)}</select>
          <select value={cat} onChange={e => setCat(e.target.value)}><option value="all">Categoria</option>{cats.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}</select>
          {type === 'expense' && <select value={pay} onChange={e => setPay(e.target.value)}><option value="all">Pagamento</option>{Object.entries(PAY_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>}
          <select value={sort} onChange={e => setSort(e.target.value)}><option value="date-desc">Mais recentes</option><option value="date-asc">Mais antigos</option><option value="amount-desc">Maior valor</option><option value="amount-asc">Menor valor</option></select>
          {onNew && <button className="btn btn-primary" onClick={onNew}>+ {type === 'income' ? 'Nova entrada' : 'Nova saída'}</button>}
        </div>
      </div>
      <div className="table-scroll">
        <table className={`txn-table ${type}`}>
          <thead><tr><th className="c-date">Data</th><th>{type === 'income' ? 'Origem' : 'Destino'}</th><th className="c-acc">Conta</th><th className="c-cat">Categoria</th>{type === 'expense' && <th className="c-pay">Pagamento</th>}<th className="num c-val">Valor</th><th className="c-act" /></tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan="7" className="empty">Nenhum lançamento encontrado</td></tr>}
            {filtered.map(t => (
              <tr key={t.id}>
                <td className="nowrap c-date">{fmtDate(t.date)}</td>
                <td className="desc-cell">
                  <b>{t.counterparty || t.description}</b>
                  {t.counterparty && t.counterparty !== t.description && <span className="desc-sub">{t.description}</span>}
                  {t.installments > 1 && <span className="tag">parcela {t.installmentMonth || 1}/{t.installments}</span>}
                  {t.status === 'pending' && <span className="tag amber">pendente</span>}
                  {t.status === 'overdue' && <span className="tag red">vencido</span>}
                </td>
                <td className="acc-cell c-acc"><span className={`avatar xs avatar-${t.titular}`}>{(HOLDER_LABELS[t.titular] || '?')[0]}</span>{accName(t.account)}</td>
                <td className="c-cat">
                  <select className="inline-select" value={t.category} onChange={e => onCategory(t, e.target.value)} title={GROUP_LABELS[t.group] || ''}>
                    {[...new Set([...(type === 'income' ? CATS_INC : CATS_EXP), t.category])].map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                  </select>
                </td>
                {type === 'expense' && <td className="c-pay"><span className={`pay-badge pay-${t.paymentMethod}`}>{PAY_LABELS[t.paymentMethod] || t.paymentMethod}</span></td>}
                <td className={`num c-val ${type === 'income' ? 'pos' : 'neg'}`}>{fmt(t.amount)}</td>
                <td className="row-actions c-act">
                  <button className="btn-icon" title="Editar" onClick={() => onEdit(t)}>✎</button>
                  <button className="btn-icon danger" title="Excluir" onClick={() => { if (confirm('Excluir este lançamento?')) onDelete(t.id); }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && <tfoot><tr className="tfoot"><td colSpan={type === 'expense' ? 5 : 4}>Total filtrado</td><td className="num">{fmt(total)}</td><td /></tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
