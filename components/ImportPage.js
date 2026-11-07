import { useMemo, useRef, useState } from 'react';
import { api, readFileText, fmt, fmtDate, monthLabel, catLabel, CATS_EXP, CATS_INC, HOLDER_LABELS, PAY_LABELS } from '../lib/format';

const REASONS = { 'entre-titulares':'Transferência entre vocês', fatura:'Pagamento de fatura' };

export default function ImportPage({ user, accounts, imports, onImported }) {
  const [titular, setTitular] = useState(user.id);
  const [accountId, setAccountId] = useState('');
  const [kind, setKind] = useState('');
  const [invert, setInvert] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState({});
  const [overrides, setOverrides] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [drag, setDrag] = useState(false);
  const [show, setShow] = useState('novos');
  const inputRef = useRef(null);

  const accList = Object.values(accounts || {}).filter(a => a.kind !== 'manual');

  const runPreview = async (f = file, extra = {}) => {
    if (!f) return;
    setBusy(true); setMsg(null);
    try {
      const content = f.content || await readFileText(f.raw);
      const body = { filename: f.name, content, titular, accountId: accountId || undefined, kind: kind || undefined, invertSign: invert, ...extra };
      const r = await api('/api/import', { method:'POST', body });
      setFile({ ...f, content });
      setPreview(r);
      const sel = {}; r.items.forEach(i => { sel[i.txn.id] = i.include; });
      setSelected(sel); setOverrides({}); setShow('novos');
    } catch (e) { setMsg({ type:'error', text:e.message }); setPreview(null); }
    finally { setBusy(false); }
  };

  const pick = files => {
    const f = files && files[0];
    if (!f) return;
    const item = { name:f.name, raw:f };
    setFile(item); runPreview(item);
  };

  const commit = async () => {
    setBusy(true); setMsg(null);
    try {
      const include = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
      const r = await api('/api/import', { method:'POST', body:{
        filename:file.name, content:file.content, titular, accountId: accountId || undefined, kind: kind || undefined, invertSign: invert,
        commit:true, include, overrides,
      } });
      setMsg({ type:'success', text:`${r.added} lançamentos gravados em ${r.account.label}.` });
      setPreview(null); setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onImported && onImported();
    } catch (e) { setMsg({ type:'error', text:e.message }); }
    finally { setBusy(false); }
  };

  const items = preview ? preview.items : [];
  const visible = items.filter(i => show === 'todos' ? true : show === 'novos' ? !i.duplicate && !i.internal : show === 'internos' ? i.internal && !i.duplicate : i.duplicate);
  const chosen = items.filter(i => selected[i.txn.id]);
  const months = useMemo(() => {
    const m = {};
    chosen.forEach(({ txn }) => {
      const k = `${txn.year}-${String(txn.month).padStart(2, '0')}`;
      m[k] = m[k] || { income:0, expense:0, count:0 };
      m[k][txn.type] += txn.amount; m[k].count++;
    });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [chosen]);
  const totInc = chosen.filter(i => i.txn.type === 'income').reduce((s, i) => s + i.txn.amount, 0);
  const totExp = chosen.filter(i => i.txn.type === 'expense').reduce((s, i) => s + i.txn.amount, 0);

  return (
    <div className="content">
      <div className="panel">
        <div className="panel-head">
          <div><div className="panel-title">Importar extrato</div><div className="panel-sub">Envie o arquivo CSV ou OFX exportado do app/internet banking. O sistema identifica conta, destino, categoria e valores e mostra uma prévia antes de gravar.</div></div>
        </div>
        <div className="import-grid">
          <div className="form-group">
            <label className="lbl">De quem é a conta?</label>
            <div className="seg">
              {Object.entries(HOLDER_LABELS).map(([id, nome]) => (
                <button key={id} className={titular === id ? 'active' : ''} onClick={() => { setTitular(id); setAccountId(''); }}>{nome}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="lbl">Conta</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)}>
              <option value="">Detectar pelo arquivo</option>
              {accList.filter(a => a.titular === titular).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="lbl">Tipo de extrato</label>
            <select value={kind} onChange={e => setKind(e.target.value)}>
              <option value="">Detectar pelo arquivo</option>
              <option value="checking">Conta corrente / Pix / débito</option>
              <option value="card">Fatura do cartão de crédito</option>
            </select>
          </div>
        </div>
        <div className={`dropzone ${drag ? 'drag' : ''}`}
          onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
          onClick={() => inputRef.current && inputRef.current.click()}>
          <input ref={inputRef} type="file" accept=".csv,.ofx,.qfx,.txt,text/csv" hidden onChange={e => pick(e.target.files)} />
          <div className="dz-icon">⇪</div>
          <div className="dz-title">{file ? file.name : 'Arraste o arquivo aqui ou clique para escolher'}</div>
          <div className="dz-sub">Nubank, Banco do Brasil, Inter, Itaú, Bradesco, Caixa, Santander, C6, PicPay, Mercado Pago… (CSV ou OFX)</div>
        </div>
        {file && preview && (
          <div className="import-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => { const v = !preview.inverted; setInvert(v); runPreview(file, { invertSign: v }); }}>
              ⇅ Entradas/saídas estão trocadas? Inverter sinais
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => runPreview(file)} disabled={busy}>↻ Reprocessar com as opções acima</button>
          </div>
        )}
        {busy && <div className="loading-bar"><div className="spinner" />Lendo extrato…</div>}
        {msg && <div className={`notice ${msg.type}`}>{msg.text}</div>}
      </div>

      {preview && (
        <>
          <div className="cards-row">
            <div className="card"><div className="card-label">Conta identificada</div><div className="card-value sm">{preview.account.label}</div><div className="card-sub">{preview.format.toUpperCase()} · {preview.kind === 'card' ? 'cartão de crédito' : 'conta corrente'}{preview.account.number ? ` · ${preview.account.number}` : ''}</div></div>
            <div className="card green"><div className="card-label">Entradas selecionadas</div><div className="card-value">{fmt(totInc)}</div></div>
            <div className="card red"><div className="card-label">Saídas selecionadas</div><div className="card-value">{fmt(totExp)}</div></div>
            <div className="card blue"><div className="card-label">Lançamentos</div><div className="card-value">{chosen.length}<small> / {items.length}</small></div><div className="card-sub">{preview.totals.duplicados} já existiam · {preview.totals.internos} transferências internas</div></div>
          </div>

          {months.length > 0 && (
            <div className="table-wrap">
              <div className="table-header"><div className="table-title">Mês a mês do que será lançado</div></div>
              <div className="table-scroll"><table>
                <thead><tr><th>Mês</th><th>Qtd.</th><th className="num">Entradas</th><th className="num">Saídas</th><th className="num">Saldo</th></tr></thead>
                <tbody>{months.map(([k, v]) => (
                  <tr key={k}><td><b>{monthLabel(k)}</b></td><td>{v.count}</td><td className="num pos">{fmt(v.income)}</td><td className="num neg">{fmt(v.expense)}</td><td className={`num ${v.income - v.expense >= 0 ? 'pos' : 'neg'}`}>{v.income - v.expense < 0 ? '−' : ''}{fmt(v.income - v.expense)}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
          )}

          <div className="table-wrap">
            <div className="table-header">
              <div className="table-title">Prévia dos lançamentos</div>
              <div className="table-controls">
                <div className="seg sm">
                  {[['novos','Novos'],['internos','Transf. internas'],['duplicados','Já existentes'],['todos','Todos']].map(([id, l]) => (
                    <button key={id} className={show === id ? 'active' : ''} onClick={() => setShow(id)}>{l}</button>
                  ))}
                </div>
                <button className="btn btn-primary" disabled={busy || !chosen.length} onClick={commit}>Gravar {chosen.length} lançamentos</button>
              </div>
            </div>
            <div className="table-scroll"><table className="txn-table preview">
              <thead><tr><th style={{ width:32 }}><input type="checkbox" checked={visible.length > 0 && visible.every(i => selected[i.txn.id])} onChange={e => { const s = { ...selected }; visible.forEach(i => { if (!i.duplicate) s[i.txn.id] = e.target.checked; }); setSelected(s); }} /></th><th>Data</th><th>Destino / origem</th><th>Categoria</th><th>Pagamento</th><th className="num">Valor</th></tr></thead>
              <tbody>
                {visible.length === 0 && <tr><td colSpan="6" className="empty">Nada nesta aba.</td></tr>}
                {visible.map(({ txn, duplicate, internal, reason }) => {
                  const cat = (overrides[txn.id] && overrides[txn.id].category) || txn.category;
                  return (
                    <tr key={txn.id} className={duplicate ? 'muted' : ''}>
                      <td><input type="checkbox" disabled={duplicate} checked={!!selected[txn.id]} onChange={e => setSelected({ ...selected, [txn.id]: e.target.checked })} /></td>
                      <td>{fmtDate(txn.date)}</td>
                      <td className="desc-cell">
                        <b>{txn.counterparty || txn.description}</b>
                        <span className="desc-sub">{txn.description}</span>
                        {duplicate && <span className="tag">já lançado</span>}
                        {internal && !duplicate && <span className="tag amber">{REASONS[reason] || 'interno'}</span>}
                        {reason === 'aprendido' && <span className="tag blue">categoria aprendida</span>}
                        {txn.installments > 1 && <span className="tag">parcela {txn.installmentMonth}/{txn.installments}</span>}
                      </td>
                      <td>
                        <select className="inline-select" value={cat} disabled={duplicate} onChange={e => setOverrides({ ...overrides, [txn.id]: { ...(overrides[txn.id] || {}), category:e.target.value } })}>
                          {(txn.type === 'income' ? CATS_INC : CATS_EXP).map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                        </select>
                      </td>
                      <td>{PAY_LABELS[txn.paymentMethod] || txn.paymentMethod}</td>
                      <td className={`num ${txn.type === 'income' ? 'pos' : 'neg'}`}>{txn.type === 'income' ? '+' : '−'} {fmt(txn.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </div>
        </>
      )}

      {!preview && imports && imports.length > 0 && (
        <div className="table-wrap">
          <div className="table-header"><div className="table-title">Últimas importações</div></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Quando</th><th>Quem</th><th>Arquivo</th><th>Conta</th><th>Período</th><th className="num">Lançamentos</th></tr></thead>
            <tbody>{imports.map((i, idx) => (
              <tr key={idx}><td>{new Date(i.at).toLocaleString('pt-BR')}</td><td>{HOLDER_LABELS[i.by] || i.by}</td><td>{i.file}</td><td>{(accounts[i.account] && accounts[i.account].label) || '—'}</td><td>{(i.periodo || '').split(', ').filter(Boolean).map(monthLabel).join(', ') || '—'}</td><td className="num">{i.count}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
