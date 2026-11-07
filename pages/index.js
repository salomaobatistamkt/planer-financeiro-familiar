import { useState, useEffect, useContext, createContext, useReducer, useRef, useCallback } from 'react';
import Head from 'next/head';
import PlanningPage from '../components/PlanningPage';
import ImportPage from '../components/ImportPage';
import AccountsPage from '../components/AccountsPage';
import TxnTable from '../components/TxnTable';
import { CATEGORY_GROUPS } from '../lib/finance-categories';
import { api, catLabel, HOLDER_LABELS } from '../lib/format';

export async function getServerSideProps({ req }) {
  const { currentUser } = require('../lib/server/auth');
  const user = currentUser(req);
  if (!user) return { redirect: { destination: '/login', permanent: false } };
  return { props: { user: { id: user.id, name: user.name } } };
}

// ===================== CONSTANTS =====================
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTHS_F = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const CATS_EXP = ['Casa','Alimentacao','Transporte','Saude','Educacao','Comunicacao','Trabalho','Pet','Compromissos','Tarifas','Religiao','Dividas','Investimentos','Streaming','Restaurante','Tecnologia','Presentes','Vestuario','Lazer','Pessoal','Transferencias','Outros','A classificar'];
const CATS_INC = ['Salario','Freelance','Bonus','Renda Extra','Investimentos','Transferencias','Outra Fonte'];
const PAY_METHODS = ['pix','credit','debit','boleto','cash'];
const PAY_LABELS = {pix:'Pix',credit:'Crédito',debit:'Débito',boleto:'Boleto',cash:'Dinheiro'};
const CAT_COLORS = ['#FF3F5B','#4C7BFD','#00D26A','#F5A623','#9B72F6','#20C4F4','#FF7A00','#E86FD8','#52CC83','#F5D020','#FF6B6B','#74B9FF','#A8E063','#FD79A8','#6C5CE7','#FDCB6E','#00CEC9'];

// ===================== DOMAIN =====================
const toCents = v => Math.round(parseFloat(String(v).replace(',','.')) * 100) || 0;
const fromCents = c => (c / 100).toFixed(2);
const fmt = c => {
  const s = (Math.abs(c) / 100).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  return 'R$ ' + s;
};
const fmtSigned = c => {
  const sign = c < 0 ? '-' : '+';
  return sign + ' ' + fmt(Math.abs(c));
};
const fmtPct = v => Math.abs(v).toFixed(1) + '%';
const uuid = () => Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 7);
const todayISO = () => new Date().toISOString().split('T')[0];
const dateToMonthYear = d => {
  const p = d.split('-');
  return { month: parseInt(p[1]), year: parseInt(p[0]) };
};

const filterMonth = (txns, m, y) => txns.filter(t => t.month === m && t.year === y);
const filterType = (txns, tp) => txns.filter(t => t.type === tp);
const sumAmts = txns => txns.reduce((s, t) => s + t.amount, 0);
const savingsRate = (inc, exp) => inc === 0 ? 0 : ((inc - exp) / inc * 100);

const groupByCat = txns => {
  const acc = {};
  txns.forEach(t => { acc[t.category] = (acc[t.category] || 0) + t.amount; });
  return Object.entries(acc).sort(([,a],[,b]) => b - a).map(([cat, amt]) => ({ cat, amt }));
};

const groupsByType = txns => {
  const acc = { necessidades: 0, desejos: 0, futuro: 0, a_classificar: 0, fora_orcamento: 0 };
  txns.forEach(t => {
    const group = t.group === 'outros' ? 'a_classificar' : t.group;
    if (acc[group] !== undefined) acc[group] += t.amount;
  });
  return acc;
};

const getMonthlyTotals = (txns, year) =>
  Array.from({ length: 12 }, (_, i) => {
    const m = filterMonth(txns, i + 1, year);
    const inc = sumAmts(filterType(m, 'income'));
    const exp = sumAmts(filterType(m, 'expense'));
    return { month: i + 1, label: MONTHS[i], inc, exp, net: inc - exp };
  });

const buildCalGrid = (year, month) => {
  const fd = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  return [...Array(fd).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
};

// ===================== STATE =====================
const FinCtx = createContext(null);
const now = new Date();
const INIT_STATE = { transactions: [], accounts: {}, plan: null, imports: [], updatedAt: null, view: 'dashboard', month: now.getMonth() + 1, year: now.getFullYear(), loading: true, syncing: false, error: null, toast: null };

function reducer(state, action) {
  switch (action.type) {
    case 'LOAD': return { ...state, ...action.payload, loading: false, error: null };
    case 'ADD_TXN': return { ...state, transactions: [...state.transactions, action.payload] };
    case 'UPD_TXN': return { ...state, transactions: state.transactions.map(t => t.id === action.payload.id ? { ...t, ...action.payload } : t) };
    case 'DEL_TXN': return { ...state, transactions: state.transactions.filter(t => t.id !== action.id) };
    case 'SET_VIEW': return { ...state, view: action.payload };
    case 'SET_MONTH': return { ...state, month: action.month, year: action.year };
    case 'SET_SYNCING': return { ...state, syncing: action.payload };
    case 'ERROR': return { ...state, error: action.payload, loading: false };
    case 'TOAST': return { ...state, toast: action.payload };
    default: return state;
  }
}

// ===================== PROVIDER =====================
function FinProvider({ user, children }) {
  const [state, dispatch] = useReducer(reducer, INIT_STATE);
  const updatedRef = useRef(null);

  const load = useCallback(async (silent) => {
    try {
      if (silent) dispatch({ type:'SET_SYNCING', payload:true });
      const q = silent && updatedRef.current ? `?since=${encodeURIComponent(updatedRef.current)}` : '';
      const d = await api(`/api/data${q}`);
      if (!d.unchanged) {
        updatedRef.current = d.updatedAt;
        dispatch({ type:'LOAD', payload:{ transactions:d.transactions, accounts:d.accounts || {}, plan:d.plan, imports:d.imports || [], updatedAt:d.updatedAt } });
      }
    } catch (e) {
      if (!silent) dispatch({ type:'ERROR', payload:e.message });
    } finally { if (silent) dispatch({ type:'SET_SYNCING', payload:false }); }
  }, []);

  // Primeira carga: abre no mês mais recente que tenha lançamentos.
  useEffect(() => {
    (async () => {
      await load(false);
    })();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 20000);
    const onFocus = () => load(true);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const toast = (text, type = 'success') => {
    dispatch({ type:'TOAST', payload:{ text, type } });
    setTimeout(() => dispatch({ type:'TOAST', payload:null }), 3500);
  };

  const persist = async list => {
    const r = await api('/api/transactions', { method:'POST', body:list });
    return r.transactions;
  };

  const actions = {
    reload: () => load(false),
    toast,
    addTxn: async txn => {
      const [saved] = await persist([{ titular:user.id, account:`manual-${user.id}`, ...txn }]);
      dispatch({ type:'ADD_TXN', payload:saved });
      toast('Lançamento salvo');
    },
    updTxn: async txn => {
      const [saved] = await persist([txn]);
      dispatch({ type:'UPD_TXN', payload:saved });
      toast('Lançamento atualizado');
    },
    delTxn: async id => {
      await api(`/api/transactions?id=${encodeURIComponent(id)}`, { method:'DELETE' });
      dispatch({ type:'DEL_TXN', id });
      toast('Lançamento excluído');
    },
    setTxnCategory: async (txnId, category) => {
      const txn = state.transactions.find(item => item.id === txnId);
      if (!txn) return;
      const group = txn.type === 'expense' ? (CATEGORY_GROUPS[category] || 'a_classificar') : null;
      const updated = { ...txn, category, categoryOverride:category, group };
      dispatch({ type:'UPD_TXN', payload:updated });
      try { await persist([updated]); toast(`Categoria: ${catLabel(category)}`); }
      catch (e) { dispatch({ type:'UPD_TXN', payload:txn }); toast(e.message, 'error'); }
    },
    savePlan: async plan => { await api('/api/plan', { method:'PUT', body:{ plan } }); },
  };

  return <FinCtx.Provider value={{ state, dispatch, actions, user }}>{children}</FinCtx.Provider>;
}


const useFin = () => useContext(FinCtx);

// ===================== TOOLTIP HOOK =====================
function useTooltip() {
  const [tooltip, setTooltip] = useState(null);
  const show = useCallback((e, content) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ x: rect.left + rect.width / 2, y: rect.top - 8, content });
  }, []);
  const hide = useCallback(() => setTooltip(null), []);
  return { tooltip, show, hide };
}

