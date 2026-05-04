/* ============================================================
   Coletor-DGP — Application Logic
   ============================================================ */

// ---- Config (overridden by page-level window.APP_CONFIG) ----
const CONFIG = Object.assign({
    appName:   'Coletor-DGP',
    subtitle:  'Sistema de Extração de Dados DGP/CNPq',
    logoText:  'DGP',
    pageTitle: 'Coletor-DGP'
}, window.APP_CONFIG || {});

// ---- Constants ----
const FETCH_TIMEOUT_MS = 10000;

// ---- State ----
let currentGroups = [];
let resultsMap    = new Map();
let isRunning     = false;
let sortCol       = -1;
let sortAsc       = true;
let filterText    = '';
let scanStartTime = null;
let timerInterval = null;
let customProxy   = '';

// ---- Proxy List ----
const proxyList = [
    'https://api.allorigins.win/raw?url=',
    'https://thingproxy.freeboard.io/fetch/',
    'https://api.codetabs.com/v1/proxy?url=',
    'https://corsproxy.io/?'
];

// ---- DOM References (resolved after DOMContentLoaded) ----
let fileInput, dropZone, fileInfo, fileName, clearFileBtn, fileFeedback;
let startBtn, stopBtn, retryAllBtn, exportBtn, exportErrorsBtn;
let progressContainer, progressText, progressPercent, progressFill, progressBar;
let logText, timerText, resultsBody;
let tableSearch, tableCount, searchClearBtn;
let chkLimit, testModeBadge;
let statsWaiting, statsSuccess, statsError, statsTotal;
let toastEl, copyToastEl;
let customProxyInput, emptyStateRow;

function resolveDOM() {
    fileInput         = document.getElementById('fileInput');
    dropZone          = document.getElementById('dropZone');
    fileInfo          = document.getElementById('fileInfo');
    fileName          = document.getElementById('fileName');
    clearFileBtn      = document.getElementById('clearFileBtn');
    fileFeedback      = document.getElementById('fileFeedback');
    startBtn          = document.getElementById('startBtn');
    stopBtn           = document.getElementById('stopBtn');
    retryAllBtn       = document.getElementById('retryAllBtn');
    exportBtn         = document.getElementById('exportBtn');
    exportErrorsBtn   = document.getElementById('exportErrorsBtn');
    progressContainer = document.getElementById('progressContainer');
    progressText      = document.getElementById('progressText');
    progressPercent   = document.getElementById('progressPercent');
    progressFill      = document.getElementById('progressFill');
    progressBar       = document.getElementById('progressBar');
    logText           = document.getElementById('logText');
    timerText         = document.getElementById('timerText');
    resultsBody       = document.getElementById('resultsBody');
    tableSearch       = document.getElementById('tableSearch');
    tableCount        = document.getElementById('tableCount');
    searchClearBtn    = document.getElementById('searchClearBtn');
    chkLimit          = document.getElementById('chkLimit');
    testModeBadge     = document.getElementById('testModeBadge');
    statsWaiting      = document.getElementById('statsWaiting');
    statsSuccess      = document.getElementById('statsSuccess');
    statsError        = document.getElementById('statsError');
    statsTotal        = document.getElementById('statsTotal');
    toastEl           = document.getElementById('toast');
    copyToastEl       = document.getElementById('copyToast');
    customProxyInput  = document.getElementById('customProxyInput');
    emptyStateRow     = document.getElementById('emptyStateRow');
}

// ---- Apply Branding ----
function applyAppConfig() {
    document.title = CONFIG.pageTitle;
    const el = (id) => document.getElementById(id);
    const n = el('appName');        if (n) n.textContent = CONFIG.appName;
    const s = el('appSubtitle');    if (s) s.textContent = CONFIG.subtitle;
    const l = el('appLogoText');
    if (l) {
        l.textContent = CONFIG.logoText;
        l.setAttribute('aria-label', 'Logotipo: ' + CONFIG.appName);
    }
}

