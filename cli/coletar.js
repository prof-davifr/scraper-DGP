#!/usr/bin/env node
/**
 * Coletor DGP headless — varredura do Diretório de Grupos de Pesquisa do CNPq
 * sem navegador (Node nativo + jsdom). Equivalente CLI do app.js do Coletor-DGP.
 *
 * Lê `lista de grupos de pesquisa.txt` (ID\tNome) e gera o CSV no mesmo formato
 * do app.js (`coletor_dgp_YYYY-MM-DD.csv`), consumido pelo build do dashboard.
 *
 * Ao contrário do app.js, não precisa de proxy CORS: o fetch do Node acessa
 * `dgp.cnpq.br` diretamente.
 *
 * Uso:
 *   node cli/coletar.js [--input LISTA] [--out CSV] [--concurrency N]
 *                       [--limit N] [--timeout MS] [--retries N] [--quiet]
 *                       [--base CSV_ANTERIOR] [--max-idade-dias N]
 *
 * Modo incremental (opcional): com `--base`, as linhas do CSV anterior coletadas
 * há menos de `--max-idade-dias` dias (padrão 7) são reaproveitadas; só se
 * buscam no DGP os grupos novos na lista, os que falharam antes e os de coleta
 * antiga. Grupo que saiu da lista sai do CSV. Sem `--base`, varre tudo.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseGroupPage } = require('./parser');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INPUT = path.join(ROOT, 'lista de grupos de pesquisa.txt');
const DGP_URL = 'http://dgp.cnpq.br/dgp/espelhogrupo/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Coluna do CSV → campo do objeto de resultado. A ordem desta lista é a ordem
// do arquivo: identificação, situação, classificação e local, liderança,
// membros (cada contagem ao lado dos nomes) e parcerias; as linhas de
// pesquisa, o texto mais longo, ficam por último. Os consumidores (build do
// dashboard, assets/app.js, scraper-prpgi) leem pelo nome da coluna.
const CSV_COLUNAS = [
  ['ID', 'id'],
  ['Nome Base', 'nomeInformado'],
  ['Data Coleta', 'dataColeta'],
  ['Situação', 'situacao'],
  ['Ano Formação', 'anoFormacao'],
  ['Último Envio', 'ultimoEnvio'],
  ['Área', 'area'],
  ['Instituição', 'instituicao'],
  ['Unidade', 'unidade'],
  ['Líder', 'lider'],
  ['Vice-Líder', 'viceLider'],
  ['Contato', 'contato'],
  ['Pesquisadores', 'pesquisadores'],
  ['Pesquisadores (Nomes)', 'pesquisadoresNomes'],
  ['Estudantes', 'estudantes'],
  ['Estudantes (Nomes)', 'estudantesNomes'],
  ['Técnicos', 'tecnicos'],
  ['Técnicos (Nomes)', 'tecnicosNomes'],
  ['Instituições Parceiras', 'instParceiras'],
  ['INCTs Parceiras', 'inctsParceiras'],
  ['Linhas de Pesquisa', 'linhasPesquisa'],
];
const CSV_HEADERS = CSV_COLUNAS.map(([coluna]) => coluna);

function parseArgs() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };
  return {
    input: opt('--input', DEFAULT_INPUT),
    out: opt('--out', path.join(ROOT, `coletor_dgp_${todayStr()}.csv`)),
    concurrency: parseInt(opt('--concurrency', '5'), 10),
    limit: parseInt(opt('--limit', '0'), 10),
    timeout: parseInt(opt('--timeout', '30000'), 10),
    retries: parseInt(opt('--retries', '3'), 10),
    quiet: args.includes('--quiet'),
    base: opt('--base', ''),
    maxIdadeDias: parseFloat(opt('--max-idade-dias', '7')),
  };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDataColeta(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}, ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function readGroups(inputPath) {
  const text = fs.readFileSync(inputPath, 'utf-8');
  const groups = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    const id = (parts[0] || '').trim();
    if (!/^\d{16}$/.test(id)) continue; // ignora header "#\tNome" e linhas inválidas
    const nome = (parts[1] || '').trim() || 'N/A';
    groups.push({ id, nome });
  }
  return groups;
}

// Lê o CSV gerado por buildCSV (BOM, todos os campos entre aspas, aspas
// dobradas, quebras de linha dentro de campos).
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// "DD/MM/AAAA, HH:MM:SS" (fmtDataColeta) → Date, ou null.
function parseDataColeta(str) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
}

// Linhas reaproveitáveis do CSV anterior, por ID. Descarta cabeçalho diferente,
// linhas de erro (errorData grava '?' em Ano Formação e Líder) e coletas com
// idade >= maxIdadeDias.
function loadBase(csvText, maxIdadeDias, agora = new Date()) {
  const rows = parseCSV(csvText);
  const header = rows.shift() || [];
  if (header.join(',') !== CSV_HEADERS.join(',')) {
    throw new Error(`cabeçalho do CSV base não é o do coletor (${CSV_HEADERS.length} colunas)`);
  }
  const col = (nome) => CSV_HEADERS.indexOf(nome);
  const limiteMs = maxIdadeDias * 86400 * 1000;
  const base = new Map();
  for (const r of rows) {
    if (r.length !== CSV_HEADERS.length) continue;
    if (r[col('Ano Formação')] === '?' && r[col('Líder')] === '?') continue;
    const quando = parseDataColeta(r[col('Data Coleta')]);
    if (!quando || agora - quando >= limiteMs) continue;
    base.set(r[col('ID')], r);
  }
  return base;
}

async function fetchWithRetry(id, opts, log) {
  const url = DGP_URL + id;
  let lastError = null;
  for (let attempt = 1; attempt <= opts.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeout);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      });
      if (!resp.ok) throw new Error(`Status ${resp.status}`);
      const html = await resp.text();
      if (html.length < 1000 || !html.includes('control-label')) {
        throw new Error('Resposta não contém dados DGP (página inválida)');
      }
      const data = parseGroupPage(html);
      if (!data) throw new Error('Parsing falhou: labels não encontrados no HTML');
      return data;
    } catch (e) {
      lastError = e;
      if (e.name === 'AbortError') lastError = new Error(`Timeout após ${opts.timeout}ms`);
      if (attempt < opts.retries) {
        if (!opts.quiet) log(`    retry ${attempt}/${opts.retries} para ${id}: ${lastError.message}`);
        await sleep(1000 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function errorData(group, msg) {
  return {
    id: group.id, nomeInformado: group.nome, error: true, situacao: msg,
    anoFormacao: '?', ultimoEnvio: '?', dataSituacao: '?',
    lider: '?', viceLider: '?', area: '?', instituicao: '?', unidade: '?', contato: '?',
    pesquisadores: 0, estudantes: 0, tecnicos: 0, instParceiras: 0, inctsParceiras: 0,
    pesquisadoresNomes: '?', linhasPesquisa: '?', estudantesNomes: '?', tecnicosNomes: '?',
  };
}

function buildCSV(results) {
  const rows = [CSV_HEADERS.join(',')];
  results.forEach((r) => {
    const vals = r.linhaBase ? r.linhaBase : CSV_COLUNAS.map(([, campo]) => r[campo]);
    rows.push(vals.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(','));
  });
  return '\uFEFF' + rows.join('\n');
}

async function main() {
  const opts = parseArgs();
  const log = (...a) => { if (!opts.quiet) console.log(...a); };

  if (!fs.existsSync(opts.input)) {
    console.error(`ERRO: arquivo de entrada não encontrado: ${opts.input}`);
    process.exit(1);
  }

  const groups = readGroups(opts.input);
  if (groups.length === 0) {
    console.error('ERRO: nenhum grupo (ID de 16 dígitos) encontrado na lista.');
    process.exit(1);
  }
  if (opts.limit > 0) {
    log(`Modo teste: processando apenas os primeiros ${opts.limit} de ${groups.length} grupos.`);
    groups.length = opts.limit;
  }

  const results = [];
  let queue = [...groups];
  if (opts.base) {
    if (!fs.existsSync(opts.base)) {
      console.error(`ERRO: CSV base não encontrado: ${opts.base}`);
      process.exit(1);
    }
    let base;
    try {
      base = loadBase(fs.readFileSync(opts.base, 'utf-8'), opts.maxIdadeDias);
    } catch (e) {
      console.error(`ERRO: ${e.message}`);
      process.exit(1);
    }
    queue = [];
    for (const g of groups) {
      const linha = base.get(g.id);
      if (linha) {
        // O nome vem sempre da lista atual (pode ter mudado no SUAP).
        const linhaBase = [...linha];
        linhaBase[CSV_HEADERS.indexOf('Nome Base')] = g.nome;
        results.push({ id: g.id, linhaBase });
      } else {
        queue.push(g);
      }
    }
    log(`Modo incremental: ${results.length} grupo(s) reaproveitado(s) de ${opts.base} ` +
        `(coleta com menos de ${opts.maxIdadeDias} dia(s)); ${queue.length} a buscar no DGP.`);
  }

  let done = 0;
  let failures = 0;
  const total = queue.length;
  const concurrency = Math.min(opts.concurrency, total);
  const startedAt = Date.now();

  log(`Iniciando varredura de ${total} grupos (${concurrency} paralelos)...`);

  async function worker(workerId) {
    while (queue.length > 0) {
      const group = queue.shift();
      if (!group) break;
      try {
        const data = await fetchWithRetry(group.id, opts, log);
        results.push({
          ...data,
          id: group.id,
          nomeInformado: group.nome,
          dataColeta: fmtDataColeta(new Date()),
          error: false,
        });
      } catch (e) {
        failures++;
        results.push({ ...errorData(group, e.message), dataColeta: fmtDataColeta(new Date()) });
        log(`  ✗ ${group.nome} (${group.id}): ${e.message}`);
      }
      done++;
      if (!opts.quiet && (done % 10 === 0 || done === total)) {
        const pct = Math.round((done / total) * 100);
        log(`  ${done}/${total} (${pct}%) concluídos — ${failures} erro(s)`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  const success = total - failures;
  const reaproveitados = results.length - total;

  // Ordena pela ordem original da lista (não pela ordem de término)
  const order = new Map(groups.map((g, i) => [g.id, i]));
  results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const csv = buildCSV(results);
  fs.writeFileSync(opts.out, csv, 'utf-8');

  console.log(`\n✓ ${success}/${total} grupos coletados (${failures} erro(s)) em ${elapsed}s` +
              (opts.base ? ` + ${reaproveitados} reaproveitado(s)` : ''));
  console.log(`  CSV: ${opts.out}`);
  if (failures > 0) {
    console.error(`\n⚠ ${failures} grupo(s) falharam — verifique os registros com Situação = mensagem de erro no CSV.`);
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Erro fatal:', e);
    process.exit(1);
  });
}

module.exports = { parseCSV, parseDataColeta, loadBase, buildCSV, readGroups, CSV_HEADERS };