function Tooltip({ tooltip }) {
  if (!tooltip) return null;
  return (
    <div style={{
      position: 'fixed', left: tooltip.x, top: tooltip.y,
      transform: 'translate(-50%,-100%)',
      background: 'var(--s3)', border: '1px solid var(--bd2)',
      borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--t1)',
      pointerEvents: 'none', zIndex: 9999, whiteSpace: 'nowrap',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    }}>
      {tooltip.content}
      <div style={{ position:'absolute', left:'50%', bottom:-5, transform:'translateX(-50%)',
        width:8, height:8, background:'var(--s3)', border:'1px solid var(--bd2)',
        borderTop:'none', borderLeft:'none', transform:'translateX(-50%) rotate(45deg)' }}/>
    </div>
  );
}

// ===================== DONUT CHART (Interactive) =====================
function DonutChart({ data, total, size = 200 }) {
  const { tooltip, show, hide } = useTooltip();
  const [hovered, setHovered] = useState(null);
  if (!data.length) return <div style={{ textAlign:'center', color:'var(--t3)', padding:40 }}>Sem dados</div>;
  const r = 72, cx = size / 2, cy = size / 2, stroke = 26;
  let acc = 0;
  const slices = data.slice(0, 10).map((d, i) => {
    const pct = d.amt / total;
    const start = acc * 2 * Math.PI - Math.PI / 2;
    acc += pct;
    const end = acc * 2 * Math.PI - Math.PI / 2;
    const lg = end - start > Math.PI ? 1 : 0;
    const expand = hovered === i ? 4 : 0;
    const midAngle = (start + end) / 2;
    const ox = Math.cos(midAngle) * expand;
    const oy = Math.sin(midAngle) * expand;
    const x1 = cx + ox + r * Math.cos(start), y1 = cy + oy + r * Math.sin(start);
    const x2 = cx + ox + r * Math.cos(end), y2 = cy + oy + r * Math.sin(end);
    return { ...d, path: `M ${cx + ox} ${cy + oy} L ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2} Z`, color: CAT_COLORS[i % CAT_COLORS.length], i, pct };
  });
  return (
    <>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow:'visible' }}>
        <circle cx={cx} cy={cy} r={r} fill="var(--s2)" />
        {slices.map((s) => (
          <path key={s.i} d={s.path} fill={s.color}
            opacity={hovered === null || hovered === s.i ? 0.92 : 0.45}
            style={{ cursor:'pointer', transition:'opacity 0.15s' }}
            onMouseEnter={e => { setHovered(s.i); show(e, s.cat + ' — ' + fmt(s.amt) + ' (' + (s.pct * 100).toFixed(1) + '%)'); }}
            onMouseLeave={() => { setHovered(null); hide(); }}
            onTouchStart={e => { setHovered(s.i); }}
            onTouchEnd={() => { setHovered(null); }}
          />
        ))}
        <circle cx={cx} cy={cy} r={r - stroke} fill="var(--s1)" />
        <text x={cx} y={cy - 8} textAnchor="middle" fill="var(--t3)" fontSize="10">Total</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--t1)" fontSize="13" fontWeight="700">
          {(total / 100).toLocaleString('pt-BR', { minimumFractionDigits:0, maximumFractionDigits:0 })}
        </text>
      </svg>
      <Tooltip tooltip={tooltip} />
    </>
  );
}

// ===================== LINE CHART (Interactive) =====================
function LineChart({ data, width = 520, height = 170 }) {
  const { tooltip, show, hide } = useTooltip();
  if (!data.length || data.every(d => d.inc === 0 && d.exp === 0))
    return <div style={{ height, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t3)' }}>Sem dados</div>;
  const pad = { t:16, b:34, l:60, r:16 };
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const vals = [...data.flatMap(d => [d.inc, d.exp])].filter(v => v > 0);
  const maxV = Math.max(...vals) || 1;
  const scX = i => pad.l + i * (W / (data.length - 1 || 1));
  const scY = v => pad.t + H - (v / maxV) * H;
  const pathOf = key => {
    const pts = data.map((d, i) => `${scX(i)},${scY(d[key])}`);
    return 'M ' + pts.join(' L ');
  };
  return (
    <>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow:'visible' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <line key={t} x1={pad.l} x2={width - pad.r} y1={pad.t + H * (1 - t)} y2={pad.t + H * (1 - t)} stroke="var(--bd)" strokeWidth=".5" />
        ))}
        {data.map((d, i) => (
          <text key={i} x={scX(i)} y={height - 6} textAnchor="middle" fill="var(--t3)" fontSize="10">{d.label}</text>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <text key={i} x={pad.l - 6} y={pad.t + H * (1 - t) + 4} textAnchor="end" fill="var(--t3)" fontSize="9">
            {maxV * t >= 100000 ? `${(maxV * t / 100000).toFixed(1).replace('.', ',')}k` : (maxV * t / 100).toFixed(0)}
          </text>
        ))}
        <path d={pathOf('inc')} fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={pathOf('exp')} fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => (
          <g key={i}>
            {d.inc > 0 && (
              <circle cx={scX(i)} cy={scY(d.inc)} r="5" fill="var(--green)"
                style={{ cursor:'pointer' }}
                onMouseEnter={e => show(e, MONTHS_F[d.month - 1] + ' — Entrada: ' + fmt(d.inc))}
                onMouseLeave={hide}
              />
            )}
            {d.exp > 0 && (
              <circle cx={scX(i)} cy={scY(d.exp)} r="5" fill="var(--red)"
                style={{ cursor:'pointer' }}
                onMouseEnter={e => show(e, MONTHS_F[d.month - 1] + ' — Saida: ' + fmt(d.exp))}
                onMouseLeave={hide}
              />
            )}
          </g>
        ))}
      </svg>
      <Tooltip tooltip={tooltip} />
    </>
  );
}

