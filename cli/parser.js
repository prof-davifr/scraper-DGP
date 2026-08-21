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

function getResearcherNames(doc) {
  const spans = Array.from(doc.querySelectorAll('th span'));
  const span = spans.find((s) => s.textContent.trim() === 'Pesquisadores' && s.closest('table'));
  if (!span) return 'N/A';
  const table = span.closest('table');
  const rows = table.querySelectorAll('tbody tr:not(.ui-datatable-empty-message)');
  return Array.from(rows)
    .map((row) => {
      const cell = row.querySelector('td');
      return cell ? cell.textContent.trim() : '';
    })
    .filter((n) => n)
    .join('; ');
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
  getContatoGrupo,
  getPartnershipCount,
  getLinhasPesquisa,
  decodeCloudflareEmail,
};
