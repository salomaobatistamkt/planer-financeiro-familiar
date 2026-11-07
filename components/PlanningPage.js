import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_GROUPS } from '../lib/finance-categories';

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const EXPENSE_CATEGORIES = [
  'Casa','Alimentacao','Transporte','Saude','Educacao','Comunicacao','Trabalho','Pet','Compromissos','Tarifas','Religiao','Transferencias',
  'Dividas','Investimentos','Streaming','Restaurante','Tecnologia','Presentes','Vestuario','Lazer','Pessoal','Outros','A classificar',
];
const GROUP_LABELS = { necessidades:'Essenciais', desejos:'Nao essenciais', futuro:'Futuro / dividas e investimentos', fora_orcamento:'Transferencias (fora da regra)', a_classificar:'A classificar', outros:'A classificar' };
const PRIORITY_LABELS = { high:'Alta', medium:'Media', low:'Baixa' };
const PLAN_KEY = 'finance_plan_v1';

const initialPlan = () => ({
  debts: [],
  investments: [],
  notes: [],
  wishes: [],
  budgets: {},
  extraIncomeTarget: 0,
  debtMethod: 'avalanche',
});

const id = () => `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const centsFromInput = value => {
  const parsed = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
};
const fmt = cents => 'R$ ' + (Math.abs(Number(cents) || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtSigned = cents => `${cents < 0 ? '-' : ''}${fmt(Math.abs(cents))}`;
const toInput = cents => cents ? (cents / 100).toFixed(2) : '';
const dateLabel = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const monthKey = (year, month) => `${year}-${String(month).padStart(2,'0')}`;

function Panel({ title, subtitle, children, action }) {
  return <section className="plan-panel">
    <div className="plan-panel-head"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</div>
    {children}
  </section>;
}

function Field({ label, children }) {
  return <label className="plan-field"><span>{label}</span>{children}</label>;
}

export default function PlanningPage({ transactions, month, year, onSetCategory, plan: serverPlan, onSavePlan }) {
  const [tab, setTab] = useState('Resumo');
  const [plan, setPlan] = useState(initialPlan);
  const [loaded, setLoaded] = useState(false);
  const [budgetCategory, setBudgetCategory] = useState('Alimentacao');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [debtForm, setDebtForm] = useState({ name:'', balance:'', minimum:'', interest:'', dueDay:'' });
  const [investmentForm, setInvestmentForm] = useState({ date:'2026-09-30', institution:'XP Investimentos', amount:'', asset:'', bucket:'A definir', note:'' });
  const [noteForm, setNoteForm] = useState({ title:'', body:'', date:new Date().toISOString().slice(0,10) });
  const [wishForm, setWishForm] = useState({ name:'', price:'', store:'', priority:'medium', targetDate:'', note:'' });
  const [paydowns, setPaydowns] = useState({});
  const [extraTargetInput, setExtraTargetInput] = useState('');
  const [categorySaveError, setCategorySaveError] = useState('');
  const [saveState, setSaveState] = useState('');

  // O planejamento fica no servidor (compartilhado entre Salomão e Elizandra).
  // Se o servidor ainda não tem plano e este navegador tem um salvo da versão
  // antiga, ele é enviado uma vez para o servidor.
  useEffect(() => {
    if (loaded) return;
    const base = initialPlan();
    let source = serverPlan;
    if (!source) {
      try { const saved = localStorage.getItem(PLAN_KEY); if (saved) source = JSON.parse(saved); } catch {}
    }
    const next = source ? { ...base, ...source, investments: Array.isArray(source.investments) ? source.investments : base.investments } : base;
    setPlan(next);
    setExtraTargetInput(toInput(next.extraIncomeTarget || 0));
    setLoaded(true);
    if (!serverPlan && source && onSavePlan) onSavePlan(next).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPlan, loaded]);

  const saveRef = useRef(onSavePlan);
  saveRef.current = onSavePlan;
  const firstSave = useRef(true);
  useEffect(() => {
    if (!loaded) return;
    if (firstSave.current) { firstSave.current = false; return; }
    setSaveState('salvando');
    const timer = setTimeout(() => {
      Promise.resolve(saveRef.current && saveRef.current(plan)).then(() => setSaveState('salvo')).catch(() => setSaveState('erro'));
    }, 700);
    return () => clearTimeout(timer);
  }, [plan, loaded]);

  const update = updater => setPlan(current => typeof updater === 'function' ? updater(current) : { ...current, ...updater });
  const saveCategory = async (transactionId, category) => {
    setCategorySaveError('');
    try {
      await onSetCategory(transactionId, category);
    } catch (error) {
      setCategorySaveError(`Não foi possível salvar a categoria. ${error?.message || 'Tente novamente.'}`);
    }
  };
  const expenses = useMemo(() => transactions.filter(t => t.type === 'expense' && t.month === month && t.year === year), [transactions, month, year]);
  const incomes = useMemo(() => transactions.filter(t => t.type === 'income' && t.month === month && t.year === year), [transactions, month, year]);
  const incomeTotal = incomes.reduce((sum,t) => sum + t.amount, 0);
  const expenseTotal = expenses.reduce((sum,t) => sum + t.amount, 0);
  const investmentMonth = plan.investments.filter(x => String(x.date || '').startsWith(monthKey(year, month))).reduce((sum,x) => sum + (Number(x.amount) || 0), 0);
  const available = incomeTotal - expenseTotal - investmentMonth;
  const actualByGroup = expenses.reduce((acc,t) => { const g = t.group || 'a_classificar'; acc[g] = (acc[g] || 0) + t.amount; return acc; }, {});
  const essentialSpent = actualByGroup.necessidades || 0;
  const reserveTarget = Math.max(0, essentialSpent * 6);
  const reserveContributions = plan.investments.filter(x => x.bucket === 'Reserva de emergencia').reduce((sum,x) => sum + (Number(x.amount) || 0), 0);
  const debtTotal = plan.debts.reduce((sum,d) => sum + Math.max(0, Number(d.balance) || 0), 0);
  const extraIncome = incomes.filter(t => ['Bonus','Freelance','Renda Extra'].includes(t.category)).reduce((sum,t) => sum + t.amount, 0);
  const extraTarget = Number(plan.extraIncomeTarget) || 0;
  const categoryTotals = expenses.reduce((acc,t) => { const c = t.category || 'A classificar'; acc[c] = (acc[c] || 0) + t.amount; return acc; }, {});
  const currentBudgetPrefix = `${monthKey(year,month)}|`;
  const currentBudgets = Object.entries(plan.budgets || {}).filter(([key]) => key.startsWith(currentBudgetPrefix)).map(([key,value]) => ({ category:key.slice(currentBudgetPrefix.length), amount:Number(value) || 0 }));
  const visibleCategories = [...new Set([...Object.keys(categoryTotals), ...currentBudgets.map(x => x.category)])].sort((a,b) => (categoryTotals[b] || 0) - (categoryTotals[a] || 0));
  const unclassified = expenses.filter(t => t.category === 'A classificar' || t.category === 'Outros' || t.group === 'a_classificar' || t.group === 'outros').slice(0,24);
  const sortedDebts = [...plan.debts].sort((a,b) => plan.debtMethod === 'snowball'
    ? (Number(a.balance) || 0) - (Number(b.balance) || 0)
    : (Number(b.interest) || 0) - (Number(a.interest) || 0));
  const sortedWishes = [...plan.wishes].sort((a,b) => ({high:0,medium:1,low:2}[a.priority] - {high:0,medium:1,low:2}[b.priority]) || (Number(a.price) || 0) - (Number(b.price) || 0));

  const saveBudget = () => {
    const amount = centsFromInput(budgetAmount);
    if (!amount) return;
    const key = `${monthKey(year,month)}|${budgetCategory}`;
    update(current => ({ ...current, budgets:{ ...current.budgets, [key]:amount } }));
    setBudgetAmount('');
  };

  const addDebt = event => {
    event.preventDefault();
    const balance = centsFromInput(debtForm.balance);
    if (!debtForm.name.trim() || !balance) return;
    update(current => ({ ...current, debts:[...current.debts, { id:id(), name:debtForm.name.trim(), balance, originalBalance:balance, minimum:centsFromInput(debtForm.minimum), interest:Number(debtForm.interest) || 0, dueDay:debtForm.dueDay, payments:[] }] }));
    setDebtForm({ name:'', balance:'', minimum:'', interest:'', dueDay:'' });
  };

  const payDebt = debt => {
    const amount = centsFromInput(paydowns[debt.id]);
    if (!amount) return;
    update(current => ({ ...current, debts:current.debts.map(d => d.id !== debt.id ? d : ({ ...d, balance:Math.max(0,d.balance - amount), payments:[...(d.payments || []), { date:new Date().toISOString().slice(0,10), amount:Math.min(amount,d.balance) }] })) }));
    setPaydowns(current => ({ ...current, [debt.id]:'' }));
  };

  const addInvestment = event => {
    event.preventDefault();
    const amount = centsFromInput(investmentForm.amount);
    if (!amount || !investmentForm.institution.trim()) return;
    update(current => ({ ...current, investments:[...current.investments, { ...investmentForm, id:id(), date:investmentForm.date || new Date().toISOString().slice(0,10), amount, institution:investmentForm.institution.trim(), asset:investmentForm.asset.trim() || 'Nao especificado', note:investmentForm.note.trim() }] }));
    setInvestmentForm({ date:new Date().toISOString().slice(0,10), institution:'', amount:'', asset:'', bucket:'A definir', note:'' });
  };

  const addNote = event => {
    event.preventDefault();
    if (!noteForm.title.trim() && !noteForm.body.trim()) return;
    update(current => ({ ...current, notes:[{ ...noteForm, id:id(), title:noteForm.title.trim() || 'Anotacao', body:noteForm.body.trim() }, ...current.notes] }));
    setNoteForm({ title:'', body:'', date:new Date().toISOString().slice(0,10) });
  };

  const addWish = event => {
    event.preventDefault();
    if (!wishForm.name.trim()) return;
    update(current => ({ ...current, wishes:[...current.wishes, { ...wishForm, id:id(), name:wishForm.name.trim(), price:centsFromInput(wishForm.price), store:wishForm.store.trim() }] }));
    setWishForm({ name:'', price:'', store:'', priority:'medium', targetDate:'', note:'' });
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({ version:2, exportedAt:new Date().toISOString(), plan }, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup-planejamento-financeiro-${new Date().toISOString().slice(0,10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const tabs = ['Resumo','Categorias','Dividas','Investimentos','Anotacoes','Lista de desejos'];

  return <div className="content plan-page">
    <div className="plan-intro">
      <div>
        <div className="plan-eyebrow">SEU PLANO, UM PASSO DE CADA VEZ</div>
        <h2>Organizacao financeira</h2>
        <p>Inspirada na planilha: conheca seus gastos, reduza dividas, invista todo mes e construa uma reserva de 6 meses do custo essencial.</p>
      </div>
      <div className="plan-intro-actions"><div className="privacy-chip" title="Anotações, dívidas, aportes e desejos ficam no servidor da família, visíveis para Salomão e Elizandra.">{saveState === 'salvando' ? 'Salvando…' : saveState === 'erro' ? 'Erro ao salvar — tente de novo' : 'Salvo na nuvem da família'}</div><button className="btn btn-ghost btn-sm" onClick={exportBackup}>Baixar backup</button></div>
    </div>

    <div className="plan-tabs" role="tablist" aria-label="Areas do planejamento">
      {tabs.map(name => <button key={name} role="tab" aria-selected={tab === name} className={`plan-tab ${tab === name ? 'active' : ''}`} onClick={() => setTab(name)}>{name}</button>)}
    </div>

    {tab === 'Resumo' && <>
      <div className="cards-row plan-cards">
        <div className="card green"><div className="card-label">Entradas do mes</div><div className="card-value">{fmt(incomeTotal)}</div><div className="card-sub">{MONTHS[month - 1]} {year}</div></div>
        <div className="card red"><div className="card-label">Saidas registradas</div><div className="card-value">{fmt(expenseTotal)}</div><div className="card-sub">Inclui as categorias revisadas abaixo</div></div>
        <div className={`card ${available >= 0 ? 'blue' : 'red'}`}><div className="card-label">Sobra estimada apos aportes</div><div className="card-value">{fmtSigned(available)}</div><div className="card-sub">Entradas − saidas − aportes do mes</div></div>
        <div className="card amber"><div className="card-label">Saldo total das dividas</div><div className="card-value">{fmt(debtTotal)}</div><div className="card-sub">Registre os saldos para acompanhar a quitacao</div></div>
      </div>
      <div className="plan-grid-two">
        <Panel title="Plano do mes" subtitle="Acompanhe o dinheiro que entrou, para onde foi e quanto sobrou.">
          {[
            ['Essenciais',actualByGroup.necessidades || 0,'var(--blue)'],
            ['Nao essenciais',actualByGroup.desejos || 0,'var(--amber)'],
            ['Dividas / futuro',actualByGroup.futuro || 0,'var(--purple)'],
            ['Transferencias identificadas',actualByGroup.fora_orcamento || 0,'var(--blue)'],
            ['A classificar', (actualByGroup.a_classificar || 0) + (actualByGroup.outros || 0),'var(--red)'],
          ].map(([label,value,color]) => <div className="plan-meter" key={label}><div><span>{label}</span><b>{fmt(value)}</b></div><div className="prog-bar"><div className="prog-fill" style={{ width:`${expenseTotal ? Math.min(100,Math.max(0,value / expenseTotal * 100)) : 0}%`, background:color }} /></div></div>)}
          <div className="plan-tip">Use a aba Categorias para definir limites por categoria. A classificacao automatica e uma sugestao baseada no texto do lancamento; revise o que ficar em “A classificar”.</div>
        </Panel>
        <Panel title="Reserva de emergencia" subtitle="A planilha usa 6 vezes o custo essencial como referencia.">
          <div className="reserve-numbers"><div><span>Meta estimada</span><b>{fmt(reserveTarget)}</b></div><div><span>Aportes marcados para reserva</span><b>{fmt(reserveContributions)}</b></div></div>
          <div className="prog-bar reserve-bar"><div className="prog-fill" style={{ width:`${reserveTarget ? Math.min(100,reserveContributions / reserveTarget * 100) : 0}%`, background:'var(--green)' }} /></div>
          <div className="plan-tip">A meta e calculada como 6× as despesas classificadas como essenciais no mes selecionado. “Aportes para reserva” soma somente investimentos marcados explicitamente como Reserva de emergencia; nao representa cotacao ou saldo atual.</div>
          <button className="btn btn-ghost btn-sm" onClick={() => setTab('Investimentos')}>Registrar ou revisar aportes</button>
        </Panel>
      </div>
      <div className="plan-grid-two">
        <Panel title="Aumentar a renda extra" subtitle="Meta para renda extra, bonus ou freelance neste mes.">
          <div className="extra-income-row"><div><span>Renda extra registrada</span><b>{fmt(extraIncome)}</b></div><div className="extra-income-edit"><input type="number" min="0" step="0.01" placeholder="Meta mensal (R$)" value={extraTargetInput} onChange={e => setExtraTargetInput(e.target.value)} /><button className="btn btn-primary btn-sm" onClick={() => update(current => ({ ...current, extraIncomeTarget:centsFromInput(extraTargetInput) }))}>Salvar meta</button></div></div>
          {extraTarget > 0 && <div className="prog-bar"><div className="prog-fill" style={{ width:`${Math.min(100,extraIncome / extraTarget * 100)}%`, background:'var(--green)' }} /></div>}
          <div className="plan-tip">Registre novas entradas na aba Entradas. Aqui voce acompanha o progresso em relacao a sua meta.</div>
        </Panel>
        <Panel title="Comece a construir sua carteira" subtitle="Registre seus aportes e objetivos, sem confundir contribuicoes com saldo de mercado.">
          {plan.investments[0] ? <div className="first-investment"><span className="xp-mark">XP</span><div><b>{plan.investments[0].institution}</b><span>{dateLabel(plan.investments[0].date)} · {plan.investments[0].asset || 'Ativo a definir'} · classificacao {plan.investments[0].bucket || 'A definir'}</span></div><strong>{fmt(plan.investments[0].amount)}</strong></div> : <div className="plan-empty">Registre seu primeiro aporte na aba Investimentos. O valor da carteira nao sera estimado automaticamente.</div>}
          <div className="plan-tip">A soma mostra aportes informados, nao rentabilidade nem valor de mercado da carteira.</div>
        </Panel>
      </div>
    </>}

    {tab === 'Categorias' && <>
      <div className="plan-grid-two">
        <Panel title={`Categorias de ${MONTHS[month - 1]} ${year}`} subtitle="Compare o realizado com os limites que voce escolher.">
          <form className="plan-inline-form" onSubmit={e => { e.preventDefault(); saveBudget(); }}>
            <Field label="Categoria"><select value={budgetCategory} onChange={e => setBudgetCategory(e.target.value)}>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Limite mensal (R$)"><input type="number" min="0" step="0.01" placeholder="0,00" value={budgetAmount} onChange={e => setBudgetAmount(e.target.value)} /></Field>
            <button className="btn btn-primary" type="submit">Salvar limite</button>
          </form>
          <div className="category-budget-list">
            {visibleCategories.length === 0 && <div className="plan-empty">Ainda nao ha saidas neste mes. Use a aba Saidas para registrar seus gastos.</div>}
            {visibleCategories.map(category => {
              const actual = categoryTotals[category] || 0;
              const limit = Number(plan.budgets[`${monthKey(year,month)}|${category}`]) || 0;
              const pct = limit ? actual / limit * 100 : 0;
              return <div className="category-budget-row" key={category}>
                <div className="category-budget-heading"><div><b>{category}</b><span>{GROUP_LABELS[CATEGORY_GROUPS[category] || 'a_classificar'] || 'A classificar'}</span></div><div className="category-budget-values"><b>{fmt(actual)}</b><span>{limit ? `de ${fmt(limit)}` : 'sem limite'}</span></div></div>
                <div className="category-budget-edit"><input aria-label={`Limite de ${category}`} type="number" min="0" step="0.01" placeholder="Definir limite (R$)" value={limit ? toInput(limit) : ''} onChange={e => { const key=`${monthKey(year,month)}|${category}`; const amount=centsFromInput(e.target.value); update(current => ({ ...current, budgets:{ ...current.budgets, [key]:amount } })); }} /></div>
                {limit > 0 && <><div className="prog-bar"><div className="prog-fill" style={{ width:`${Math.min(100,Math.max(0,pct))}%`, background:pct > 100 ? 'var(--red)' : 'var(--blue)' }} /></div><small className={pct > 100 ? 'over-budget' : ''}>{pct.toFixed(0)}% do limite{pct > 100 ? ' · acima do planejado' : ''}</small></>}
              </div>;
            })}
          </div>
        </Panel>
        <Panel title="Classificar lancamentos" subtitle="As sugestoes automaticas nao reconhecidas ficam aqui para sua revisao.">
          {categorySaveError && <div role="alert" className="plan-tip" style={{ color:'var(--red)' }}>{categorySaveError}</div>}
          {unclassified.length === 0 ? <div className="plan-empty">Nenhum lancamento “A classificar” neste mes. Se vir uma categoria incorreta, ajuste-a na aba Saidas.</div> : <div className="unclassified-list">
            {unclassified.map(t => <div className="unclassified-row" key={t.id}><div><b>{t.description}</b><span>{dateLabel(t.date)} · {fmt(t.amount)}</span></div><select aria-label={`Categoria de ${t.description}`} defaultValue="A classificar" onChange={e => saveCategory(t.id,e.target.value)}><option value="A classificar">A classificar</option>{EXPENSE_CATEGORIES.filter(c => !['Outros','A classificar'].includes(c)).map(c => <option key={c}>{c}</option>)}</select></div>)}
            <small>Mostrando ate 24 lancamentos deste mes. A classificacao manual e gravada no banco compartilhado.</small>
          </div>}
        </Panel>
      </div>
      <Panel title="Como isso segue a planilha" subtitle="Organiza despesas essenciais e nao essenciais, destaca investimentos e estima a reserva de emergencia.">
        <div className="category-strategy-grid"><div><b>Essenciais</b><span>Moradia, contas, supermercado, saude e transporte.</span></div><div><b>Nao essenciais</b><span>Lazer, restaurantes, assinaturas, compras pessoais e desejos.</span></div><div><b>Futuro</b><span>Investimentos e quitacao de dividas registrados em separado.</span></div><div><b>Reserva</b><span>Referencia de 6 meses de despesas essenciais.</span></div></div>
      </Panel>
    </>}

    {tab === 'Dividas' && <>
      <div className="cards-row plan-cards three">
        <div className="card red"><div className="card-label">Saldo informado</div><div className="card-value">{fmt(debtTotal)}</div></div>
        <div className="card amber"><div className="card-label">Dividas registradas</div><div className="card-value">{plan.debts.length}</div></div>
        <div className="card blue"><div className="card-label">Estrategia de ordem</div><div className="card-value" style={{ fontSize:16 }}>{plan.debtMethod === 'avalanche' ? 'Maior juros primeiro' : 'Menor saldo primeiro'}</div></div>
      </div>
      <Panel title="Plano para quitar" subtitle="Registre saldo, parcela minima e juros para escolher a ordem de ataque.">
        <div className="debt-method-row"><span>Ordenar dividas por</span><select value={plan.debtMethod} onChange={e => update(current => ({ ...current, debtMethod:e.target.value }))}><option value="avalanche">Avalanche · maior taxa de juros primeiro</option><option value="snowball">Bola de neve · menor saldo primeiro</option></select><span className="plan-muted">A ordem e uma ferramenta de organizacao, nao uma recomendacao financeira personalizada.</span></div>
        <form className="plan-form-grid debt-form" onSubmit={addDebt}>
          <Field label="Nome da divida"><input required value={debtForm.name} onChange={e => setDebtForm({ ...debtForm, name:e.target.value })} placeholder="Ex.: cartao, emprestimo" /></Field>
          <Field label="Saldo atual (R$)"><input required type="number" min="0.01" step="0.01" value={debtForm.balance} onChange={e => setDebtForm({ ...debtForm, balance:e.target.value })} placeholder="0,00" /></Field>
          <Field label="Parcela minima (R$)"><input type="number" min="0" step="0.01" value={debtForm.minimum} onChange={e => setDebtForm({ ...debtForm, minimum:e.target.value })} placeholder="0,00" /></Field>
          <Field label="Juros ao mes (%)"><input type="number" min="0" step="0.01" value={debtForm.interest} onChange={e => setDebtForm({ ...debtForm, interest:e.target.value })} placeholder="Se souber" /></Field>
          <Field label="Dia de vencimento"><input type="number" min="1" max="31" value={debtForm.dueDay} onChange={e => setDebtForm({ ...debtForm, dueDay:e.target.value })} placeholder="Dia" /></Field>
          <button className="btn btn-primary" type="submit">+ Adicionar divida</button>
        </form>
        {sortedDebts.length === 0 ? <div className="plan-empty">Nenhuma divida cadastrada. Adicione saldos atuais para montar seu acompanhamento de quitacao.</div> : <div className="debt-list">
          {sortedDebts.map((debt,index) => {
            const paid = Math.max(0,(debt.originalBalance || debt.balance) - debt.balance);
            const pct = debt.originalBalance ? paid / debt.originalBalance * 100 : 0;
            return <div className="debt-card" key={debt.id}>
              <div className="debt-top"><div><span className="debt-rank">#{index+1}</span><b>{debt.name}</b><span>{debt.interest ? `${debt.interest}% a.m.` : 'juros nao informados'}{debt.dueDay ? ` · vence dia ${debt.dueDay}` : ''}</span></div><button className="btn-icon btn-danger" aria-label={`Excluir ${debt.name}`} onClick={() => update(current => ({ ...current, debts:current.debts.filter(d => d.id !== debt.id) }))}>×</button></div>
              <div className="debt-balance-row"><span>Saldo atual <b>{fmt(debt.balance)}</b></span><span>Parcela minima {fmt(debt.minimum || 0)}</span></div>
              <div className="prog-bar"><div className="prog-fill" style={{ width:`${Math.min(100,pct)}%`, background:'var(--green)' }} /></div>
              <small>{pct.toFixed(0)}% quitado desde o saldo cadastrado · {fmt(paid)} pagos</small>
              {debt.balance > 0 && <div className="debt-pay-row"><input type="number" min="0.01" step="0.01" placeholder="Valor pago (R$)" value={paydowns[debt.id] || ''} onChange={e => setPaydowns({ ...paydowns, [debt.id]:e.target.value })} /><button className="btn btn-ghost btn-sm" onClick={() => payDebt(debt)}>Registrar pagamento</button></div>}
              {debt.balance === 0 && <span className="badge received">Divida quitada</span>}
            </div>;
          })}
        </div>}
      </Panel>
      <div className="plan-tip">O acompanhamento de pagamento da divida fica separado dos lancamentos de gastos. Registre tambem a saida na aba Saidas se quiser que ela apareca no fluxo de caixa mensal.</div>
    </>}

    {tab === 'Investimentos' && <>
      <div className="cards-row plan-cards three">
        <div className="card purple"><div className="card-label">Aportes informados</div><div className="card-value">{fmt(plan.investments.reduce((sum,x) => sum + (Number(x.amount) || 0),0))}</div><div className="card-sub">Total de contribuicoes registradas</div></div>
        <div className="card blue"><div className="card-label">Aporte no mes</div><div className="card-value">{fmt(investmentMonth)}</div><div className="card-sub">Entra no calculo da sobra mensal</div></div>
        <div className="card green"><div className="card-label">Reserva registrada</div><div className="card-value">{fmt(reserveContributions)}</div><div className="card-sub">Somente itens marcados como reserva</div></div>
      </div>
      <Panel title="Registrar aporte" subtitle="Informe instituicao, ativo e objetivo. Nao estimamos rentabilidade nem valor de mercado.">
        <form className="plan-form-grid investment-form" onSubmit={addInvestment}>
          <Field label="Data"><input type="date" value={investmentForm.date} onChange={e => setInvestmentForm({ ...investmentForm, date:e.target.value })} /></Field>
          <Field label="Instituicao"><input required value={investmentForm.institution} onChange={e => setInvestmentForm({ ...investmentForm, institution:e.target.value })} placeholder="Ex.: XP Investimentos" /></Field>
          <Field label="Aporte (R$)"><input required type="number" min="0.01" step="0.01" value={investmentForm.amount} onChange={e => setInvestmentForm({ ...investmentForm, amount:e.target.value })} placeholder="0,00" /></Field>
          <Field label="Ativo / produto"><input value={investmentForm.asset} onChange={e => setInvestmentForm({ ...investmentForm, asset:e.target.value })} placeholder="Se ainda nao souber, deixe em branco" /></Field>
          <Field label="Objetivo"><select value={investmentForm.bucket} onChange={e => setInvestmentForm({ ...investmentForm, bucket:e.target.value })}><option>A definir</option><option>Reserva de emergencia</option><option>Renda fixa</option><option>Renda variavel</option><option>Outro objetivo</option></select></Field>
          <Field label="Observacao"><input value={investmentForm.note} onChange={e => setInvestmentForm({ ...investmentForm, note:e.target.value })} placeholder="Opcional" /></Field>
          <button className="btn btn-primary" type="submit">+ Registrar aporte</button>
        </form>
      </Panel>
      <Panel title="Historico de aportes" subtitle="Seus aportes registrados e seus objetivos.">
        {plan.investments.length === 0 ? <div className="plan-empty">Nenhum aporte registrado.</div> : <div className="plan-table-wrap"><table><thead><tr><th>Data</th><th>Instituicao</th><th>Ativo / produto</th><th>Objetivo</th><th>Valor</th><th></th></tr></thead><tbody>{[...plan.investments].sort((a,b) => (b.date || '').localeCompare(a.date || '')).map(x => <tr key={x.id}><td>{dateLabel(x.date)}</td><td><b>{x.institution}</b></td><td>{x.asset || 'Nao especificado'}</td><td>{x.bucket}</td><td className="money-green">{fmt(x.amount)}</td><td><button className="btn-icon btn-danger" aria-label="Excluir aporte" onClick={() => update(current => ({ ...current, investments:current.investments.filter(i => i.id !== x.id) }))}>×</button></td></tr>)}</tbody></table></div>}
        <div className="plan-tip">Este historico soma os aportes declarados. Nao e extrato da XP, nao inclui rendimentos e nao representa o saldo atual da carteira.</div>
      </Panel>
    </>}

    {tab === 'Anotacoes' && <>
      <Panel title="Caderno financeiro" subtitle="Registre decisoes, contas para conferir, ideias para aumentar a renda e aprendizados do mes.">
        <form className="plan-note-form" onSubmit={addNote}>
          <div className="plan-form-grid"><Field label="Data"><input type="date" value={noteForm.date} onChange={e => setNoteForm({ ...noteForm, date:e.target.value })} /></Field><Field label="Titulo"><input value={noteForm.title} onChange={e => setNoteForm({ ...noteForm, title:e.target.value })} placeholder="Ex.: revisar assinatura" /></Field></div>
          <Field label="Anotacao"><textarea rows="4" value={noteForm.body} onChange={e => setNoteForm({ ...noteForm, body:e.target.value })} placeholder="Escreva sua anotacao financeira..." /></Field>
          <button className="btn btn-primary" type="submit">Salvar anotacao</button>
        </form>
      </Panel>
      <Panel title={`Anotacoes (${plan.notes.length})`} subtitle="Mais recentes primeiro.">
        {plan.notes.length === 0 ? <div className="plan-empty">Seu caderno está vazio. As anotações ficam salvas para vocês dois.</div> : <div className="plan-note-list">{[...plan.notes].sort((a,b) => (b.date || '').localeCompare(a.date || '')).map(note => <article className="plan-note" key={note.id}><div><b>{note.title}</b><span>{dateLabel(note.date)}</span></div><p>{note.body}</p><button className="btn btn-ghost btn-sm" onClick={() => update(current => ({ ...current, notes:current.notes.filter(n => n.id !== note.id) }))}>Excluir</button></article>)}</div>}
      </Panel>
    </>}

    {tab === 'Lista de desejos' && <>
      <Panel title="Planejar antes de comprar" subtitle="Compare prioridades, preco, loja e data desejada; nao transforma o desejo em compra automatica.">
        <form className="plan-form-grid wish-form" onSubmit={addWish}>
          <Field label="O que deseja"><input required value={wishForm.name} onChange={e => setWishForm({ ...wishForm, name:e.target.value })} placeholder="Produto ou objetivo" /></Field>
          <Field label="Preco estimado (R$)"><input type="number" min="0" step="0.01" value={wishForm.price} onChange={e => setWishForm({ ...wishForm, price:e.target.value })} placeholder="0,00" /></Field>
          <Field label="Loja / onde comprar"><input value={wishForm.store} onChange={e => setWishForm({ ...wishForm, store:e.target.value })} placeholder="Loja, site ou comparar" /></Field>
          <Field label="Prioridade"><select value={wishForm.priority} onChange={e => setWishForm({ ...wishForm, priority:e.target.value })}><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baixa</option></select></Field>
          <Field label="Data desejada"><input type="date" value={wishForm.targetDate} onChange={e => setWishForm({ ...wishForm, targetDate:e.target.value })} /></Field>
          <Field label="Observacao"><input value={wishForm.note} onChange={e => setWishForm({ ...wishForm, note:e.target.value })} placeholder="Opcional" /></Field>
          <button className="btn btn-primary" type="submit">+ Adicionar desejo</button>
        </form>
      </Panel>
      <Panel title="Sua lista, por prioridade" subtitle={`${plan.wishes.length} itens · total estimado ${fmt(plan.wishes.reduce((sum,x) => sum + (Number(x.price) || 0),0))}`}>
        {sortedWishes.length === 0 ? <div className="plan-empty">Nenhum desejo cadastrado. Adicione uma ideia e compare antes de comprar.</div> : <div className="wish-list">{sortedWishes.map(item => <article className={`wish-card priority-${item.priority}`} key={item.id}><div className="wish-priority">Prioridade {PRIORITY_LABELS[item.priority] || 'Media'}</div><div className="wish-main"><div><h4>{item.name}</h4><span>{item.store || 'Loja a pesquisar'}{item.targetDate ? ` · ate ${dateLabel(item.targetDate)}` : ''}</span>{item.note && <p>{item.note}</p>}</div><strong>{fmt(item.price || 0)}</strong></div><div className="wish-actions"><button className="btn btn-ghost btn-sm" onClick={() => update(current => ({ ...current, wishes:current.wishes.map(w => w.id === item.id ? { ...w, priority:w.priority === 'high' ? 'medium' : w.priority === 'medium' ? 'low' : 'high' } : w) }))}>Mudar prioridade</button><button className="btn btn-ghost btn-sm" onClick={() => update(current => ({ ...current, wishes:current.wishes.filter(w => w.id !== item.id) }))}>Remover</button></div></article>)}</div>}
      </Panel>
      <div className="plan-tip">Antes de comprar, confira se o valor cabe no limite da categoria e se a divida mais urgente e a reserva de emergencia estao no plano.</div>
    </>}
  </div>;
}
