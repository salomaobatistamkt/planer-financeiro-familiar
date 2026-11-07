# 💰 Financeiro Família — Salomão & Elizandra

Controle financeiro da família com login próprio, dados no seu servidor (VPS
Hostinger + Coolify) e **importação automática de extratos CSV/OFX**.

## O que mudou nesta versão (3.0)

- **Sem Supabase/Vercel**: um único servidor Next.js guarda tudo em
  `DATA_DIR/financeiro.json` (volume persistente) com backup diário automático
  (`DATA_DIR/backups`, últimos 30 dias). Botão ⤓ na barra lateral baixa o backup completo.
- **Login para Salomão e Elizandra** (cookie assinado, 30 dias). A senha fica só
  na variável de ambiente `SENHA_APP` do Coolify — nunca no código.
- **Importar extrato** (menu *Contas → Importar extrato*): envie o CSV ou OFX do
  banco e o sistema identifica, linha a linha:
  - **conta** (banco pelo código OFX/cabeçalho/nome do arquivo + conta ou cartão + titular);
  - **destino/origem** (nome de quem recebeu ou pagou, extraído da descrição do banco);
  - **categoria** (regras + o que vocês já corrigiram antes para o mesmo destino);
  - **valor, data, forma de pagamento e parcelas** (ex.: "Parcela 2/5");
  - **duplicados** (reenviar o mesmo extrato não lança de novo) e
    **transferências entre vocês / pagamento de fatura** (desmarcadas por padrão para não contar duas vezes).
  Antes de gravar aparece a prévia mês a mês; dá para trocar categorias e desmarcar linhas.
- **Contas e destinos**: movimento de cada conta no mês, saídas por conta nos
  últimos 12 meses e ranking "para onde foi o dinheiro".
- **Planejamento** (dívidas, metas, aportes, desejos, anotações) agora fica no
  servidor e é compartilhado pelos dois. Quem tinha dados no navegador antigo tem
  eles enviados automaticamente no primeiro acesso.
- Layout novo: menu agrupado, tabela com filtros por titular/conta/categoria,
  categoria editável direto na linha, versão celular com menu inferior.

Bancos testados: Nubank (conta e fatura), Banco do Brasil, Inter, Itaú (OFX) e
OFX genérico de conta e cartão. Outros bancos funcionam se o CSV tiver colunas
de data, descrição e valor (ou crédito/débito).

## Dados já existentes

Na primeira inicialização o banco é criado com **1.359 lançamentos**: os 1.232
dos extratos já importados (Nubank da Elizandra set/2025–set/2026 e conta
corrente do Salomão) + 127 lançamentos manuais de mar–mai/2026 (`seed/`).

Se o Supabase antigo voltar a responder, defina `SUPABASE_ANTIGO_URL` e
`SUPABASE_ANTIGO_KEY` **antes do primeiro start**: os lançamentos dele (com as
edições de categoria) substituem os manuais e são mesclados aos extratos.

> `seed/extratos.json` contém dados financeiros pessoais. Mantenha este
> repositório **privado**.

## Deploy no Coolify (VPS Hostinger)

1. Crie o repositório **privado** `planer-financeiro-familiar` no GitHub e envie este código.
2. Coolify → **+ New Resource → Private Repository (GitHub App)** → escolha o repositório, branch `main`.
3. **Build Pack: Dockerfile** (o `Dockerfile` está na raiz). Porta: **3000**.
4. **Environment Variables**:
   - `SENHA_APP` = a senha (a mesma do Dueto Cacau) — vale para Salomão e Elizandra
   - `SESSION_SECRET` = texto aleatório longo (`openssl rand -hex 32`)
   - opcional: `SENHA_SALOMAO`, `SENHA_ELIZANDRA` para senhas diferentes
5. **Storages → + Add → Volume**: destino `/app/data` (sem isso os dados somem a cada deploy).
6. Domínio: ex. `financeiro.seudominio.com.br` (o Coolify gera o HTTPS).
7. **Deploy**. Health check: `/api/health`.

## Rodar localmente

```bash
npm install
SENHA_APP=uma-senha npm run dev
```

Acesse http://localhost:3000 (dados ficam em `./data`, ignorado pelo git).

## Testes

```bash
npm test
```

## Estrutura

```
components/   ImportPage, AccountsPage, TxnTable, PlanningPage
lib/
  importers.js          leitura de OFX/CSV → lançamentos (conta, destino, categoria…)
  finance-categories.js regras de categoria
  server/store.js       banco em arquivo JSON + migração inicial
  server/auth.js        login e sessão
pages/api/    login, logout, data, transactions, import, accounts, plan, backup, health
seed/         dados iniciais (extratos + lançamentos manuais)
```
