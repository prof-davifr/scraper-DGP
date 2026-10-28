#!/usr/bin/env node
/**
 * Smoke test sem framework — valida o parser DGP contra um fixture salvo e a
 * lista de grupos versionada. Roda no CI (sem credenciais, sem PII).
 *
 * Uso: node cli/smoke.js
 * Sai com 0 se tudo passar, 1 se algo falhar.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { parseGroupPage } = require('./parser');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

console.log('Smoke test do parser DGP');

// 1. Fixture HTML salvo
const fixturePath = path.join(ROOT, 'samples', 'espelhogrupo-exemplo.html');
if (!fs.existsSync(fixturePath)) {
  console.error('  ✗ fixture não encontrado: samples/espelhogrupo-exemplo.html');
  process.exit(1);
}
const html = fs.readFileSync(fixturePath, 'utf-8');
const data = parseGroupPage(html);

check('parseGroupPage retorna objeto', () => assert.ok(data, 'deveria parsear'));
check('Situação', () => assert.strictEqual(data.situacao, 'Excluído'));
check('Ano de formação', () => assert.strictEqual(data.anoFormacao, '2014'));
check('Área', () => assert.strictEqual(data.area, 'Ciências Agrárias; Agronomia'));
check('Instituição', () => assert.strictEqual(data.instituicao, 'Instituto Federal da Bahia - IFBA'));
check('Unidade', () => assert.strictEqual(data.unidade, 'IFBA - Campus Salvador'));
check('Líder', () => assert.strictEqual(data.lider, 'Jeferson Gabriel da Encarnação Coutinho'));
check('Vice-líder', () => assert.strictEqual(data.viceLider, 'Aristides Fraga Lima Filho'));
check('RH pesquisadores=8', () => assert.strictEqual(data.pesquisadores, 8));
check('RH estudantes=7', () => assert.strictEqual(data.estudantes, 7));
check('Contato', () => assert.strictEqual(data.contato, 'aristides@ifba.edu.br'));
check('Nomes contêm o líder', () => assert.ok(data.pesquisadoresNomes.includes('Jeferson Gabriel')));
check('7 nomes de estudantes (= RH)', () =>
  assert.strictEqual(data.estudantesNomes.split('; ').length, data.estudantes, data.estudantesNomes));
// Sem técnico, a tabela de membros fica vazia; o título "Técnicos" se repete na
// de indicadores, que não pode vazar para cá.
check('sem técnicos → nomes vazios', () => assert.strictEqual(data.tecnicosNomes, ''));

// 1b. Fixture de um grupo Certificado (ativo): exercita técnicos, instituições
// parceiras e linhas de pesquisa, que o grupo Excluído acima não tem.
// Grupo 4621794625426448, salvo em 18/10/2026. Nenhum grupo do IFBA tinha INCT
// parceiro na coleta de 21/08/2026; por isso só se confere a contagem zero.
const certPath = path.join(ROOT, 'samples', 'espelhogrupo-certificado.html');
check('fixture certificado existe', () => assert.ok(fs.existsSync(certPath), 'fixture não encontrado'));
if (fs.existsSync(certPath)) {
  const cert = parseGroupPage(fs.readFileSync(certPath, 'utf-8'));
  check('[cert] parseGroupPage retorna objeto', () => assert.ok(cert, 'deveria parsear'));
  if (cert) {
    check('[cert] Situação', () => assert.strictEqual(cert.situacao, 'Certificado'));
    check('[cert] Ano de formação', () => assert.strictEqual(cert.anoFormacao, '2006'));
    check('[cert] Área', () => assert.strictEqual(cert.area, 'Ciências Exatas e da Terra; Química'));
    check('[cert] Líder', () => assert.strictEqual(cert.lider, 'Manuela Pedra Cardoso Brito'));
    check('[cert] Vice-líder', () => assert.strictEqual(cert.viceLider, 'Joseina Moutinho Tavares'));
    check('[cert] RH pesquisadores=20', () => assert.strictEqual(cert.pesquisadores, 20));
    check('[cert] RH estudantes=14', () => assert.strictEqual(cert.estudantes, 14));
    check('[cert] RH técnicos=1', () => assert.strictEqual(cert.tecnicos, 1));
    check('[cert] 20 nomes de pesquisadores, não os egressos', () =>
      assert.strictEqual(cert.pesquisadoresNomes.split('; ').length, 20));
    check('[cert] 14 nomes de estudantes, não os 101 egressos', () => {
      const nomes = cert.estudantesNomes.split('; ');
      assert.strictEqual(nomes.length, 14, cert.estudantesNomes);
      assert.ok(nomes.includes('Anna Victoria Alves da Silva'), cert.estudantesNomes);
    });
    check('[cert] nome do técnico', () =>
      assert.strictEqual(cert.tecnicosNomes, 'Carina Soares do Nascimento'));
    check('[cert] Instituições parceiras=3', () => assert.strictEqual(cert.instParceiras, 3));
    check('[cert] INCTs parceiras=0', () => assert.strictEqual(cert.inctsParceiras, 0));
    check('[cert] 7 linhas de pesquisa', () => {
      const linhas = cert.linhasPesquisa.split('; ');
      assert.strictEqual(linhas.length, 7, cert.linhasPesquisa);
      assert.ok(linhas.includes('Catálise'), cert.linhasPesquisa);
      assert.ok(linhas.includes('Síntese de Compostos de Coordenação'), cert.linhasPesquisa);
    });
  }
}

// 1c. Modo incremental (--base): leitura do CSV anterior, sem rede e sem PII.
{
  const { parseCSV, loadBase, buildCSV, CSV_HEADERS } = require('./coletar');
  const linha = (id, dataColeta, extra = {}) => CSV_HEADERS.map((h) => {
    if (h === 'ID') return id;
    if (h === 'Data Coleta') return dataColeta;
    return h in extra ? extra[h] : 'x';
  });
  const agora = new Date(2026, 9, 18, 12, 0, 0);
  const linhas = [
    linha('1111111111111111', '17/10/2026, 08:00:00', { 'Linhas de Pesquisa': 'a, "b"; c\nd' }),
    linha('2222222222222222', '17/10/2026, 08:00:00', { 'Ano Formação': '?', 'Líder': '?' }),
    linha('3333333333333333', '01/10/2026, 08:00:00'),
  ];
  const csv = buildCSV(linhas.map((l) => ({ linhaBase: l })));
  check('[incremental] CSV volta igual após parse', () =>
    assert.deepStrictEqual(parseCSV(csv), [CSV_HEADERS, ...linhas]));
  check('[incremental] reaproveita só coleta recente e sem erro', () =>
    assert.deepStrictEqual([...loadBase(csv, 7, agora).keys()], ['1111111111111111']));
  check('[incremental] idade maior inclui a coleta antiga', () =>
    assert.deepStrictEqual([...loadBase(csv, 30, agora).keys()], ['1111111111111111', '3333333333333333']));
  check('[csv] cada campo cai na sua coluna', () => {
    const r = { id: '4444444444444444', estudantes: 2, estudantesNomes: 'Ana; Bia', tecnicos: 1,
      tecnicosNomes: 'Caio', linhasPesquisa: 'Catálise' };
    const [cab, lin] = parseCSV(buildCSV([r]));
    const valor = (coluna) => lin[cab.indexOf(coluna)];
    assert.strictEqual(valor('ID'), r.id);
    assert.strictEqual(valor('Estudantes'), '2');
    assert.strictEqual(valor('Estudantes (Nomes)'), 'Ana; Bia');
    assert.strictEqual(valor('Técnicos (Nomes)'), 'Caio');
    assert.strictEqual(valor('Linhas de Pesquisa'), 'Catálise');
  });
  // assets/app.js exporta o mesmo CSV pela versão web; a ordem não pode divergir.
  check('[csv] app.js usa a mesma ordem de colunas', () => {
    const app = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf-8');
    const bloco = app.slice(app.indexOf('const CSV_COLUNAS'), app.indexOf('];', app.indexOf('const CSV_COLUNAS')));
    const colunas = [...bloco.matchAll(/\['([^']+)', '[^']+'\]/g)].map((m) => m[1]);
    assert.deepStrictEqual(colunas, CSV_HEADERS);
  });
  check('[incremental] recusa CSV de outro formato', () =>
    assert.throws(() => loadBase('﻿ID,Nome\n"1","a"', 7, agora), /cabeçalho/));
}

// 2. Lista de grupos versionada (formato ID\tNome)
const listaPath = path.join(ROOT, 'lista de grupos de pesquisa.txt');
check('lista versionada existe', () => assert.ok(fs.existsSync(listaPath), 'lista não encontrada'));
if (fs.existsSync(listaPath)) {
  const ids = fs.readFileSync(listaPath, 'utf-8')
    .split('\n')
    .map((l) => l.split('\t')[0].trim())
    .filter((id) => /^\d{16}$/.test(id));
  check('lista tem ≥ 190 grupos válidos', () => assert.ok(ids.length >= 190, `só ${ids.length} IDs`));
  check('lista sem IDs duplicados', () => assert.strictEqual(new Set(ids).size, ids.length));
}

console.log(failures === 0 ? '\n✓ Todos os checks passaram' : `\n✗ ${failures} check(s) falharam`);
process.exit(failures === 0 ? 0 : 1);
