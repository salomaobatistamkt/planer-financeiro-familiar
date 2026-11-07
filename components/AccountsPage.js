import { useMemo, useState } from 'react';
import { api, fmt, monthLabel, monthKey, MONTHS_F, HOLDER_LABELS, catLabel } from '../lib/format';

export default function AccountsPage({ transactions, accounts, month, year, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [label, setLabel] = useState('');
  const [holder, setHolder] = useState('all');

  const txns = holder === 'all' ? transactions : transactions.filter(t => t.titular === holder);
  const curKey = monthKey(year, month);

  const accStats = useMemo(() => {
    const m = {};
    txns.forEach(t => {
      const a = t.account || 'sem-conta';
      m[a] = m[a] || { id:a, inc:0, exp:0, monthInc:0, monthExp:0, count:0, last:'' };
      const s = m[a];
      s[t.type === 'income' ? 'inc' : 'exp'] += t.amount;
      if (monthKey(t.year, t.month) === curKey) s[t.type === 'income' ? 'monthInc' : 'monthExp'] += t.amount;
      s.count++; if (t.date > s.last) s.last = t.date;
    });
    return Object.values(m).sort((a, b) => (b.monthExp + b.monthInc) - (a.monthExp + a.monthInc) || b.count - a.count);
  }, [txns, curKey]);

  // últimos 12 meses x conta (saídas)
  const months = useMemo(() => {
    const out = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(year, month - 1 - i, 1); out.push(monthKey(d.getFullYear(), d.getMonth() + 1)); }
    return out;
  }, [month, year]);
  const matrix = useMemo(() => {
    const m = {};
    txns.forEach(t => {
      const k = monthKey(t.year, t.month);
      if (!months.includes(k)) return;
      const a = t.account || 'sem-conta';
      m[a] = m[a] || {}; m[a][k] = m[a][k] || { inc:0, exp:0 };
      m[a][k][t.type === 'income' ? 'inc' : 'exp'] += t.amount;
    });
    return m;
  }, [txns, months]);

  const destinos = useMemo(() => {
    const m = {};
    txns.filter(t => t.type === 'expense' && t.month === month && t.year === year && t.category !== 'Transferencias').forEach(t => {
      const k = t.counterparty || t.description;
      m[k] = m[k] || { name:k, total:0, count:0, cats:{} };
      m[k].total += t.amount; m[k].count++; m[k].cats[t.category] = (m[k].cats[t.category] || 0) + 1;
    });
    return Object.values(m).sort((a, b) => b.total - a.total).slice(0, 15);
  }, [txns, month, year]);
  const maxDest = destinos[0] ? destinos[0].total : 1;

  const name = id => (accounts[id] && accounts[id].label) || id;
  const save = async id => {
    await api('/api/accounts', { method:'PUT', body:{ id, label } });
    setEditing(null); onChanged && onChanged();
  };

  return (
    <div className="content">
      <div className="toolbar">
        <div className="seg">
          {[['all','Família'], ...Object.entries(HOLDER_LABELS)].map(([id, l]) => <button key={id} className={holder === id ? 'active' : ''} onClick={() => setHolder(id)}>{l}</button>)}
        </div>
      </div>
      <div className="acc-grid">
        {accStats.map(s => {
          const a = accounts[s.id] || {};
          return (
            <div key={s.id} className="acc-card">
              <div className="acc-top">
                <span className={`acc-kind ${a.kind || ''}`}>{a.kind === 'card' ? 'Cartão' : a.kind === 'manual' ? 'Manual' : 'Conta'}</span>
                {a.titular && <span className={`avatar sm avatar-${a.titular}`}>{HOLDER_LABELS[a.titular][0]}</span>}
              </div>
              {editing === s.id ? (
                <div className="acc-edit">
                  <input value={label} onChange={e => setLabel(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && save(s.id)} />
                  <button className="btn btn-primary btn-sm" onClick={() => save(s.id)}>Salvar</button>
                </div>
              ) : (
                <div className="acc-name" onClick={() => { setEditing(s.id); setLabel(name(s.id)); }} title="Clique para renomear">{name(s.id)} <span className="edit-hint">✎</span></div>
              )}
              <div className="acc-month">{MONTHS_F[month - 1]}</div>
              <div className="acc-row"><span>Entrou</span><b className="pos">{fmt(s.monthInc)}</b></div>
              <div className="acc-row"><span>Saiu</span><b className="neg">{fmt(s.monthExp)}</b></div>
              <div className="acc-foot">{s.count} lançamentos · último em {s.last.split('-').reverse().join('/')}</div>
            </div>
          );
        })}
      </div>

      <div className="table-wrap">
        <div className="table-header"><div className="table-title">Saídas por conta — últimos 12 meses</div></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Conta</th>{months.map(k => <th key={k} className={`num ${k === curKey ? 'hl' : ''}`}>{monthLabel(k)}</th>)}</tr></thead>
          <tbody>
            {accStats.map(s => (
              <tr key={s.id}><td><b>{name(s.id)}</b></td>{months.map(k => { const v = matrix[s.id] && matrix[s.id][k]; return <td key={k} className={`num ${k === curKey ? 'hl' : ''}`}>{v && v.exp ? fmt(v.exp).replace('R$ ', '') : '—'}</td>; })}</tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div className="table-wrap">
        <div className="table-header"><div className="table-title">Para onde foi o dinheiro — {MONTHS_F[month - 1]} {year}</div><div className="table-sub">Maiores destinos de saída (sem transferências internas)</div></div>
        <div className="dest-list">
          {destinos.length === 0 && <div className="empty">Sem saídas neste mês.</div>}
          {destinos.map(d => (
            <div key={d.name} className="dest-row">
              <div className="dest-name"><b>{d.name}</b><span>{d.count}× · {catLabel(Object.entries(d.cats).sort((a, b) => b[1] - a[1])[0][0])}</span></div>
              <div className="dest-bar"><div style={{ width:`${Math.max(4, d.total / maxDest * 100)}%` }} /></div>
              <div className="dest-val neg">{fmt(d.total)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