// ---- Init ----
window.addEventListener('load', () => {
    resolveDOM();
    applyAppConfig();

    // Event listeners
    fileInput  && fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) processFile(e.target.files[0]);
    });

    clearFileBtn && clearFileBtn.addEventListener('click', resetFileState);

    if (dropZone) {
        dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
        });
        dropZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput && fileInput.click(); }
        });
    }

    startBtn     && startBtn.addEventListener('click',     () => { setStep(3); runScraper(currentGroups); });
    stopBtn      && stopBtn.addEventListener('click',      onStop);
    retryAllBtn  && retryAllBtn.addEventListener('click',  onRetryAll);
    exportBtn    && exportBtn.addEventListener('click',    onExportAll);
    exportErrorsBtn && exportErrorsBtn.addEventListener('click', onExportErrors);

    // Table row event delegation (retry + copy)
    if (resultsBody) {
        resultsBody.addEventListener('click', (e) => {
            const retryBtn = e.target.closest('[data-action="retry"]');
            if (retryBtn) { retrySingle(retryBtn.dataset.id); return; }
            const copyEl = e.target.closest('[data-action="copy"]');
            if (copyEl) { copyCell(copyEl.dataset.copy); }
        });
    }

    chkLimit     && chkLimit.addEventListener('change',    updateTestModeBadge);
    customProxyInput && customProxyInput.addEventListener('input', () => { customProxy = customProxyInput.value.trim(); });

    tableSearch && tableSearch.addEventListener('input', () => {
        filterText = tableSearch.value.trim().toLowerCase();
        if (searchClearBtn) searchClearBtn.classList.toggle('visible', filterText.length > 0);
        renderTable();
    });

    searchClearBtn && searchClearBtn.addEventListener('click', () => {
        if (tableSearch) tableSearch.value = '';
        filterText = '';
        searchClearBtn.classList.remove('visible');
        renderTable();
    });

    // Initial UI
    setStep(1);
    updateTestModeBadge();
    updateEmptyState();
    updateStats();
    updateTableCount();
    addLog('Terminal inicializado. Aguardando arquivo...', 'info');

    if (window.location.hostname.endsWith('.github.io') || window.location.hostname === 'github.io') {
        const badge = document.getElementById('pagesBadge');
        if (badge) badge.style.display = 'inline-flex';
        addLog('\uD83D\uDE80 Rodando no GitHub Pages! Origem configurada corretamente.', 'success');
    }
    if (window.location.protocol === 'file:') {
        addLog('\u26A0\uFE0F Executando via file://. CORS pode falhar (Origin null).', 'warning');
        addLog('\uD83D\uDCA1 Dica: Use um servidor local ou hospede no GitHub Pages.', 'info');
    }
});

// ---- Terminal ----
function addLog(message, type = 'info') {
    const terminal = document.getElementById('terminal');
    if (!terminal) return;
    const time = new Date().toLocaleTimeString('pt-BR');
    const line = document.createElement('div');
    line.className = 'terminal-line';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'terminal-time';
    timeSpan.textContent = '[' + time + ']';
    const msgSpan = document.createElement('span');
    msgSpan.className = 'terminal-' + type;
    msgSpan.textContent = message;
    line.appendChild(timeSpan);
    line.appendChild(msgSpan);
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

function clearTerminal() {
    const terminal = document.getElementById('terminal');
    if (terminal) terminal.innerHTML = '';
}

// ---- Step Indicator ----
function setStep(n) {
    const steps = document.querySelectorAll('.step');
    steps.forEach((el, i) => {
        el.classList.remove('active', 'completed');
        if      (i + 1 < n)  el.classList.add('completed');
        else if (i + 1 === n) el.classList.add('active');
    });
}

// ---- Test Mode Badge ----
function updateTestModeBadge() {
    if (!chkLimit || !testModeBadge) return;
    testModeBadge.classList.toggle('visible', chkLimit.checked);
}

// ---- File Handling ----
function processFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'txt' && ext !== 'csv') {
        showFileFeedback('\u274C Formato inválido. Use um arquivo .TXT ou .CSV.', 'error');
        return;
    }
    if (fileName) fileName.textContent = file.name;
    if (fileInfo) fileInfo.classList.remove('hidden');
    if (dropZone) {
        const icon = dropZone.querySelector('.drop-zone-icon');
        const textEl = dropZone.querySelector('.drop-zone-text');
        if (icon) icon.textContent = '\uD83D\uDCC4';
        if (textEl) {
            textEl.textContent = '';
            const strong = document.createElement('strong');
            strong.textContent = file.name;
            const br = document.createElement('br');
            const small = document.createElement('small');
            small.textContent = 'clique para trocar';
            textEl.appendChild(strong);
            textEl.appendChild(br);
            textEl.appendChild(small);
        }
    }
    const reader = new FileReader();
    reader.onload = (e) => parseInput(e.target.result);
    reader.readAsText(file);
}

function resetFileState() {
    currentGroups = [];
    resultsMap.clear();
    if (resultsBody) resultsBody.innerHTML = '';
    if (fileInput)   fileInput.value = '';
    if (fileInfo)    fileInfo.classList.add('hidden');
    if (fileFeedback){ fileFeedback.textContent = ''; fileFeedback.className = 'file-feedback'; }
    if (dropZone) {
        const icon = dropZone.querySelector('.drop-zone-icon');
        const text = dropZone.querySelector('.drop-zone-text');
        if (icon) icon.textContent = '\uD83D\uDCC1';
        if (text) text.innerHTML = 'Arraste um arquivo <strong>.TXT</strong> ou <strong>.CSV</strong> aqui<br><small>ou clique para selecionar</small>';
    }
    if (startBtn) startBtn.disabled = true;
    if (exportBtn) exportBtn.disabled = true;
    if (exportErrorsBtn) exportErrorsBtn.style.display = 'none';
    if (progressContainer) progressContainer.style.display = 'none';
    updateEmptyState();
    updateStats();
    updateTableCount();
    setStep(1);
    addLog('Arquivo removido. Carregue um novo arquivo para começar.', 'info');
}