// ===================== BAR CHART (Interactive) =====================
function BarChart({ data, width = 420, height = 150 }) {
  const { tooltip, show, hide } = useTooltip();
  const [hovered, setHovered] = useState(null);
  if (!data.length) return null;
  const pad = { t:12, b:30, l:10, r:10 };
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const maxV = Math.max(...data.flatMap(d => [d.inc, d.exp])) || 1;
  const bw = Math.max(6, (W / (data.length * 2.8)) - 2);
  const gap = W / data.length;
  return (
    <>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow:'visible' }}>
        {data.map((d, i) => {
          const x = pad.l + i * gap + gap / 2;
          const hI = (d.inc / maxV) * H, hE = (d.exp / maxV) * H;
          return (
            <g key={i}>
              <rect x={x - bw - 1} y={pad.t + H - hI} width={bw} height={hI} fill="var(--green)" rx="3"
                opacity={hovered === null || hovered === i + 'i' ? 0.85 : 0.35}
                style={{ cursor:'pointer' }}
                onMouseEnter={e => { setHovered(i + 'i'); show(e, d.label + ' Entrada: ' + fmt(d.inc)); }}
                onMouseLeave={() => { setHovered(null); hide(); }}
              />
              <rect x={x + 1} y={pad.t + H - hE} width={bw} height={hE} fill="var(--red)" rx="3"
                opacity={hovered === null || hovered === i + 'e' ? 0.85 : 0.35}
                style={{ cursor:'pointer' }}
                onMouseEnter={e => { setHovered(i + 'e'); show(e, d.label + ' Saida: ' + fmt(d.exp)); }}
                onMouseLeave={() => { setHovered(null); hide(); }}
              />
              <text x={x} y={height - 8} textAnchor="middle" fill="var(--t3)" fontSize="9">{d.label}</text>
            </g>
          );
        })}
      </svg>
      <Tooltip tooltip={tooltip} />
    </>
  );
}

// ===================== HEATMAP CHART (Interactive) =====================
function HeatmapChart({ txns }) {
  const { tooltip, show, hide } = useTooltip();
  const days = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];
  const weeks = ['S1','S2','S3','S4','S5'];
  const grid = Array.from({ length: 7 }, () => Array(5).fill(0));
  txns.forEach(t => {
    if (t.type !== 'expense') return;
    const d = new Date(t.date + 'T12:00:00');
    const day = d.getDay();
    const firstDay = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
    const week = Math.floor((d.getDate() - 1 + firstDay) / 7);
    if (week < 5) grid[day][week] += t.amount;
  });
  const max = Math.max(...grid.flatMap(r => r)) || 1;
  const cellColor = v => {
    if (!v) return 'var(--s3)';
    const intensity = v / max;
    if (intensity < 0.2) return 'rgba(255,63,91,.15)';
    if (intensity < 0.4) return 'rgba(255,63,91,.3)';
    if (intensity < 0.6) return 'rgba(255,63,91,.5)';
    if (intensity < 0.8) return 'rgba(255,63,91,.7)';
    return 'rgba(255,63,91,.95)';
  };
  return (
    <>
      <div style={{ display:'flex', gap:3, marginBottom:4, marginLeft:38 }}>
        {weeks.map(w => <div key={w} style={{ width:44, textAlign:'center', fontSize:10, color:'var(--t3)' }}>{w}</div>)}
      </div>
      {days.map((day, di) => (
        <div key={day} style={{ display:'flex', alignItems:'center', gap:3, marginBottom:3 }}>
          <div style={{ width:34, fontSize:10, color:'var(--t3)', textAlign:'right', paddingRight:4 }}>{day}</div>
          {weeks.map((_, wi) => (
            <div key={wi}
              style={{ width:44, height:28, borderRadius:4, background:cellColor(grid[di][wi]),
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:9, color:'rgba(255,255,255,.7)', fontFamily:'monospace', cursor: grid[di][wi] > 0 ? 'pointer' : 'default' }}
              onMouseEnter={grid[di][wi] > 0 ? e => show(e, days[di] + ' ' + weeks[wi] + ': ' + fmt(grid[di][wi])) : undefined}
              onMouseLeave={hide}
            >
              {grid[di][wi] > 0 ? (grid[di][wi] / 100).toFixed(0) : ''}
            </div>
          ))}
        </div>
      ))}
      <Tooltip tooltip={tooltip} />
    </>
  );
}

// ===================== PROGRESS BAR CHART =====================
function CategoryBars({ data, total }) {
  const { tooltip, show, hide } = useTooltip();
  const [hovered, setHovered] = useState(null);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {data.slice(0, 8).map((c, i) => (
        <div key={c.cat}
          style={{ cursor:'pointer', opacity: hovered === null || hovered === i ? 1 : 0.5, transition:'opacity 0.15s' }}
          onMouseEnter={e => { setHovered(i); show(e, c.cat + ': ' + fmt(c.amt) + ' (' + ((c.amt / total) * 100).toFixed(1) + '%)'); }}
          onMouseLeave={() => { setHovered(null); hide(); }}
        >
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:3 }}>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:CAT_COLORS[i % CAT_COLORS.length], display:'inline-block' }} />
              {catLabel(c.cat)}
            </span>
            <span style={{ fontFamily:'monospace', fontSize:11, color:'var(--t2)' }}>{fmt(c.amt)}</span>
          </div>
          <div className="prog-bar">
            <div className="prog-fill" style={{ width:((c.amt / total * 100) || 0) + '%', background:CAT_COLORS[i % CAT_COLORS.length], transition:'width 0.6s ease' }} />
          </div>
        </div>
      ))}
      <Tooltip tooltip={tooltip} />
    </div>
  );
}

