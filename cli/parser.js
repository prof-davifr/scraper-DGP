/**
 * Parser do espelho de grupo do DGP/CNPq — portado de assets/app.js.
 *
 * Roda em Node com jsdom (sem navegador, sem proxy CORS): o `fetch` nativo do
 * Node acessa `dgp.cnpq.br` diretamente. As funções de extração são as mesmas
 * do app.js (getFieldValue, getLideresArray, getRHCounts, ...), apenas com o
 * `document` recebido como parâmetro em vez do `DOMParser` global.
 */

'use strict';

const { JSDOM } = require('jsdom');

/** Decodifica e-mail ofuscado pelo Cloudflare (XOR; 1º byte = chave). */
function decodeCloudflareEmail(hex) {
  let email = '';
  const key = parseInt(hex.slice(0, 2), 16);
  for (let i = 2; i < hex.length; i += 2) {
    email += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return email;
}

function getFieldValue(doc, labelText) {
  const labels = Array.from(doc.querySelectorAll('.control-label'));
  const target = labelText.toLowerCase().trim();
  const label = labels.find((l) => l.textContent.toLowerCase().includes(target));
  if (label && label.nextElementSibling) {
    return label.nextElementSibling.textContent.trim().replace(/\s+/g, ' ');
  }
  const allText = Array.from(doc.querySelectorAll('label, th, td, b, span'));
  const fallback = allText.find((l) => l.textContent.toLowerCase().includes(target));
  if (fallback && fallback.nextElementSibling) {
    return fallback.nextElementSibling.textContent.trim().replace(/\s+/g, ' ');
  }
  return 'N/A';
}

function getLideresArray(doc) {
  const labels = Array.from(doc.querySelectorAll('.control-label, label, th'));
  const target = 'líder(es) do grupo:';
  const label = labels.find((l) => l.textContent.toLowerCase().includes(target));
  if (!label) return [];
  const controls = label.nextElementSibling.cloneNode(true);
  controls.querySelectorAll('button, script, div.ui-tooltip').forEach((e) => e.remove());
  return controls.innerHTML
    .split('<br>')
    .map((t) => {
      const d = doc.createElement('div');
      d.innerHTML = t;
      return d.textContent.trim().replace(/\s+/g, ' ');
    })
    .filter((t) => t.length > 2);
}

function getUnidadeValue(doc) {
  return getFieldValue(doc, 'Unidade:');
}

/**
 * Nomes dos membros atuais de uma categoria de "Recursos humanos"
 * ('Pesquisadores', 'Estudantes' ou 'Técnicos').
 *
 * A página tem até três tabelas com o mesmo título: os membros atuais, os
 * egressos ("Período de participação no grupo") e os indicadores por formação.
 * Só a de membros atuais abre com o título e tem a coluna "Data inclusão"; sem
 * essa conferência, um grupo sem a tabela de técnicos devolveria "Doutorado;
 * Mestrado; ..." da tabela de indicadores.
 */
function getMemberNames(doc, titulo) {
  const table = Array.from(doc.querySelectorAll('table')).find((t) => {
    const heads = Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    return heads[0] === titulo && heads.includes('Data inclusão');
  });
  if (!table) return 'N/A';
  const rows = table.querySelectorAll('tbody tr:not(.ui-datatable-empty-message)');
  return Array.from(rows)
    .map((row) => {
      const cell = row.querySelector('td');
      return cell ? cell.textContent.trim() : '';
    })
    .filter((n) => n)
    .join('; ');
}

function getResearcherNames(doc) {
  return getMemberNames(doc, 'Pesquisadores');
}

function getContatoGrupo(doc) {
  const labels = Array.from(doc.querySelectorAll('.control-label'));
  const label = labels.find((l) => l.textContent.trim().includes('Contato do grupo:'));
  if (label) {
    const controls = label.nextElementSibling;
    const cfEmail = controls.querySelector('.__cf_email__');
    if (cfEmail) return decodeCloudflareEmail(cfEmail.getAttribute('data-cfemail'));
    const a = controls.querySelector('a');
    return a ? a.textContent.trim() : controls.textContent.trim();
  }
  return 'N/A';
}

function getRHCounts(doc) {
  const result = { pesquisadores: 0, estudantes: 0, tecnicos: 0 };
  const legends = Array.from(doc.querySelectorAll('legend'));
  const legend = legends.find((l) => l.textContent.toLowerCase().includes('indicadores de recursos humanos'));
  if (!legend) return result;
  const table = legend.parentElement.querySelector('table');
  if (!table) return result;
  table.querySelectorAll('tbody tr:not(.ui-datatable-empty-message)').forEach((row) => {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 4) {
      result.pesquisadores += parseInt(cells[1].textContent.trim(), 10) || 0;
      result.estudantes += parseInt(cells[2].textContent.trim(), 10) || 0;
      result.tecnicos += parseInt(cells[3].textContent.trim(), 10) || 0;
    }
  });
  return result;
}