function showFileFeedback(msg, type) {
    if (!fileFeedback) return;
    fileFeedback.textContent = msg;
    fileFeedback.className = 'file-feedback ' + type;
}

// ---- Parse ----
function parseInput(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 0) { showFileFeedback('\u274C Arquivo vazio.', 'error'); return; }

    currentGroups = [];
    resultsMap.clear();
    if (resultsBody) resultsBody.innerHTML = '';

    const firstLine = lines[0].toLowerCase();
    const isCSV = firstLine.includes('id,') || firstLine.includes('nome base');
    if (isCSV) parseCSV(lines); else parseTXT(lines);

    if (currentGroups.length === 0) {
        showFileFeedback('\u274C Arquivo inválido \u2014 nenhum ID de 16 dígitos encontrado.', 'error');
        if (startBtn) startBtn.disabled = true;
    } else {
        const n = currentGroups.length;
        showFileFeedback('\u2705 ' + n + ' grupo' + (n !== 1 ? 's' : '') + ' encontrado' + (n !== 1 ? 's' : '') + '.', 'success');
        if (startBtn) startBtn.disabled = false;
        setStep(2);
    }

    addLog(currentGroups.length + ' grupos carregados.', 'info');
    updateUIState(false);
    updateEmptyState();
    updateStats();
    updateTableCount();
}

function parseTXT(lines) {
    for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 1) {
            const id   = parts[0].trim();
            const nome = parts[1] ? parts[1].trim() : 'N/A';
            if (/^\d{16}$/.test(id)) {
                const group = { id, nome };
                currentGroups.push(group);
                const data = createWaitingData(group);
                resultsMap.set(id, data);
                updateOrAddRow(data);
            }
        }
    }
}

function parseCSV(lines) {
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
    const idx = (name) => headers.indexOf(name);
    const idIdx         = idx('ID');
    const nomeIdx       = idx('Nome Base');
    const dataColetaIdx = idx('Data Coleta');
    const situacaoIdx   = idx('Situação');
    const liderIdx      = idx('Líder');
    const viceIdx       = idx('Vice-Líder');
    const envioIdx      = idx('Último Envio');
    const formacaoIdx   = idx('Ano Formação');
    const areaIdx       = idx('Área');
    const instIdx       = idx('Instituição');
    const unidadeIdx    = idx('Unidade');
    const contatoIdx    = idx('Contato');
    const pqIdx         = idx('Pesquisadores');
    const nomesIdx      = idx('Pesquisadores (Nomes)');
    const esIdx         = idx('Estudantes');
    const teIdx         = idx('Técnicos');
    const ipIdx         = idx('Instituições Parceiras');
    const inIdx         = idx('INCTs Parceiras');

    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
        if (!parts || parts.length < 2) continue;
        const clean = (ix) => (ix !== -1 && parts[ix]) ? parts[ix].replace(/^"|"$/g, '').replace(/""/g, '"').trim() : 'N/A';
        const id = clean(idIdx);
        if (!/^\d{16}$/.test(id)) continue;
        const data = {
            id,
            nomeInformado:    clean(nomeIdx),
            dataColeta:       clean(dataColetaIdx),
            situacao:         clean(situacaoIdx),
            lider:            clean(liderIdx),
            viceLider:        clean(viceIdx),
            ultimoEnvio:      clean(envioIdx),
            anoFormacao:      clean(formacaoIdx),
            area:             clean(areaIdx),
            instituicao:      clean(instIdx),
            unidade:          clean(unidadeIdx),
            contato:          clean(contatoIdx),
            pesquisadores:    parseInt(clean(pqIdx))  || 0,
            pesquisadoresNomes: clean(nomesIdx),
            estudantes:       parseInt(clean(esIdx))  || 0,
            tecnicos:         parseInt(clean(teIdx))  || 0,
            instParceiras:    parseInt(clean(ipIdx))  || 0,
            inctsParceiras:   parseInt(clean(inIdx))  || 0,
            error: clean(situacaoIdx).includes('\u26A0\uFE0F')
        };
        currentGroups.push({ id: data.id, nome: data.nomeInformado });
        resultsMap.set(id, data);
        updateOrAddRow(data);
    }
}