// ===================== SPARKLINE =====================
function Sparkline({ values, color = 'var(--green)', height = 40, width = 120 }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values) || 1;
  const min = Math.min(...values);
  const range = max - min || 1;
  const scX = i => (i / (values.length - 1)) * width;
  const scY = v => height - ((v - min) / range) * (height - 6) - 3;
  const pts = values.map((v, i) => scX(i) + ',' + scY(v)).join(' L ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={'M ' + pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ===================== UI COMPONENTS =====================
function MonthSelector({ month, year, onChange }) {
  const prev = () => { if (month === 1) onChange(12, year - 1); else onChange(month - 1, year); };
  const next = () => { if (month === 12) onChange(1, year + 1); else onChange(month + 1, year); };
  return (
    <div className="month-sel">
      <button className="month-btn" onClick={prev}>&#8249;</button>
      <div className="month-display">{MONTHS_F[month - 1].slice(0, 3)} {year}</div>
      <button className="month-btn" onClick={next}>&#8250;</button>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = { paid:'Pago', received:'Recebido', pending:'Pendente', overdue:'Vencido' };
  const icon = status === 'paid' || status === 'received' ? '✓ ' : status === 'pending' ? '○ ' : '! ';
  return <span className={`badge ${status}`}>{icon}{map[status] || status}</span>;
}

function PayBadge({ method }) {
  if (!method) return null;
  return <span className={`pay-badge pay-${method}`}>{PAY_LABELS[method] || method}</span>;
}

function GroupBadge({ group }) {
  const colors = { necessidades:'var(--blue)', desejos:'var(--amber)', futuro:'var(--purple)' };
  const labels = { necessidades:'Necessidades', desejos:'Desejos', futuro:'Futuro' };
  return <span style={{ color:colors[group] || 'var(--t2)', fontSize:11, fontWeight:500 }}>{labels[group] || group}</span>;
}

// ===================== AMOUNT INPUT =====================
function AmountInput({ value, onChange, placeholder = '0,00' }) {
  const [raw, setRaw] = useState(value === '' ? '' : value === 0 ? '' : fromCents(value));

  useEffect(() => {
    if (value === '' || value === 0) setRaw('');
    else setRaw(fromCents(value));
  }, []);

  const handleChange = e => {
    let v = e.target.value;
    // Allow only digits, comma, and dot
    v = v.replace(/[^0-9.,]/g, '');
    // Only one decimal separator
    const parts = v.split(/[.,]/);
    if (parts.length > 2) v = parts[0] + ',' + parts.slice(1).join('');
    setRaw(v);
    const parsed = parseFloat(v.replace(',', '.'));
    if (!isNaN(parsed)) onChange(toCents(parsed));
    else onChange(0);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onChange={handleChange}
      placeholder={placeholder}
    />
  );
}

// ===================== TRANSACTION MODAL =====================
function TxnModal({ txn, type, onSave, onClose }) {
  const { state, user } = useFin();
  const initAmount = txn ? txn.amount : 0;
  const [form, setForm] = useState(txn || {
    titular: user.id, account: `manual-${user.id}`, counterparty: '',
    description:'', amount:0, category: type === 'income' ? 'Salario' : 'Alimentacao',
    group:'necessidades', subcategory:'variable', status: type === 'income' ? 'received' : 'pending',
    paymentMethod:'pix', date:todayISO(), type,
    installments:1, installmentMonth:null,
  });
  const [amtCents, setAmtCents] = useState(initAmount);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const isCredit = form.paymentMethod === 'credit';

  const handleDateChange = v => {
    const { month, year } = dateToMonthYear(v);
    setForm(f => ({ ...f, date:v, month, year }));
  };

  const submit = async () => {
    if (!form.description || amtCents === 0) return;
    const { month, year } = dateToMonthYear(form.date);
    setSaving(true);
    setSaveError('');
    try {
      await onSave({
        ...form, id: txn ? txn.id : uuid(), amount: amtCents,
        month, year, type: form.type || type,
        installments: isCredit ? (parseInt(form.installments) || 1) : 1,
        installmentMonth: isCredit ? (parseInt(form.installmentMonth) || month) : null,
      });
    } catch (error) {
      setSaveError(`Não foi possível salvar. A alteração continua no formulário. ${error?.message || ''}`.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={e => { if (e.target.classList.contains('overlay')) onClose(); }}>
      <div className="modal">
        <div className="modal-title">
          <span>{txn ? 'Editar' : 'Nova'} {type === 'income' ? 'entrada' : 'saída'}</span>
          <button className="btn-icon" onClick={onClose}>&#x2715;</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div className="form-group">
            <label className="lbl">Descrição *</label>
            <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Ex.: Mercado, Salário…" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="lbl">{type === 'income' ? 'Origem (quem pagou)' : 'Destino (quem recebeu)'}</label>
              <input value={form.counterparty || ''} onChange={e => set('counterparty', e.target.value)} placeholder="Ex.: Assaí, Kiwify…" />
            </div>
            <div className="form-group">
              <label className="lbl">Titular</label>
              <select value={form.titular || user.id} onChange={e => setForm(f => ({ ...f, titular:e.target.value, account: f.account && f.account.startsWith('manual-') ? `manual-${e.target.value}` : f.account }))}>
                {Object.entries(HOLDER_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="lbl">Conta</label>
            <select value={form.account || ''} onChange={e => set('account', e.target.value)}>
              {Object.values(state.accounts || {}).filter(a => !a.titular || a.titular === (form.titular || user.id)).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              {form.account && !(state.accounts || {})[form.account] && <option value={form.account}>{form.account}</option>}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="lbl">Valor (R$) *</label>
              <AmountInput value={amtCents} onChange={setAmtCents} />
            </div>
            <div className="form-group">
              <label className="lbl">Data</label>
              <input type="date" value={form.date} onChange={e => handleDateChange(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="lbl">Categoria</label>
              <select value={form.category} onChange={e => { const c = e.target.value; setForm(f => ({ ...f, category:c, group: type === 'expense' ? (CATEGORY_GROUPS[c] || f.group) : f.group })); }}>
                {(type === 'income' ? CATS_INC : CATS_EXP).map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="lbl">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}>
                {type === 'income'
                  ? ['received','pending'].map(s => <option key={s} value={s}>{s === 'received' ? 'Recebido' : 'Pendente'}</option>)
                  : ['paid','pending','overdue'].map(s => <option key={s} value={s}>{s === 'paid' ? 'Pago' : s === 'pending' ? 'Pendente' : 'Vencido'}</option>)}
              </select>
            </div>
          </div>
          {type === 'expense' && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label className="lbl">Grupo (50/30/20)</label>
                  <select value={form.group} onChange={e => set('group', e.target.value)}>
                    <option value="necessidades">Necessidades (50%)</option>
                    <option value="desejos">Desejos (30%)</option>
                    <option value="futuro">Futuro (20%)</option>
                    <option value="fora_orcamento">Fora do orçamento</option>
                    <option value="a_classificar">A classificar</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="lbl">Tipo</label>
                  <select value={form.subcategory} onChange={e => set('subcategory', e.target.value)}>
                    <option value="fixed">Fixo</option>
                    <option value="variable">Variável</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="lbl">Forma de Pagamento</label>
                <select value={form.paymentMethod} onChange={e => set('paymentMethod', e.target.value)}>
                  {PAY_METHODS.map(m => <option key={m} value={m}>{PAY_LABELS[m]}</option>)}
                </select>
              </div>
              {isCredit && (
                <div style={{ background:'var(--s2)', border:'1px solid var(--bd)', borderRadius:'var(--r2)', padding:14, display:'flex', flexDirection:'column', gap:12 }}>
                  <div style={{ fontSize:12, color:'var(--blue)', fontWeight:600 }}>&#128179; Opções de crédito</div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="lbl">Número de parcelas</label>
                      <select value={form.installments} onChange={e => set('installments', parseInt(e.target.value))}>
                        {[1,2,3,4,5,6,7,8,9,10,11,12,18,24,36,48,60].map(n => (
                          <option key={n} value={n}>{n === 1 ? 'À vista (1x)' : n + 'x'}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="lbl">Mês da compra</label>
                      <select value={form.installmentMonth || dateToMonthYear(form.date).month} onChange={e => set('installmentMonth', parseInt(e.target.value))}>
                        {MONTHS_F.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                  {form.installments > 1 && (
                    <div style={{ fontSize:12, color:'var(--t3)', background:'var(--s3)', borderRadius:6, padding:'8px 12px' }}>
                      Valor por parcela: <b style={{ color:'var(--t1)', fontFamily:'monospace' }}>{fmt(Math.round(amtCents / form.installments))}</b>
                      {' '} &#x2022; Parcela atual: {form.installmentMonth || dateToMonthYear(form.date).month}/{dateToMonthYear(form.date).year}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {saveError && <div role="alert" style={{ color:'var(--red)', fontSize:13, lineHeight:1.4 }}>{saveError}</div>}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:8 }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===================== DASHBOARD =====================
function Dashboard() {
  const { state } = useFin();
  const { transactions, month, year } = state;
  const monthTxns = filterMonth(transactions, month, year);
  const incTxns = filterType(monthTxns, 'income');
  const expTxns = filterType(monthTxns, 'expense');
  const inc = sumAmts(incTxns), exp = sumAmts(expTxns), net = inc - exp;
  const sr = savingsRate(inc, exp);
  const monthly = getMonthlyTotals(transactions, year).filter(m => m.inc > 0 || m.exp > 0);
  const catData = groupByCat(expTxns);
  const budgetTxns = expTxns.filter(t => t.group !== 'fora_orcamento');
  const budgetTotal = sumAmts(budgetTxns);
  const groups = groupsByType(budgetTxns);
  const pending = expTxns.filter(t => t.status === 'pending' || t.status === 'overdue');
  const pendingAmt = sumAmts(pending);
  const incHistory = getMonthlyTotals(transactions, year).map(m => m.inc);
  const expHistory = getMonthlyTotals(transactions, year).map(m => m.exp);

  return (
    <div className="content">
      <div className="cards-row">
        <div className="card green">
          <div className="card-label">&#8593; Entradas</div>
          <div className="card-value">{fmt(inc)}</div>
          <div className="card-sub">{incTxns.length} recebimentos</div>
          <div style={{ position:'absolute', bottom:12, right:12 }}><Sparkline values={incHistory} color="var(--green)" /></div>
        </div>
        <div className="card red">
          <div className="card-label">&#8595; Saídas</div>
          <div className="card-value">{fmt(exp)}</div>
          <div className="card-sub">{expTxns.length} transações</div>
          <div style={{ position:'absolute', bottom:12, right:12 }}><Sparkline values={expHistory} color="var(--red)" /></div>
        </div>
        <div className={`card ${net >= 0 ? 'blue' : 'red'}`}>
          <div className="card-label">= Saldo líquido</div>
          <div className="card-value">{fmtSigned(net)}</div>
          <div className="card-sub">{net >= 0 ? 'Superavit' : 'Deficit'} no mes</div>
        </div>
        <div className="card amber">
          <div className="card-label">&#9203; A Pagar</div>
          <div className="card-value">{fmt(pendingAmt)}</div>
          <div className="card-sub">{pending.length} pendentes</div>
        </div>
      </div>

      {inc > 0 && (
        <div className="chart-card">
          <div className="chart-title">Taxa de Poupança</div>
          <div className="chart-sub">{sr >= 0 ? fmtPct(sr) + ' da renda poupada' : 'Gastos excedem renda em ' + fmtPct(Math.abs(sr))}</div>
          <div className="prog-bar" style={{ height:10 }}>
            <div className="prog-fill" style={{ width: Math.min(100, Math.max(0, sr)) + '%', background: sr >= 20 ? 'var(--green)' : sr >= 0 ? 'var(--amber)' : 'var(--red)', transition:'width 0.8s ease' }} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, fontSize:11, color:'var(--t3)' }}>
            <span>Meta: 20%</span>
            <span style={{ color: sr >= 20 ? 'var(--green)' : sr >= 10 ? 'var(--amber)' : 'var(--red)' }}>
              {sr >= 20 ? '✓ Otimo' : sr >= 10 ? 'Razoavel' : 'Melhorar'}
            </span>
          </div>
        </div>
      )}

      <div className="charts-row">
        <div className="chart-card">
          <div className="chart-title">Evolução Anual {year}</div>
          <div className="chart-sub">Entradas vs saídas — passe o mouse nos pontos</div>
          <LineChart data={monthly} />
          <div className="legend">
            <div className="legend-item"><div className="legend-dot" style={{ background:'var(--green)' }} /> Entradas</div>
            <div className="legend-item"><div className="legend-dot" style={{ background:'var(--red)' }} /> Saídas</div>
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-title">Gastos por categoria</div>
          <div className="chart-sub">Passe o mouse para detalhes</div>
          <div style={{ display:'flex', gap:16, alignItems:'flex-start' }}>
            <DonutChart data={catData} total={exp} />
            <div style={{ flex:1, overflow:'hidden' }}>
              <CategoryBars data={catData} total={exp} />
            </div>
          </div>
        </div>
      </div>

      {exp > 0 && (
        <div className="chart-card">
          <div className="chart-title">Regra 50/30/20</div>
          <div className="chart-sub">Necessidades · Desejos · Futuro. Transferencias ficam fora dos percentuais.</div>
          <div className="budget-split">
            {[
              { key:'necessidades', label:'Necessidades', target:50, color:'var(--blue)' },
              { key:'desejos', label:'Desejos', target:30, color:'var(--amber)' },
              { key:'futuro', label:'Futuro / Poupanca', target:20, color:'var(--purple)' },
              { key:'a_classificar', label:'A classificar', target:null, color:'var(--red)' },
            ].map(g => {
              const amt = groups[g.key] || 0;
              const pct = budgetTotal ? (amt / budgetTotal) * 100 : 0;
              const ok = g.target != null && pct <= g.target;
              return (
                <div key={g.key} className="budget-item">
                  <div className="budget-cat"><span className="budget-cat-dot" style={{ background:g.color }} />{g.label}</div>
                  <div className="budget-amt" style={{ color:g.color }}>{fmt(amt)}</div>
                  <div className="budget-target">{pct.toFixed(1)}%{g.target == null ? ' · revisar categoria' : ` · meta ${g.target}% ${ok ? '✓' : '!'}`}</div>
                  <div className="prog-bar" style={{ height:8 }}>
                    <div className="prog-fill" style={{ width: Math.min(100, pct) + '%', background:g.color, transition:'width 0.8s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="table-wrap">
          <div className="table-header"><div className="table-title">&#9888; Pendencias do Mes</div></div>
          <table>
            <thead><tr><th>Descricao</th><th>Categoria</th><th>Vencimento</th><th>Valor</th><th>Status</th></tr></thead>
            <tbody>
              {pending.map(t => (
                <tr key={t.id}>
                  <td>{t.description}</td><td>{t.category}</td><td>{t.date}</td>
                  <td style={{ fontFamily:'monospace', color:'var(--red)' }}>{fmt(t.amount)}</td>
                  <td><StatusBadge status={t.status} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan="3">Total pendente</td><td colSpan="2" style={{ color:'var(--red)' }}>{fmt(pendingAmt)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ===================== INCOME PAGE =====================
function IncomePage() {
  const { state, actions } = useFin();
  const { transactions, month, year, accounts } = state;
  const [modal, setModal] = useState(null);
  const monthTxns = filterMonth(filterType(transactions, 'income'), month, year);
  const internal = sumAmts(monthTxns.filter(t => t.category === 'Transferencias'));
  const total = sumAmts(monthTxns);
  const received = sumAmts(monthTxns.filter(t => t.status === 'received'));
  const save = async txn => {
    if (txn.id && transactions.find(t => t.id === txn.id)) await actions.updTxn(txn);
    else await actions.addTxn({ ...txn, type:'income' });
    setModal(null);
  };
  return (
    <div className="content">
      <div className="cards-row">
        <div className="card green"><div className="card-label">Total de entradas</div><div className="card-value">{fmt(total)}</div><div className="card-sub">{monthTxns.length} lançamentos</div></div>
        <div className="card blue"><div className="card-label">Recebido</div><div className="card-value">{fmt(received)}</div></div>
        <div className="card amber"><div className="card-label">Pendente</div><div className="card-value">{fmt(total - received)}</div></div>
        <div className="card purple"><div className="card-label">Transferências entre vocês</div><div className="card-value">{fmt(internal)}</div><div className="card-sub">não é renda nova</div></div>
      </div>
      <TxnTable type="income" title={`Entradas — ${MONTHS_F[month - 1]} ${year}`} rows={monthTxns} accounts={accounts}
        onNew={() => setModal({ type:'income' })} onEdit={t => setModal({ ...t, _edit:true })} onDelete={actions.delTxn}
        onCategory={(t, c) => actions.setTxnCategory(t.id, c)} />
      {modal && <TxnModal txn={modal._edit ? modal : null} type="income" onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}

// ===================== EXPENSES PAGE =====================
function ExpensesPage() {
  const { state, actions } = useFin();
  const { transactions, month, year, accounts } = state;
  const [modal, setModal] = useState(null);
  const monthTxns = filterMonth(filterType(transactions, 'expense'), month, year);
  const total = sumAmts(monthTxns);
  const pending = sumAmts(monthTxns.filter(t => t.status === 'pending' || t.status === 'overdue'));
  const creditTotal = sumAmts(monthTxns.filter(t => t.paymentMethod === 'credit'));
  const unclassified = monthTxns.filter(t => t.category === 'A classificar' || t.category === 'Outros').length;
  const save = async txn => {
    if (txn.id && transactions.find(t => t.id === txn.id)) await actions.updTxn(txn);
    else await actions.addTxn({ ...txn, type:'expense' });
    setModal(null);
  };
  return (
    <div className="content">
      <div className="cards-row">
        <div className="card red"><div className="card-label">Total de saídas</div><div className="card-value">{fmt(total)}</div><div className="card-sub">{monthTxns.length} lançamentos</div></div>
        <div className="card blue"><div className="card-label">No cartão de crédito</div><div className="card-value">{fmt(creditTotal)}</div></div>
        <div className="card amber"><div className="card-label">Pendente / vencido</div><div className="card-value">{fmt(pending)}</div></div>
        <div className="card purple"><div className="card-label">A classificar</div><div className="card-value">{unclassified}</div><div className="card-sub">troque a categoria direto na tabela</div></div>
      </div>
      <TxnTable type="expense" title={`Saídas — ${MONTHS_F[month - 1]} ${year}`} rows={monthTxns} accounts={accounts}
        onNew={() => setModal({ type:'expense' })} onEdit={t => setModal({ ...t, _edit:true })} onDelete={actions.delTxn}
        onCategory={(t, c) => actions.setTxnCategory(t.id, c)} />
      {modal && <TxnModal txn={modal._edit ? modal : null} type="expense" onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}


// ===================== CALENDAR PAGE =====================
function CalendarPage() {
  const { state } = useFin();
  const { transactions, month, year } = state;
  const monthTxns = filterMonth(transactions, month, year);
  const [selected, setSelected] = useState(null);
  const today = new Date();
  const isToday = d => d === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear();
  const grid = buildCalGrid(year, month);
  const byDay = {};
  monthTxns.forEach(t => {
    const d = parseInt(t.date.split('-')[2]);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(t);
  });
  const selTxns = selected ? byDay[selected] || [] : [];

  return (
    <div className="content">
      <div className="chart-card">
        <div className="chart-title">Calendario — {MONTHS_F[month - 1]} {year}</div>
        <div className="chart-sub">Toque em um dia para ver as transações</div>
        <div className="cal-grid" style={{ marginTop:12 }}>
          {['Dom','Seg','Ter','Qua','Qui','Sex','Sab'].map(d => <div key={d} className="cal-hdr">{d}</div>)}
          {grid.map((d, i) => {
            if (!d) return <div key={`e${i}`} className="cal-day empty" />;
            const txns = byDay[d] || [];
            const inc = txns.filter(t => t.type === 'income');
            const exp = txns.filter(t => t.type === 'expense');
            return (
              <div key={d} className={`cal-day ${isToday(d) ? 'today' : ''}`}
                style={selected === d ? { borderColor:'var(--green)', background:'var(--green-dim)' } : {}}
                onClick={() => setSelected(selected === d ? null : d)}>
                <div className="cal-day-num">{d}</div>
                <div className="cal-dots">
                  {inc.map((_, j) => <div key={`i${j}`} className="cal-dot" style={{ background:'var(--green)' }} />)}
                  {exp.map((_, j) => <div key={`e${j}`} className="cal-dot" style={{ background:'var(--red)' }} />)}
                </div>
                {txns.length > 0 && <div style={{ fontSize:9, color:'var(--t3)', marginTop:2 }}>{fmt(sumAmts(txns))}</div>}
              </div>
            );
          })}
        </div>
      </div>
      {selected && (
        <div className="table-wrap">
          <div className="table-header">
            <div className="table-title">Transacoes — {selected}/{String(month).padStart(2, '0')}/{year}</div>
          </div>
          {selTxns.length === 0
            ? <div style={{ padding:20, color:'var(--t3)', textAlign:'center' }}>Nenhuma transacao neste dia</div>
            : (
              <table>
                <thead><tr><th>Descricao</th><th>Tipo</th><th>Categoria</th><th>Status</th><th>Valor</th></tr></thead>
                <tbody>
                  {selTxns.map(t => (
                    <tr key={t.id}>
                      <td>{t.description}</td>
                      <td><span className={`badge ${t.type === 'income' ? 'received' : 'overdue'}`}>{t.type === 'income' ? '↑ Entrada' : '↓ Saida'}</span></td>
                      <td>{t.category}</td>
                      <td><StatusBadge status={t.status} /></td>
                      <td style={{ fontFamily:'monospace', color: t.type === 'income' ? 'var(--green)' : 'var(--red)', fontWeight:700 }}>{fmt(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}
    </div>
  );
}

// ===================== ANALYTICS PAGE =====================
function AnalyticsPage() {
  const { state } = useFin();
  const { transactions, year } = state;
  const monthly = getMonthlyTotals(transactions, year);
  const activeMonths = monthly.filter(m => m.inc > 0 || m.exp > 0);
  const allExp = filterType(transactions, 'expense');
  const allInc = filterType(transactions, 'income');
  const totalExp = sumAmts(allExp);
  const totalInc = sumAmts(allInc);
  const catData = groupByCat(allExp);
  const creditExp = allExp.filter(t => t.paymentMethod === 'credit');
  const creditTotal = sumAmts(creditExp);
  const installmentExp = allExp.filter(t => t.installments > 1);

  return (
    <div className="content">
      <div className="cards-row">
        <div className="card green"><div className="card-label">Total Entradas {year}</div><div className="card-value">{fmt(totalInc)}</div></div>
        <div className="card red"><div className="card-label">Total Saídas {year}</div><div className="card-value">{fmt(totalExp)}</div></div>
        <div className={`card ${totalInc - totalExp >= 0 ? 'blue' : 'red'}`}>
          <div className="card-label">Saldo Anual</div>
          <div className="card-value">{fmtSigned(totalInc - totalExp)}</div>
        </div>
        <div className="card amber">
          <div className="card-label">Taxa Poupanca Media</div>
          <div className="card-value">{fmtPct(savingsRate(totalInc, totalExp))}</div>
        </div>
      </div>

      <div className="charts-row">
        <div className="chart-card">
          <div className="chart-title">Evolução Mensal {year}</div>
          <div className="chart-sub">Barras comparativas — passe o mouse</div>
          <BarChart data={activeMonths} />
          <div className="legend" style={{ marginTop:8 }}>
            <div className="legend-item"><div className="legend-dot" style={{ background:'var(--green)' }} /> Entradas</div>
            <div className="legend-item"><div className="legend-dot" style={{ background:'var(--red)' }} /> Saídas</div>
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-title">Gastos por categoria (Anual)</div>
          <div className="chart-sub">Todos os meses de {year} — interativo</div>
          <div style={{ display:'flex', gap:12, alignItems:'center' }}>
            <DonutChart data={catData} total={totalExp} size={160} />
            <CategoryBars data={catData} total={totalExp} />
          </div>
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-title">Heatmap de Gastos</div>
        <div className="chart-sub">Distribuicao por dia da semana — passe o mouse nas celulas</div>
        <HeatmapChart txns={allExp} />
      </div>

      {creditTotal > 0 && (
        <div className="chart-card">
          <div className="chart-title">&#128179; Análise de Crédito</div>
          <div className="chart-sub">Gastos no cartao e parcelamentos</div>
          <div className="cards-row" style={{ gridTemplateColumns:'repeat(3,1fr)', marginBottom:16 }}>
            <div className="card blue" style={{ padding:'12px 16px' }}>
              <div className="card-label" style={{ fontSize:10 }}>Total Crédito</div>
              <div className="card-value" style={{ fontSize:18 }}>{fmt(creditTotal)}</div>
            </div>
            <div className="card purple" style={{ padding:'12px 16px' }}>
              <div className="card-label" style={{ fontSize:10 }}>Parcelados</div>
              <div className="card-value" style={{ fontSize:18 }}>{installmentExp.length} itens</div>
            </div>
            <div className="card amber" style={{ padding:'12px 16px' }}>
              <div className="card-label" style={{ fontSize:10 }}>% do Total</div>
              <div className="card-value" style={{ fontSize:18 }}>{totalExp > 0 ? fmtPct(creditTotal / totalExp * 100) : '0%'}</div>
            </div>
          </div>
          {installmentExp.length > 0 && (
            <table>
              <thead><tr><th>Descricao</th><th>Compra</th><th>Parcelas</th><th>Valor/parcela</th><th>Total</th></tr></thead>
              <tbody>
                {installmentExp.map(t => (
                  <tr key={t.id}>
                    <td><b>{t.description}</b></td>
                    <td>{MONTHS_F[(t.installmentMonth || t.month) - 1]}/{t.year}</td>
                    <td style={{ color:'var(--blue)' }}>{t.installments}x</td>
                    <td style={{ fontFamily:'monospace' }}>{fmt(Math.round(t.amount / t.installments))}</td>
                    <td style={{ fontFamily:'monospace', color:'var(--red)' }}>{fmt(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="chart-card">
        <div className="chart-title">Breakdown Mensal Detalhado</div>
        <div className="chart-sub">Mes a mes — entradas, saidas e liquido</div>
        <div style={{ overflowX:'auto' }}>
          <table>
            <thead>
              <tr><th>Mês</th><th>Entradas</th><th>Saídas</th><th>Liquido</th><th>Taxa Poupar</th><th>Status</th></tr>
            </thead>
            <tbody>
              {monthly.filter(m => m.inc > 0 || m.exp > 0).map(m => {
                const sr2 = savingsRate(m.inc, m.exp);
                return (
                  <tr key={m.month}>
                    <td><b>{MONTHS_F[m.month - 1]}</b></td>
                    <td style={{ fontFamily:'monospace', color:'var(--green)' }}>{fmt(m.inc)}</td>
                    <td style={{ fontFamily:'monospace', color:'var(--red)' }}>{fmt(m.exp)}</td>
                    <td style={{ fontFamily:'monospace', color: m.net >= 0 ? 'var(--blue)' : 'var(--red)', fontWeight:700 }}>{fmtSigned(m.net)}</td>
                    <td style={{ fontFamily:'monospace', color: sr2 >= 20 ? 'var(--green)' : sr2 >= 0 ? 'var(--amber)' : 'var(--red)' }}>{fmtPct(Math.abs(sr2))}</td>
                    <td><span className={`badge ${m.net >= 0 ? 'received' : 'overdue'}`}>{m.net >= 0 ? '✓ Superavit' : '! Deficit'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ===================== TITULAR / CARTAO x DEBITO =====================
function TitularPage() {
  const { state } = useFin();
  const { transactions, year } = state;
  const [titular, setTitular] = useState('todos');
  const filtered = transactions.filter(t => t.type === 'expense' && t.year === year && (titular === 'todos' || t.titular === titular));
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const mTxns = filtered.filter(t => t.month === m);
    const cartao = mTxns.filter(t => t.paymentMethod === 'credit').reduce((s, t) => s + t.amount, 0);
    const debito = mTxns.filter(t => t.paymentMethod !== 'credit').reduce((s, t) => s + t.amount, 0);
    return { month: m, label: MONTHS[i], inc: cartao, exp: debito };
  });
  const active = monthly.filter(m => m.inc > 0 || m.exp > 0);
  const totalCartao = monthly.reduce((s, m) => s + m.inc, 0);
  const totalDebito = monthly.reduce((s, m) => s + m.exp, 0);

  return (
    <div className="content">
      <div className="cards-row" style={{ gridTemplateColumns:'repeat(3,1fr)' }}>
        <div className="card blue"><div className="card-label">Cartão {year}</div><div className="card-value">{fmt(totalCartao)}</div></div>
        <div className="card amber"><div className="card-label">Débito/Pix {year}</div><div className="card-value">{fmt(totalDebito)}</div></div>
        <div className="card red"><div className="card-label">Total</div><div className="card-value">{fmt(totalCartao + totalDebito)}</div></div>
      </div>
      <div className="chart-card">
        <div className="chart-title">Cartão vs débito/Pix por mês — {year}</div>
        <div className="chart-sub">
          <select style={{ width:160, display:'inline-block' }} value={titular} onChange={e => setTitular(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="salomao">Salomão</option>
            <option value="elizandra">Elizandra</option>
          </select>
        </div>
        <BarChart data={active} />
        <div className="legend" style={{ marginTop:8 }}>
          <div className="legend-item"><div className="legend-dot" style={{ background:'var(--green)' }} /> Cartao</div>
          <div className="legend-item"><div className="legend-dot" style={{ background:'var(--red)' }} /> Débito/Pix</div>
        </div>
      </div>
      <div className="table-wrap">
        <div className="table-header"><div className="table-title">Detalhamento mensal</div></div>
        <table>
          <thead><tr><th>Mês</th><th>Cartão</th><th>Débito/Pix</th><th>Total</th></tr></thead>
          <tbody>
            {active.length === 0 && <tr><td colSpan="4" style={{ textAlign:'center', color:'var(--t3)', padding:24 }}>Sem dados para este filtro</td></tr>}
            {active.map(m => (
              <tr key={m.month}>
                <td><b>{MONTHS_F[m.month - 1]}</b></td>
                <td style={{ fontFamily:'monospace', color:'var(--green)' }}>{fmt(m.inc)}</td>
                <td style={{ fontFamily:'monospace', color:'var(--red)' }}>{fmt(m.exp)}</td>
                <td style={{ fontFamily:'monospace', fontWeight:700 }}>{fmt(m.inc + m.exp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===================== ICONS =====================
const Icons = {
  dashboard: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>,
  income: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M12 19V5m-7 7 7-7 7 7" /></svg>,
  expense: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M12 5v14m7-7-7 7-7-7" /></svg>,
  calendar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>,
  analytics: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M18 20V10M12 20V4M6 20v-6" /></svg>,
  planning: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /><path d="M8 7h8M8 11h8" /></svg>,
  upload: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></svg>,
  bank: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h18L12 4 3 10Z" /><path d="M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18" /></svg>,
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></svg>,
  menu: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M3 12h18M3 6h18M3 18h18" /></svg>,
  sync: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>,
};

// ===================== APP SHELL =====================
const NAV_SECTIONS = [
  { title:'Visão geral', items:[
    { id:'dashboard', label:'Painel', icon:Icons.dashboard },
    { id:'analytics', label:'Análises', icon:Icons.analytics },
  ] },
  { title:'Lançamentos', items:[
    { id:'expenses', label:'Saídas', icon:Icons.expense },
    { id:'income', label:'Entradas', icon:Icons.income },
    { id:'calendar', label:'Calendário', icon:Icons.calendar },
  ] },
  { title:'Contas', items:[
    { id:'import', label:'Importar extrato', icon:Icons.upload },
    { id:'accounts', label:'Contas e destinos', icon:Icons.bank },
    { id:'titular', label:'Por titular', icon:Icons.users },
  ] },
  { title:'Planejamento', items:[
    { id:'planning', label:'Organização', icon:Icons.planning },
  ] },
];
const NAV = NAV_SECTIONS.flatMap(s => s.items);
const BOTTOM_NAV = ['dashboard', 'expenses', 'import', 'accounts', 'planning'];

function Sidebar({ mobile, onClose }) {
  const { state, dispatch, user } = useFin();
  const { view, transactions, month, year, syncing } = state;
  const monthTxns = filterMonth(transactions, month, year);
  const inc = sumAmts(filterType(monthTxns, 'income'));
  const exp = sumAmts(filterType(monthTxns, 'expense'));
  const net = inc - exp;
  const logout = async () => { await fetch('/api/logout', { method:'POST' }); window.location.href = '/login'; };

  return (
    <>
      {mobile && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${mobile ? 'sidebar-mobile open' : ''}`}>
        <div className="logo">
          <span className="brand-mark">F</span>
          <div><div className="logo-title">Financeiro</div><div className="logo-sub">Família Batista</div></div>
        </div>
        <nav className="nav">
          {NAV_SECTIONS.map(sec => (
            <div key={sec.title} className="nav-section">
              <div className="nav-section-title">{sec.title}</div>
              {sec.items.map(n => (
                <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}`}
                  onClick={() => { dispatch({ type:'SET_VIEW', payload:n.id }); if (onClose) onClose(); }}>
                  <span className="nav-icon">{n.icon}</span>{n.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="balance-card">
            <div className="balance-label">Saldo de {MONTHS_F[month - 1]}</div>
            <div className="balance-value" style={{ color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(net)}</div>
            <div className="balance-split"><span className="pos">+{fmt(inc)}</span><span className="neg">−{fmt(exp)}</span></div>
          </div>
          <div className="user-chip">
            <span className={`avatar avatar-${user.id}`}>{user.name[0]}</span>
            <div className="user-info"><b>{user.name}</b><span><i className={`dot ${syncing ? 'amber' : 'green'}`} />{syncing ? 'sincronizando' : 'sincronizado'}</span></div>
            <a className="btn-icon" href="/api/backup" title="Baixar backup completo">⤓</a>
            <button className="btn-icon" onClick={logout} title="Sair">⏻</button>
          </div>
        </div>
      </aside>
    </>
  );
}

const PAGE_TITLES = { dashboard:'Painel', income:'Entradas', expenses:'Saídas', calendar:'Calendário', analytics:'Análises', titular:'Por titular', planning:'Organização', import:'Importar extrato', accounts:'Contas e destinos' };
const PAGE_SUBS = { dashboard:'Visão geral do mês', income:'De onde veio o dinheiro', expenses:'Para onde foi o dinheiro', calendar:'Pagamentos e recebimentos por dia', analytics:'Tendências e projeções', titular:'Cartão e débito de cada um', planning:'Dívidas, limites, investimentos e desejos', import:'CSV ou OFX do banco → lançamentos automáticos', accounts:'Movimento de cada conta, mês a mês' };

function latestMonth(transactions) {
  const today = new Date().toISOString().slice(0, 10);
  const past = transactions.filter(t => t.date <= today).map(t => t.date).sort();
  const d = past[past.length - 1];
  return d ? { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) } : null;
}

function AppInner() {
  const { state, dispatch, actions, user } = useFin();
  const { view, month, year, loading, error, toast } = state;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const positioned = useRef(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (positioned.current || loading || !state.transactions.length) return;
    positioned.current = true;
    const cur = filterMonth(state.transactions, month, year).length;
    const last = latestMonth(state.transactions);
    if (!cur && last) dispatch({ type:'SET_MONTH', month:last.month, year:last.year });
  }, [loading, state.transactions, month, year, dispatch]);

  const pages = {
    dashboard: <Dashboard />,
    income: <IncomePage />,
    expenses: <ExpensesPage />,
    calendar: <CalendarPage />,
    analytics: <AnalyticsPage />,
    titular: <TitularPage />,
    import: <ImportPage user={user} accounts={state.accounts} imports={state.imports} onImported={actions.reload} />,
    accounts: <AccountsPage transactions={state.transactions} accounts={state.accounts} month={month} year={year} onChanged={actions.reload} />,
    planning: <PlanningPage transactions={state.transactions} month={month} year={year} onSetCategory={actions.setTxnCategory} plan={state.plan} onSavePlan={actions.savePlan} />,
  };

  if (loading || error) return (
    <div className="splash">
      {error ? <><div className="form-error">{error}</div><button className="btn btn-primary" onClick={actions.reload}>Tentar de novo</button></>
        : <><div className="spinner lg" /><div>Carregando dados…</div></>}
    </div>
  );

  return (
    <div className="app">
      {!isMobile && <Sidebar />}
      {isMobile && sidebarOpen && <Sidebar mobile onClose={() => setSidebarOpen(false)} />}
      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            {isMobile && <button className="btn-icon" onClick={() => setSidebarOpen(true)} aria-label="Menu">{Icons.menu}</button>}
            <div className="page-title">{PAGE_TITLES[view]}<span>{PAGE_SUBS[view]}</span></div>
          </div>
          <div className="topbar-right">
            {view !== 'import' && <button className="btn btn-ghost btn-sm hide-sm" onClick={() => dispatch({ type:'SET_VIEW', payload:'import' })}>⇪ Importar extrato</button>}
            <MonthSelector month={month} year={year} onChange={(m, y) => dispatch({ type:'SET_MONTH', month:m, year:y })} />
          </div>
        </header>
        <div className="main-scroll">
          {pages[view] || <Dashboard />}
        </div>
        {isMobile && (
          <nav className="bottom-nav">
            {BOTTOM_NAV.map(id => { const n = NAV.find(x => x.id === id); return (
              <button key={id} className={view === id ? 'active' : ''} onClick={() => dispatch({ type:'SET_VIEW', payload:id })}><span className="nav-icon">{n.icon}</span>{n.label.split(' ')[0]}</button>
            ); })}
          </nav>
        )}
      </main>
      {toast && <div className={`toast ${toast.type}`}>{toast.text}</div>}
    </div>
  );
}

export default function Home({ user }) {
  return (
    <>
      <Head>
        <title>Financeiro Família</title>
        <meta name="description" content="Controle financeiro familiar" />
      </Head>
      <FinProvider user={user}>
        <AppInner />
      </FinProvider>
    </>
  );
}