function getPartnershipCount(doc, legendText) {
  const legends = Array.from(doc.querySelectorAll('legend'));
  const legend = legends.find((l) => l.textContent.toLowerCase().includes(legendText.toLowerCase()));
  if (!legend) return 0;
  const table = legend.parentElement.querySelector('table');
  if (!table) return 0;
  return table.querySelectorAll('tbody tr:not(.ui-datatable-empty-message)').length;
}

function getLinhasPesquisa(doc) {
  const legends = Array.from(doc.querySelectorAll('legend'));
  const legend = legends.find((l) => l.textContent.toLowerCase().includes('linhas de pesquisa'));
  if (!legend) return 'N/A';
  const table = legend.parentElement.querySelector('table');
  if (!table) return 'N/A';
  const rows = table.querySelectorAll('tbody tr:not(.ui-datatable-empty-message)');
  return Array.from(rows)
    .map((row) => {
      const cells = row.querySelectorAll('td');
      return cells.length > 0 ? cells[0].textContent.trim() : '';
    })
    .filter((n) => n)
    .join('; ');
}

/**
 * Converte o HTML do espelho de grupo num objeto com os mesmos campos que o
 * app.js extrai. Retorna `null` se o HTML não parece uma página DGP válida.
 */
function parseGroupPage(html) {
  const dom = new JSDOM(html, { contentType: 'text/html' });
  const doc = dom.window.document;

  const situacao = getFieldValue(doc, 'Situação do grupo:');
  if (situacao === 'N/A') {
    return null;
  }

  const leaders = getLideresArray(doc);
  return {
    situacao,
    anoFormacao: getFieldValue(doc, 'Ano de formação:'),
    dataSituacao: getFieldValue(doc, 'Data da Situação:'),
    ultimoEnvio: getFieldValue(doc, 'Data do último envio:'),
    lider: leaders[0] || 'N/A',
    viceLider: leaders[1] || 'N/A',
    area: getFieldValue(doc, 'Área predominante:'),
    instituicao: getFieldValue(doc, 'Instituição do grupo:'),
    unidade: getUnidadeValue(doc),
    contato: getContatoGrupo(doc),
    ...getRHCounts(doc),
    pesquisadoresNomes: getResearcherNames(doc),
    estudantesNomes: getMemberNames(doc, 'Estudantes'),
    tecnicosNomes: getMemberNames(doc, 'Técnicos'),
    instParceiras: getPartnershipCount(doc, 'Instituições parceiras'),
    inctsParceiras: getPartnershipCount(doc, 'INCTs parceiras'),
    linhasPesquisa: getLinhasPesquisa(doc),
  };
}

module.exports = {
  parseGroupPage,
  // Helpers exportados para teste
  getFieldValue,
  getLideresArray,
  getRHCounts,
  getResearcherNames,
  getMemberNames,
  getContatoGrupo,
  getPartnershipCount,
  getLinhasPesquisa,
  decodeCloudflareEmail,
};