// ---- Scraper Controls ----
function onStop() {
    isRunning = false;
    if (logText) logText.textContent = 'Interrupção solicitada pelo usuário...';
    addLog('Interrupção solicitada pelo usuário.', 'warning');
    if (stopBtn) stopBtn.disabled = true;
    stopTimer();
}

function onRetryAll() {
    const failedIds = Array.from(resultsMap.values())
        .filter(d => d.error)
        .map(d => ({ id: d.id, nome: d.nomeInformado }));
    runScraper(failedIds);
}

// ---- Timer ----
function startTimer() {
    scanStartTime = Date.now();
    stopTimer();
    timerInterval = setInterval(() => updateTimerDisplay(), 1000);
}

function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

let _timerCurrent = 0, _timerTotal = 0;

function updateTimerDisplay(current, total) {
    if (current !== undefined) { _timerCurrent = current; _timerTotal = total; }
    if (!timerText || !scanStartTime) return;
    const elapsed = Math.floor((Date.now() - scanStartTime) / 1000);
    const elapsedStr = fmtDuration(elapsed);
    if (_timerCurrent > 0 && _timerTotal > 0 && _timerCurrent < _timerTotal) {
        const rate      = elapsed / _timerCurrent;
        const remaining = Math.round(rate * (_timerTotal - _timerCurrent));
        timerText.textContent = '\u23F1 ' + elapsedStr + ' decorrido \u00B7 ~' + fmtDuration(remaining) + ' restantes';
    } else {
        timerText.textContent = '\u23F1 ' + elapsedStr + ' decorrido';
    }
}

function fmtDuration(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m + ':' + String(s).padStart(2, '0');
}

