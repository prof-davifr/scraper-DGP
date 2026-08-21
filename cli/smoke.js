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
