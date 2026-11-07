// Regras locais de classificação. São sugestões: qualquer categoria pode ser
// corrigida na tela e a correção passa a valer para o mesmo destino nas
// próximas importações (ver lib/importers.js -> learnedCategory).

const CATEGORY_GROUPS = {
  Casa: 'necessidades',
  Alimentacao: 'necessidades',
  Transporte: 'necessidades',
  Saude: 'necessidades',
  Educacao: 'necessidades',
  Comunicacao: 'necessidades',
  Trabalho: 'necessidades',
  Pet: 'necessidades',
  Compromissos: 'necessidades',
  Tarifas: 'necessidades',
  Religiao: 'necessidades',
  Dividas: 'futuro',
  Investimentos: 'futuro',
  Streaming: 'desejos',
  Restaurante: 'desejos',
  Tecnologia: 'desejos',
  Presentes: 'desejos',
  Vestuario: 'desejos',
  Lazer: 'desejos',
  Pessoal: 'desejos',
  Transferencias: 'fora_orcamento',
  Outros: 'a_classificar',
  'A classificar': 'a_classificar',
};

const RULES = [
  ['Transferencias', /\b(pagamento de fatura|pagamento fatura|pgto fatura|fatura do cartao|pagamento recebido|transferencia entre contas|mesma titularidade)\b/],
  ['Investimentos', /\b(xp|invest[a-z]*|aplicac[a-z]*|corretora|tesouro|cdb|rdb|fundo|acoes|etf|caixinha|poupanca|guardado|cofrinho)\b/],
  ['Dividas', /\b(emprest[a-z]*|financiamento|consorcio|parcelamento de fatura|acordo de divida|renegocia[a-z]*)\b/],
  ['Tarifas', /\b(tarif[a-z]*|anuidade|iof|juros|mora|encargo[a-z]*|taxa banc[a-z]*|cesta de servicos)\b/],
  ['Religiao', /\b(igreja|dizimo|oferta|ibrecem|paroquia|ministerio)\b/],
  ['Casa', /\b(aluguel|condominio|imobili[a-z]*|energia|eletric[a-z]*|luz|agua|caern|cosern|neoenergia|saneamento|gas|allan gas|iptu|seguro residencial|internet|banda larga|provedor|tv cabo|tcm|construc[a-z]*|material de construcao|y t c monteiro)\b/],
  ['Alimentacao', /\b(supermerc[a-z]*|mercado|mercadinho|atacad[a-z]*|assai|carrefour|nordestao|dia a dia|hortifruti|feira|mercearia|grocery|sacolao|acougue|frigorifico|panificadora|santo doce)\b/],
  ['Saude', /\b(farmacia|drogaria|pague menos|drogasil|raia|hospital|hospitalar|clinica|consulta|medic[a-z]*|plano de saude|unimed|hapvida|laboratorio|odont[a-z]*|dentista|terapia|maternidade|academia)\b/],
  ['Transporte', /\b(uber|uberrides|99app|99 pop|99 tecnologia|taxi|onibus|metro|combust[a-z]*|gasolina|etanol|posto|estacionamento[a-z]*|epar|pedagio|ipva|seguro carro|hinova|auto pecas|oficina|detran)\b/],
  ['Comunicacao', /\b(tim|vivo|claro|oi movel|telefon[a-z]*|recarga)\b/],
  ['Educacao', /\b(escola|faculdade|universidade|curso|mensalidade|udemy|alura|hotmart|material escolar|livraria|sesc)\b/],
  ['Pet', /\b(pet|veterin[a-z]*|cobasi|petz|racao|banho e tosa)\b/],
  ['Trabalho', /\b(mei|das mei|pgmei|das simples|receita federal|simples nacional|contabilidade|ferramenta de trabalho|meta platforms|facebook|google ads|canva|chatgpt|openai|anthropic|claude)\b/],
  ['Compromissos', /\b(seguro de vida|previdencia|documento|cartorio)\b/],
  ['Streaming', /\b(netflix|spotify|hbo|max|disney|globoplay|amazon prime|prime video|youtube premium|deezer|paramount|streaming|onedrive|microsoft|google one|icloud)\b/],
  ['Restaurante', /\b(ifood|restaurante|lanchonete|padaria|delivery|pizzaria|hamburguer[a-z]*|burger|mcdonald|starbucks|cafeteria|cafe|sorvete[a-z]*|acai|churrascaria|espetinho|pao nosso)\b/],
  ['Vestuario', /\b(roupa|vestuario|renner|riachuelo|c&a|cea|shein|zara|marisa|centauro|calcado[a-z]*|tenis|havaianas)\b/],
  ['Tecnologia', /\b(eletro[a-z]*|informat[a-z]*|computador|celular|apple|google play|app store|software|licenc[a-z]*|shopee|shpp|mercado livre|mercadolivre|magalu|amazon|aliexpress|americanas|kabum)\b/],
  ['Presentes', /\b(presente|flores|floricultura|cestas)\b/],
  ['Lazer', /\b(cinema|teatro|show|parque|viagem|hotel|pousada|airbnb|passeio|esporte|jogo|ingresso|sympla)\b/],
  ['Pessoal', /\b(salao|manicure|barbearia|beleza|cosmetico[a-z]*|perfumaria|boticario|natura)\b/],
];

const INCOME_RULES = [
  ['Investimentos', /\b(resgate|rendimento[a-z]*|juros sobre|dividendo[a-z]*|rdb|cdb)\b/],
  ['Salario', /\b(salario|folha|pagamento salario|proventos)\b/],
  ['Renda Extra', /\b(kiwify|hotmart|eduzz|monetizze|wepayments|stripe|bonus|comissao|cashback)\b/],
  ['Freelance', /\b(freelance|marketing|vendas ltda|servicos ltda|consultoria)\b/],
  ['Transferencias', /\b(pagamento recebido|estorno|reembolso)\b/],
];

const GROUP_FALLBACK = 'a_classificar';

function normalize(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim();
}

function suggestCategory(type, text) {
  const n = normalize(text);
  if (type === 'income') {
    const hit = INCOME_RULES.find(([, re]) => re.test(n));
    return { category: hit ? hit[0] : 'Outra Fonte', group: null };
  }
  const hit = RULES.find(([, re]) => re.test(n));
  if (!hit) return { category: 'A classificar', group: GROUP_FALLBACK };
  return { category: hit[0], group: CATEGORY_GROUPS[hit[0]] || GROUP_FALLBACK };
}

function classifyImportedTransaction(txn) {
  if (txn.type !== 'income' && txn.type !== 'expense') return txn;
  const { category, group } = suggestCategory(txn.type, `${txn.description || ''} ${txn.counterparty || ''}`);
  return { ...txn, category, group };
}

module.exports = { CATEGORY_GROUPS, classifyImportedTransaction, suggestCategory, normalize };