// ---- Run Scraper ----
async function runScraper(groups) {
    if (isRunning) return;
    let list = [...groups];
    if (chkLimit && chkLimit.checked && list.length > 20 && groups === currentGroups) {
        list = list.slice(0, 20);
        addLog('Modo teste: processando apenas os primeiros 20 grupos.', 'warning');
    }
    if (list.length === 0) return;

    isRunning = true;
    updateUIState(true);
    addLog('Iniciando varredura de ' + list.length + ' grupos...', 'info');
    startTimer();
    _timerCurrent = 0; _timerTotal = list.length;

    const total = list.length;
    let current = 0;

    for (const group of list) {
        if (!isRunning) break;
        current++;
        updateProgress(current, total, 'Extraindo: ' + group.id);
        updateTimerDisplay(current - 1, total);
        addLog('[' + current + '/' + total + '] Extraindo: ' + group.nome + ' (' + group.id + ')', 'info');
        try {
            const data = await fetchGroupData(group.id);
            const usedFallback = data._usedFallback;
            delete data._usedFallback;
            data.id            = group.id;
            data.nomeInformado = group.nome;
            data.dataColeta    = new Date().toLocaleString('pt-BR');
            data.error         = false;
            resultsMap.set(group.id, data);
            updateOrAddRow(data);
            updateStats();
            addLog('[' + current + '/' + total + '] \u2713 Sucesso: ' + group.nome, 'success');
            if (current < total) await sleep(usedFallback ? 3000 : 1500);
        } catch (e) {
            const errorData = createErrorData(group, e.message);
            resultsMap.set(group.id, errorData);
            updateOrAddRow(errorData);
            updateStats();
            addLog('[' + current + '/' + total + '] \u2717 Erro em ' + group.nome + ': ' + e.message, 'error');
            if (current < total) await sleep(1500);
        }
    }

    isRunning = false;
    stopTimer();
    updateUIState(false);
    addLog('Varredura concluída.', 'success');
    checkFailures();
    setStep(4);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- Fetch Group Data ----
async function fetchGroupData(id) {
    const targetUrl = 'http://dgp.cnpq.br/dgp/espelhogrupo/' + id;
    let lastError   = null;
    const allProxies = customProxy ? [customProxy, ...proxyList] : proxyList;

    for (const [proxyIndex, proxy] of allProxies.entries()) {
        const proxyName = proxy.includes('allorigins')  ? 'allorigins.win'
                        : proxy.includes('thingproxy')  ? 'thingproxy'
                        : proxy.includes('codetabs')    ? 'codetabs'
                        : proxy.includes('corsproxy')   ? 'corsproxy.io'
                        : 'personalizado';
        try {
            addLog('Tentando proxy ' + proxyName + ' para ' + id + '...', 'info');
            const url  = proxy + encodeURIComponent(targetUrl);
            const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            if (!resp.ok) throw new Error('Status ' + resp.status);
            const html = await resp.text();
            addLog('Proxy ' + proxyName + ' respondeu com sucesso.', 'success');

            const parser = new DOMParser();
            const doc    = parser.parseFromString(html, 'text/html');
            const leaders = getLideresArray(doc);

            return {
                situacao:          getFieldValue(doc, 'Situação do grupo:'),
                anoFormacao:       getFieldValue(doc, 'Ano de formação:'),
                dataSituacao:      getFieldValue(doc, 'Data da Situação:'),
                ultimoEnvio:       getFieldValue(doc, 'Data do último envio:'),
                lider:             leaders[0] || 'N/A',
                viceLider:         leaders[1] || 'N/A',
                area:              getFieldValue(doc, 'Área predominante:'),
                instituicao:       getFieldValue(doc, 'Instituição do grupo:'),
                unidade:           getUnidadeValue(doc),
                contato:           getContatoGrupo(doc),
                ...getRHCounts(doc),
                pesquisadoresNomes: getResearcherNames(doc),
                instParceiras:     getPartnershipCount(doc, 'Instituições parceiras'),
                inctsParceiras:    getPartnershipCount(doc, 'INCTs parceiras'),
                _usedFallback:     proxyIndex > 0
            };
        } catch (e) {
            lastError = e;
            if (e.name === 'TypeError' && e.message.includes('fetch')) {
                addLog('Proxy ' + proxyName + ' falhou por CORS ou rede.', 'error');
            } else {
                addLog('Proxy ' + proxyName + ' falhou: ' + e.message, 'error');
            }
        }
    }
    throw lastError || new Error('Todos os proxies falharam');
}

// ---- DGP Parsers ----
function getUnidadeValue(doc) {
    let val = getFieldValue(doc, 'Unidade:');
    if (val.startsWith('IFBA - Campus ')) val = val.replace('IFBA - Campus ', '');
    return val;
}

function getResearcherNames(doc) {
    const spans = Array.from(doc.querySelectorAll('th span'));
    const span  = spans.find(s => s.textContent.trim() === 'Pesquisadores' && s.closest('table'));
    if (!span) return 'N/A';
    const table = span.closest('table');
    const rows  = table.querySelectorAll('tbody tr:not(.ui-datatable-empty-message)');
    return Array.from(rows).map(row => {
        const cell = row.querySelector('td');
        return cell ? cell.textContent.trim() : '';
    }).filter(n => n).join('; ');
}

function getFieldValue(doc, labelText) {
    const labels = Array.from(doc.querySelectorAll('.control-label'));
    const label  = labels.find(l => l.textContent.trim().includes(labelText));
    return label ? label.nextElementSibling.textContent.trim().replace(/\s+/g, ' ') : 'N/A';
}

function getLideresArray(doc) {
    const labels = Array.from(doc.querySelectorAll('.control-label'));
    const label  = labels.find(l => l.textContent.trim().includes('Líder(es) do grupo:'));
    if (!label) return [];
    const controls = label.nextElementSibling.cloneNode(true);
    controls.querySelectorAll('button, script, div.ui-tooltip').forEach(e => e.remove());
    return controls.innerHTML.split('<br>')
        .map(t => { const d = document.createElement('div'); d.innerHTML = t; return d.textContent.trim().replace(/\s+/g, ' '); })
        .filter(t => t.length > 2);
}

function getContatoGrupo(doc) {
    const labels = Array.from(doc.querySelectorAll('.control-label'));
    const label  = labels.find(l => l.textContent.trim().includes('Contato do grupo:'));
    if (label) {
        const controls = label.nextElementSibling;
        const cfEmail  = controls.querySelector('.__cf_email__');
        if (cfEmail) return decodeCloudflareEmail(cfEmail.getAttribute('data-cfemail'));
        const a = controls.querySelector('a');
        return a ? a.textContent.trim() : controls.textContent.trim();
    }
    return 'N/A';
}

function decodeCloudflareEmail(hex) {
    // Cloudflare obfuscates emails with XOR encoding: first byte is the key,
    // remaining pairs are character codes XOR'd with the key.
    let email = '';
    const key = parseInt(hex.slice(0, 2), 16);
    for (let i = 2; i < hex.length; i += 2) email += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return email;
}

function getRHCounts(doc) {
    const result = { pesquisadores: 0, estudantes: 0, tecnicos: 0 };
    const legends = Array.from(doc.querySelectorAll('legend'));
    const legend  = legends.find(l => l.textContent.includes('Indicadores de recursos humanos'));
    if (!legend) return result;
    const table = legend.parentElement.querySelector('table');
    if (!table) return result;
    table.querySelectorAll('tbody tr:not(.ui-datatable-empty-message)').forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 4) {
            result.pesquisadores += parseInt(cells[1].textContent.trim()) || 0;
            result.estudantes    += parseInt(cells[2].textContent.trim()) || 0;
            result.tecnicos      += parseInt(cells[3].textContent.trim()) || 0;
        }
    });
    return result;
}

