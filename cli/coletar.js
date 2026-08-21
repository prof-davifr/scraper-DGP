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

const CSV_HEADERS = [
  'ID', 'Data Coleta', 'Nome Base', 'Situação', 'Líder', 'Vice-Líder',
  'Último Envio', 'Ano Formação', 'Área', 'Instituição', 'Unidade', 'Contato',
  'Pesquisadores', 'Pesquisadores (Nomes)', 'Estudantes', 'Técnicos',
  'Instituições Parceiras', 'INCTs Parceiras', 'Linhas de Pesquisa',
];

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
    pesquisadoresNomes: '?', linhasPesquisa: '?',
  };
}

function buildCSV(results) {
  const rows = [CSV_HEADERS.join(',')];
  results.forEach((r) => {
    const vals = [
      r.id, r.dataColeta, r.nomeInformado, r.situacao, r.lider, r.viceLider,
      r.ultimoEnvio, r.anoFormacao, r.area, r.instituicao, r.unidade, r.contato,
      r.pesquisadores, r.pesquisadoresNomes, r.estudantes, r.tecnicos,
      r.instParceiras, r.inctsParceiras, r.linhasPesquisa,
    ];
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

  const queue = [...groups];
  const results = [];
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

  // Ordena pela ordem original da lista (não pela ordem de término)
  const order = new Map(groups.map((g, i) => [g.id, i]));
  results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const csv = buildCSV(results);
  fs.writeFileSync(opts.out, csv, 'utf-8');

  console.log(`\n✓ ${success}/${total} grupos coletados (${failures} erro(s)) em ${elapsed}s`);
  console.log(`  CSV: ${opts.out}`);
  if (failures > 0) {
    console.error(`\n⚠ ${failures} grupo(s) falharam — verifique os registros com Situação = mensagem de erro no CSV.`);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
