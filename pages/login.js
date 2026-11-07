import { useState } from 'react';
import Head from 'next/head';

export async function getServerSideProps({ req }) {
  const { currentUser } = require('../lib/server/auth');
  if (currentUser(req)) return { redirect: { destination: '/', permanent: false } };
  return { props: {} };
}

export default function Login() {
  const [usuario, setUsuario] = useState('salomao');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const entrar = async e => {
    e.preventDefault();
    setErro(''); setEnviando(true);
    try {
      const r = await fetch('/api/login', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ usuario, senha }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Não foi possível entrar');
      window.location.href = '/';
    } catch (err) { setErro(err.message); setEnviando(false); }
  };

  return (
    <>
      <Head><title>Entrar · Financeiro Família</title></Head>
      <div className="login-wrap">
        <form className="login-card" onSubmit={entrar}>
          <div className="login-brand"><span className="brand-mark">F</span><div><div className="brand-name">Financeiro Família</div><div className="brand-sub">Salomão &amp; Elizandra</div></div></div>
          <div className="login-users">
            {[['salomao','Salomão'],['elizandra','Elizandra']].map(([id, nome]) => (
              <button type="button" key={id} className={`login-user ${usuario === id ? 'active' : ''}`} onClick={() => setUsuario(id)}>
                <span className={`avatar avatar-${id}`}>{nome[0]}</span>{nome}
              </button>
            ))}
          </div>
          <label className="lbl" htmlFor="senha">Senha</label>
          <input id="senha" type="password" autoFocus autoComplete="current-password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="Digite sua senha" />
          {erro && <div className="form-error" role="alert">{erro}</div>}
          <button className="btn btn-primary btn-block" disabled={enviando || !senha}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </div>
    </>
  );
}