function getPartnershipCount(doc, legendText) {
    const legends = Array.from(doc.querySelectorAll('legend'));
    const legend  = legends.find(l => l.textContent.includes(legendText));
    if (!legend) return 0;
    const table = legend.parentElement.querySelector('table');
    if (!table) return 0;
    return table.querySelectorAll('tbody tr:not(.ui-datatable-empty-message)').length;
}

// ---- Retry Single (global, called from onclick) ----
async function retrySingle(id) {
    if (isRunning) return;
    const entry = currentGroups.find(g => g.id === id);
    if (!entry) return;
    isRunning = true;
    if (logText) logText.textContent = 'Recarregando ' + id + '...';
    addLog('Recarregando: ' + entry.nome + ' (' + id + ')', 'info');
    try {
        const data = await fetchGroupData(id);
        delete data._usedFallback;
        data.id            = id;
        data.nomeInformado = entry.nome;
        data.dataColeta    = new Date().toLocaleString('pt-BR');
        data.error         = false;
        resultsMap.set(id, data);
        updateOrAddRow(data);
        if (logText) logText.textContent = 'Sucesso: ' + id;
        addLog('\u2713 Recarregado com sucesso: ' + entry.nome, 'success');
    } catch (e) {
        if (logText) logText.textContent = 'Falha: ' + id;
        addLog('\u2717 Falha ao recarregar ' + entry.nome + ': ' + e.message, 'error');
    }
    isRunning = false;
    updateStats();
    checkFailures();
}

// ---- Data Factories ----
function createErrorData(group, msg) {
    return {
        id: group.id, nomeInformado: group.nome, error: true, situacao: msg,
        anoFormacao: '?', ultimoEnvio: '?', dataSituacao: '?',
        lider: '?', viceLider: '?', area: '?', instituicao: '?', unidade: '?', contato: '?',
        pesquisadores: 0, estudantes: 0, tecnicos: 0, instParceiras: 0, inctsParceiras: 0,
        pesquisadoresNomes: '?', dataColeta: '-'
    };
}

function createWaitingData(group) {
    return {
        id: group.id, nomeInformado: group.nome, error: false, situacao: 'Aguardando...',
        anoFormacao: '-', ultimoEnvio: '-', dataSituacao: '-',
        lider: '-', viceLider: '-', area: '-', instituicao: '-', unidade: '-', contato: '-',
        pesquisadores: 0, estudantes: 0, tecnicos: 0, instParceiras: 0, inctsParceiras: 0,
        pesquisadoresNomes: '-', dataColeta: '-'
    };
}

// ---- UI State ----
function updateUIState(active) {
    if (startBtn)       startBtn.disabled       = active || currentGroups.length === 0;
    if (stopBtn)        stopBtn.style.display   = active ? 'inline-flex' : 'none';
    if (stopBtn)        stopBtn.disabled        = false;
    if (retryAllBtn)    retryAllBtn.style.display = 'none';
    if (exportBtn)      exportBtn.disabled      = active || resultsMap.size === 0;
    if (exportErrorsBtn) {
        exportErrorsBtn.style.display = (!active && resultsMap.size > 0) ? 'inline-flex' : 'none';
    }
    if (progressContainer) progressContainer.style.display = 'block';
}

function checkFailures() {
    const hasFailures = Array.from(resultsMap.values()).some(d => d.error);
    if (retryAllBtn) retryAllBtn.style.display = hasFailures ? 'inline-flex' : 'none';
    if (exportErrorsBtn) exportErrorsBtn.style.display = resultsMap.size > 0 ? 'inline-flex' : 'none';
    updateStats();
}

// ---- Progress ----
function updateProgress(curr, tot, msg) {
    const p = Math.round((curr / tot) * 100);
    if (progressText)    progressText.textContent    = 'Processando: ' + curr + ' de ' + tot;
    if (progressPercent) progressPercent.textContent = p + '%';
    if (progressFill)    progressFill.style.width    = p + '%';
    if (progressBar) {
        progressBar.setAttribute('aria-valuenow', p);
        progressBar.setAttribute('aria-valuemax', 100);
    }
    if (logText) logText.textContent = msg;
}

// ---- Stats Bar ----
function updateStats() {
    const vals    = Array.from(resultsMap.values());
    const waiting = vals.filter(d => d.situacao === 'Aguardando...').length;
    const errors  = vals.filter(d => d.error).length;
    const success = vals.filter(d => !d.error && d.situacao !== 'Aguardando...').length;
    const total   = vals.length;
    if (statsWaiting) statsWaiting.textContent = '\uD83D\uDFE1 ' + waiting + ' Aguardando';
    if (statsSuccess) statsSuccess.textContent = '\u2705 ' + success + ' Coletados';
    if (statsError)   statsError.textContent   = '\u274C ' + errors  + ' com Erro';
    if (statsTotal)   statsTotal.textContent   = '\uD83D\uDCCA Total: ' + total;
}

// ---- Empty State ----
function updateEmptyState() {
    if (!emptyStateRow) return;
    emptyStateRow.style.display = resultsMap.size === 0 ? '' : 'none';
}

// ---- Table Sorting (global, called from onclick) ----
function sortTable(colIndex) {
    if (sortCol === colIndex) { sortAsc = !sortAsc; }
    else { sortCol = colIndex; sortAsc = true; }

    const ths = document.querySelectorAll('#resultsTable thead th');
    ths.forEach((th, i) => {
        th.classList.remove('sort-asc', 'sort-desc');
        const ind = th.querySelector('.sort-indicator');
        if (ind) ind.textContent = '\u21C5';
        if (i === colIndex) {
            th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
            if (ind) ind.textContent = sortAsc ? '\u25B2' : '\u25BC';
        }
    });
    renderTable();
}

// ---- Table Filtering / Rendering ----
function getFilteredSortedData() {
    let data = Array.from(resultsMap.values());
    if (filterText) {
        data = data.filter(d =>
            (d.id              || '').toLowerCase().includes(filterText) ||
            (d.nomeInformado   || '').toLowerCase().includes(filterText) ||
            (d.lider           || '').toLowerCase().includes(filterText) ||
            (d.area            || '').toLowerCase().includes(filterText) ||
            (d.instituicao     || '').toLowerCase().includes(filterText) ||
            (d.unidade         || '').toLowerCase().includes(filterText)
        );
    }
    if (sortCol > 0) {
        const keys = [null,
            'id', 'dataColeta', 'nomeInformado', 'situacao', 'lider', 'viceLider',
            'ultimoEnvio', 'anoFormacao', 'area', 'unidade', 'contato',
            'pesquisadores', 'estudantes', 'tecnicos', 'instParceiras', 'inctsParceiras',
            'pesquisadoresNomes'
        ];
        const key = keys[sortCol];
        if (key) {
            data.sort((a, b) => {
                let va = a[key], vb = b[key];
                if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va;
                va = String(va || '').toLowerCase();
                vb = String(vb || '').toLowerCase();
                return sortAsc ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR');
            });
        }
    }
    return data;
}

function renderTable() {
    if (!resultsBody) return;
    const data = getFilteredSortedData();
    resultsBody.innerHTML = '';
    for (const d of data) appendRow(d);
    updateEmptyState();
    updateTableCount(data.length);
}

function updateTableCount(visible) {
    if (!tableCount) return;
    const total = resultsMap.size;
    const shown = visible !== undefined ? visible : total;
    tableCount.textContent = total === 0
        ? 'Nenhum grupo carregado'
        : shown === total
            ? 'Exibindo ' + total + ' grupo' + (total !== 1 ? 's' : '')
            : 'Exibindo ' + shown + ' de ' + total + ' grupos';
}

// ---- Row Rendering ----
function updateOrAddRow(data) {
    resultsMap.set(data.id, data);
    updateEmptyState();
    if (filterText || sortCol > 0) {
        renderTable();
    } else {
        let tr    = document.getElementById('row-' + data.id);
        const isNew = !tr;
        if (isNew) { tr = document.createElement('tr'); tr.id = 'row-' + data.id; resultsBody.appendChild(tr); }
        populateRow(tr, data);
        if (!isNew && data.situacao !== 'Aguardando...') {
            tr.classList.remove('row-updated');
            void tr.offsetWidth;
            tr.classList.add('row-updated');
            setTimeout(() => tr.classList.remove('row-updated'), 900);
        }
        updateTableCount();
        updateStats();
    }
}

function appendRow(data) {
    const tr = document.createElement('tr');
    tr.id = 'row-' + data.id;
    populateRow(tr, data);
    resultsBody.appendChild(tr);
}

function populateRow(tr, data) {
    const isWaiting = data.situacao === 'Aguardando...';
    const sClass = isWaiting    ? 'status-waiting'
        : data.error            ? 'status-error'
        : data.situacao.toLowerCase().includes('excluído') ? 'status-excluido'
        : 'status-certificado';
    const statusLabel = isWaiting ? 'Aguardando...' : data.error ? '\u26A0\uFE0F ERRO' : data.situacao;
    const statusTitle = data.error ? data.situacao : '';
    const dateShort   = (data.dataColeta || '-').split(',')[0].split(' ')[0];

    tr.innerHTML =
        '<td style="text-align:center;">'
            + '<button class="btn btn-mini" data-action="retry" data-id="' + escData(data.id) + '" title="Recarregar este grupo" aria-label="Recarregar grupo ' + escData(data.id) + '">\uD83D\uDD04</button>'
        + '</td>'
        + '<td><a href="http://dgp.cnpq.br/dgp/espelhogrupo/' + data.id + '" target="_blank" rel="noopener" style="color:var(--accent);">' + data.id + '</a></td>'
        + '<td style="font-size:0.75rem; white-space:nowrap;">' + escHtml(dateShort) + '</td>'
        + '<td class="cell-truncated" data-action="copy" data-copy="' + escData(data.nomeInformado) + '" title="Clique para copiar">' + escHtml(truncate(data.nomeInformado, 25)) + '</td>'
        + '<td><span class="status-badge ' + sClass + '" title="' + escData(statusTitle) + '">' + escHtml(statusLabel) + '</span></td>'
        + '<td>' + escHtml(data.lider) + '</td>'
        + '<td>' + escHtml(data.viceLider) + '</td>'
        + '<td>' + escHtml(data.ultimoEnvio) + '</td>'
        + '<td>' + escHtml(data.anoFormacao) + '</td>'
        + '<td class="cell-truncated" data-action="copy" data-copy="' + escData(data.area) + '" title="Clique para copiar">' + escHtml(truncate(data.area, 18)) + '</td>'
        + '<td class="cell-truncated" data-action="copy" data-copy="' + escData(data.unidade) + '" title="Clique para copiar">' + escHtml(truncate(data.unidade, 18)) + '</td>'
        + '<td>' + escHtml(data.contato) + '</td>'
        + '<td style="text-align:center;">' + (parseInt(data.pesquisadores) || 0) + '</td>'
        + '<td style="text-align:center;">' + (parseInt(data.estudantes) || 0) + '</td>'
        + '<td style="text-align:center;">' + (parseInt(data.tecnicos) || 0) + '</td>'
        + '<td style="text-align:center;">' + (parseInt(data.instParceiras) || 0) + '</td>'
        + '<td style="text-align:center;">' + (parseInt(data.inctsParceiras) || 0) + '</td>'
        + '<td class="cell-truncated" data-action="copy" data-copy="' + escData(data.pesquisadoresNomes) + '" title="Clique para copiar">' + escHtml(truncate(data.pesquisadoresNomes, 30)) + '</td>';
}

function escData(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function truncate(str, n) {
    str = String(str || '');
    return str.length > n ? str.slice(0, n - 1) + '\u2026' : str;
}

// ---- Copy Cell (global) ----
let copyToastTimer = null;

function copyCell(text) {
    if (!text || text === '-' || text === 'N/A') return;
    const show = () => showCopyToast('Copiado!');
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(show).catch(fallbackCopy.bind(null, text, show));
    } else {
        fallbackCopy(text, show);
    }
}

function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); cb(); } catch(e) {}
    document.body.removeChild(ta);
}

function showCopyToast(msg) {
    if (!copyToastEl) return;
    copyToastEl.textContent = msg;
    copyToastEl.classList.add('show');
    if (copyToastTimer) clearTimeout(copyToastTimer);
    copyToastTimer = setTimeout(() => copyToastEl.classList.remove('show'), 1500);
}

// ---- Toast Notification ----
let toastTimer = null;
function showToast(msg, type = 'info') {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className   = 'toast toast-' + type + ' show';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

// ---- Export ----
function buildCSV(data) {
    const headers = [
        'ID','Data Coleta','Nome Base','Situação','Líder','Vice-Líder',
        'Último Envio','Ano Formação','Área','Instituição','Unidade','Contato',
        'Pesquisadores','Pesquisadores (Nomes)','Estudantes','Técnicos',
        'Instituições Parceiras','INCTs Parceiras'
    ];
    const rows = [headers.join(',')];
    data.forEach(r => {
        const vals = [
            r.id, r.dataColeta, r.nomeInformado, r.situacao, r.lider, r.viceLider,
            r.ultimoEnvio, r.anoFormacao, r.area, r.instituicao, r.unidade, r.contato,
            r.pesquisadores, r.pesquisadoresNomes, r.estudantes, r.tecnicos,
            r.instParceiras, r.inctsParceiras
        ];
        rows.push(vals.map(v => '"' + String(v || '').replace(/"/g, '""') + '"').join(','));
    });
    return '\uFEFF' + rows.join('\n');
}

function downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function onExportAll() {
    if (resultsMap.size === 0) return;
    downloadCSV(buildCSV(Array.from(resultsMap.values())), 'coletor_dgp_' + todayStr() + '.csv');
    showToast('\u2705 CSV exportado com sucesso!', 'success');
}

function onExportErrors() {
    const errorData = Array.from(resultsMap.values()).filter(d => d.error);
    if (errorData.length === 0) { showToast('Nenhum erro registrado para exportar.', 'info'); return; }
    downloadCSV(buildCSV(errorData), 'coletor_dgp_erros_' + todayStr() + '.csv');
    showToast('\u2705 ' + errorData.length + ' erro(s) exportado(s).', 'success');
}
