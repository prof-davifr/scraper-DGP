        let currentGroups = [];
        const APP_CONFIG = {
            appName: 'Coletor-DGP',
            subtitle: 'Sistema de Extração de Dados DGP/CNPq',
            logoText: 'DGP',
            pageTitle: 'Coletor-DGP'
        };

        let resultsMap = new Map(); // ID -> Data
        let isRunning = false;

        const fileInput = document.getElementById('fileInput');
        const fileLabel = document.getElementById('fileLabel');
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');
        const retryAllBtn = document.getElementById('retryAllBtn');
        const exportBtn = document.getElementById('exportBtn');
        const progressContainer = document.getElementById('progressContainer');
        const progressText = document.getElementById('progressText');
        const progressPercent = document.getElementById('progressPercent');
        const progressFill = document.getElementById('progressFill');
        const logText = document.getElementById('logText');
        const resultsBody = document.getElementById('resultsBody');
        const proxyList = [
            'https://corsproxy.io/?',
            'https://api.allorigins.win/raw?url='
        ];
        const chkLimit = document.getElementById('chkLimit');

        const appName = document.getElementById('appName');
        const appSubtitle = document.getElementById('appSubtitle');
        const appLogoText = document.getElementById('appLogoText');

        function applyAppConfig() {
            document.title = APP_CONFIG.pageTitle;
            appName.textContent = APP_CONFIG.appName;
            appSubtitle.textContent = APP_CONFIG.subtitle;
            appLogoText.textContent = APP_CONFIG.logoText;
            appLogoText.setAttribute('aria-label', `Logotipo: ${APP_CONFIG.appName}`);
        }

        applyAppConfig();

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                fileLabel.textContent = file.name;
                const reader = new FileReader();
                reader.onload = (e) => parseInput(e.target.result);
                reader.readAsText(file);
            }
        });

        function parseInput(text) {
            const lines = text.split('\n').map(l => l.trim()).filter(l => l);
            if (lines.length === 0) return;

            currentGroups = [];
            resultsMap.clear();
            resultsBody.innerHTML = '';

            const firstLine = lines[0].toLowerCase();
            const isCSV = firstLine.includes('id,') || firstLine.includes('nome base');

            if (isCSV) {
                parseCSV(lines);
            } else {
                parseTXT(lines);
            }

            logText.textContent = `${currentGroups.length} grupos carregados.`;
            startBtn.disabled = currentGroups.length === 0;
            updateUIState(false);
        }

        function parseTXT(lines) {
            for (let line of lines) {
                const parts = line.split('\t');
                if (parts.length >= 1) {
                    const id = parts[0].trim();
                    const nome = parts[1] ? parts[1].trim() : "N/A";
                    if (/^\d{16}$/.test(id)) {
                        const group = { id, nome };
                        currentGroups.push(group);
                        const initialData = createWaitingData(group);
                        resultsMap.set(id, initialData);
                        updateOrAddRow(initialData);
                    }
                }
            }
        }

        function parseCSV(lines) {
            // Simple CSV parser for our exported format (headers, quotes, commas)
            const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
            const idIdx = headers.indexOf('ID');
            const nomeIdx = headers.indexOf('Nome Base');
            const dataColetaIdx = headers.indexOf('Data Coleta');
            const situacaoIdx = headers.indexOf('Situação');
            const liderIdx = headers.indexOf('Líder');
            const viceIdx = headers.indexOf('Vice-Líder');
            const envioIdx = headers.indexOf('Último Envio');
            const formacaoIdx = headers.indexOf('Ano Formação');
            const areaIdx = headers.indexOf('Área');
            const instIdx = headers.indexOf('Instituição');
            const unidadeIdx = headers.indexOf('Unidade');
            const contatoIdx = headers.indexOf('Contato');
            const pqIdx = headers.indexOf('Pesquisadores');
            const nomesIdx = headers.indexOf('Pesquisadores (Nomes)');
            const esIdx = headers.indexOf('Estudantes');
            const teIdx = headers.indexOf('Técnicos');
            const ipIdx = headers.indexOf('Instituições Parceiras');
            const inIdx = headers.indexOf('INCTs Parceiras');

            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
                if (!parts || parts.length < 2) continue;

                const clean = (idx) => (idx !== -1 && parts[idx]) ? parts[idx].replace(/^"|"$/g, '').replace(/""/g, '"').trim() : 'N/A';

                const id = clean(idIdx);
                if (!/^\d{16}$/.test(id)) continue;

                const data = {
                    id: id,
                    nomeInformado: clean(nomeIdx),
                    dataColeta: clean(dataColetaIdx),
                    situacao: clean(situacaoIdx),
                    lider: clean(liderIdx),
                    viceLider: clean(viceIdx),
                    ultimoEnvio: clean(envioIdx),
                    anoFormacao: clean(formacaoIdx),
                    area: clean(areaIdx),
                    instituicao: clean(instIdx),
                    unidade: clean(unidadeIdx),
                    contato: clean(contatoIdx),
                    pesquisadores: parseInt(clean(pqIdx)) || 0,
                    pesquisadoresNomes: clean(nomesIdx),
                    estudantes: parseInt(clean(esIdx)) || 0,
                    tecnicos: parseInt(clean(teIdx)) || 0,
                    instParceiras: parseInt(clean(ipIdx)) || 0,
                    inctsParceiras: parseInt(clean(inIdx)) || 0,
                    error: clean(situacaoIdx).includes('⚠️')
                };

                currentGroups.push({ id: data.id, nome: data.nomeInformado });
                resultsMap.set(id, data);
                updateOrAddRow(data);
            }
        }

        startBtn.addEventListener('click', () => runScraper(currentGroups));
        stopBtn.addEventListener('click', () => {
            isRunning = false;
            logText.textContent = "Interrupção solicitada pelo usuário...";
            stopBtn.disabled = true;
        });
        retryAllBtn.addEventListener('click', () => {
            const failedIds = Array.from(resultsMap.values())
                .filter(d => d.error)
                .map(d => ({ id: d.id, nome: d.nomeInformado }));
            runScraper(failedIds);
        });

        async function runScraper(groups) {
            if (isRunning) return;

            let list = [...groups];
            if (chkLimit.checked && list.length > 20 && groups === currentGroups) {
                list = list.slice(0, 20);
            }

            if (list.length === 0) return;

            isRunning = true;
            updateUIState(true);

            const total = list.length;
            let current = 0;

            for (const group of list) {
                if (!isRunning) break;
                current++;
                updateProgress(current, total, `Extraindo: ${group.id}`);

                try {
                    const data = await fetchGroupData(group.id);
                    const usedFallback = data._usedFallback;
                    delete data._usedFallback;
                    data.id = group.id;
                    data.nomeInformado = group.nome;
                    data.dataColeta = new Date().toLocaleString('pt-BR');
                    data.error = false;
                    resultsMap.set(group.id, data);
                    updateOrAddRow(data);
                    if (current < total) {
                        await new Promise(r => setTimeout(r, usedFallback ? 3000 : 1500));
                    }
                } catch (e) {
                    const errorData = createErrorData(group, e.message);
                    resultsMap.set(group.id, errorData);
                    updateOrAddRow(errorData);
                    if (current < total) {
                        await new Promise(r => setTimeout(r, 1500));
                    }
                }
            }

            isRunning = false;
            updateUIState(false);
            checkFailures();
        }

        async function fetchGroupData(id) {
            const targetUrl = `http://dgp.cnpq.br/dgp/espelhogrupo/${id}`;
            let lastError = null;
            for (const [proxyIndex, proxy] of proxyList.entries()) {
                try {
                    const url = proxy + encodeURIComponent(targetUrl);
                    const resp = await fetch(url);
                    if (!resp.ok) throw new Error(`Status ${resp.status}`);
                    const html = await resp.text();

                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');

                    const leaders = getLideresArray(doc);

                    return {
                        situacao: getFieldValue(doc, 'Situação do grupo:'),
                        anoFormacao: getFieldValue(doc, 'Ano de formação:'),
                        dataSituacao: getFieldValue(doc, 'Data da Situação:'),
                        ultimoEnvio: getFieldValue(doc, 'Data do último envio:'),
                        lider: leaders[0] || 'N/A',
                        viceLider: leaders[1] || 'N/A',
                        area: getFieldValue(doc, 'Área predominante:'),
                        instituicao: getFieldValue(doc, 'Instituição do grupo:'),
                        unidade: getFieldValue(doc, 'Unidade:'),
                        contato: getContatoGrupo(doc),
                        ...getRHCounts(doc),
                        pesquisadoresNomes: getResearcherNames(doc),
                        instParceiras: getPartnershipCount(doc, 'Instituições parceiras'),
                        inctsParceiras: getPartnershipCount(doc, 'INCTs parceiras'),
                        _usedFallback: proxyIndex > 0
                    };
                } catch (e) {
                    lastError = e;
                    // try next proxy
                }
            }
            throw lastError || new Error('Todos os proxies falharam');
        }


        function getResearcherNames(doc) {
            const spans = Array.from(doc.querySelectorAll('th span'));
            const span = spans.find(s => s.textContent.trim() === 'Pesquisadores' && s.closest('table'));
            if (!span) return 'N/A';

            const table = span.closest('table');
            const rows = table.querySelectorAll('tbody tr:not(.ui-datatable-empty-message)');
            const names = Array.from(rows).map(row => {
                const cell = row.querySelector('td');
                return cell ? cell.textContent.trim() : '';
            }).filter(n => n);

            return names.join('; ');
        }

        function getFieldValue(doc, labelText) {
            const labels = Array.from(doc.querySelectorAll('.control-label'));
            const label = labels.find(l => l.textContent.trim().includes(labelText));
            return label ? label.nextElementSibling.textContent.trim().replace(/\s+/g, ' ') : 'N/A';
        }

        function getLideresArray(doc) {
            const labels = Array.from(doc.querySelectorAll('.control-label'));
            const label = labels.find(l => l.textContent.trim().includes('Líder(es) do grupo:'));
            if (!label) return [];

            const controls = label.nextElementSibling.cloneNode(true);
            // Removendo botões e scripts (contato individual protegido)
            controls.querySelectorAll('button, script, div.ui-tooltip').forEach(e => e.remove());

            return controls.innerHTML.split('<br>')
                .map(t => {
                    const temp = document.createElement('div');
                    temp.innerHTML = t;
                    return temp.textContent.trim().replace(/\s+/g, ' ');
                })
                .filter(t => t.length > 2);
        }

        function getContatoGrupo(doc) {
            const labels = Array.from(doc.querySelectorAll('.control-label'));
            const label = labels.find(l => l.textContent.trim().includes('Contato do grupo:'));
            if (label) {
                const controls = label.nextElementSibling;
                const cfEmail = controls.querySelector('.__cf_email__');
                if (cfEmail) {
                    return decodeCloudflareEmail(cfEmail.getAttribute('data-cfemail'));
                }
                const a = controls.querySelector('a');
                return a ? a.textContent.trim() : controls.textContent.trim();
            }
            return 'N/A';
        }

        function decodeCloudflareEmail(hex) {
            let email = '';
            const key = parseInt(hex.substr(0, 2), 16);
            for (let i = 2; i < hex.length; i += 2) {
                const charCode = parseInt(hex.substr(i, 2), 16) ^ key;
                email += String.fromCharCode(charCode);
            }
            return email;
        }

        function getRHCounts(doc) {
            const result = { pesquisadores: 0, estudantes: 0, tecnicos: 0 };
            const legends = Array.from(doc.querySelectorAll('legend'));
            const legend = legends.find(l => l.textContent.includes('Indicadores de recursos humanos'));
            if (!legend) return result;

            const table = legend.parentElement.querySelector('table');
            if (!table) return result;

            const rows = table.querySelectorAll('tbody tr:not(.ui-datatable-empty-message)');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 4) {
                    result.pesquisadores += parseInt(cells[1].textContent.trim()) || 0;
                    result.estudantes += parseInt(cells[2].textContent.trim()) || 0;
                    result.tecnicos += parseInt(cells[3].textContent.trim()) || 0;
                }
            });
            return result;
        }

        function getPartnershipCount(doc, legendText) {
            const legends = Array.from(doc.querySelectorAll('legend'));
            const legend = legends.find(l => l.textContent.includes(legendText));
            if (!legend) return 0;
            const table = legend.parentElement.querySelector('table');
            if (!table) return 0;
            const rows = table.querySelectorAll('tbody tr:not(.ui-datatable-empty-message)');
            return rows.length;
        }

        function getRowCount(doc, header) {
            const spans = Array.from(doc.querySelectorAll('th span.ui-column-title'));
            const span = spans.find(s => s.textContent.trim() === header);
            if (!span) return 0;
            const table = span.closest('table');
            const rows = table.querySelectorAll('tbody tr:not(.ui-datatable-empty-message)');
            return rows.length;
        }

        function updateOrAddRow(data) {
            let tr = document.getElementById(`row-${data.id}`);
            if (!tr) {
                tr = document.createElement('tr');
                tr.id = `row-${data.id}`;
                resultsBody.appendChild(tr);
            }

            const sClass = data.error ? 'status-error' : (data.situacao.toLowerCase().includes('excluído') ? 'status-excluido' : 'status-certificado');

            tr.innerHTML = `
                <td style="text-align:center;">
                    <button class="btn btn-mini" onclick="retrySingle('${data.id}')" title="Recarregar este grupo">🔄</button>
                </td>
                <td><a href="http://dgp.cnpq.br/dgp/espelhogrupo/${data.id}" target="_blank" style="color:var(--accent);">${data.id}</a></td>
                <td style="font-size:0.75rem; white-space:nowrap;">${(data.dataColeta || '-').split(',')[0].split(' ')[0]}</td>
                <td title="${data.nomeInformado}">${truncate(data.nomeInformado, 25)}</td>
                <td><span class="status-badge ${sClass}" title="${data.error ? data.situacao : ''}">${data.error ? '⚠️ ERRO' : data.situacao}</span></td>
                <td>${data.lider}</td>
                <td>${data.viceLider}</td>
                <td>${data.ultimoEnvio}</td>
                <td>${data.anoFormacao}</td>
                <td title="${data.area}">${truncate(data.area, 15)}</td>
                <td title="${data.unidade}">${truncate(data.unidade, 15)}</td>
                <td>${data.contato}</td>
                <td style="text-align:center;">${data.pesquisadores}</td>
                <td style="text-align:center;">${data.estudantes}</td>
                <td style="text-align:center;">${data.tecnicos}</td>
                <td style="text-align:center;">${data.instParceiras}</td>
                <td style="text-align:center;">${data.inctsParceiras}</td>
                <td title="${data.pesquisadoresNomes}">${truncate(data.pesquisadoresNomes, 30)}</td>
            `;
        }

        async function retrySingle(id) {
            if (isRunning) return;
            const entry = currentGroups.find(g => g.id === id);
            if (!entry) return;

            isRunning = true;
            logText.textContent = `Recarregando ${id}...`;
            try {
                const data = await fetchGroupData(id);
                data.id = id;
                data.nomeInformado = entry.nome;
                data.dataColeta = new Date().toLocaleString('pt-BR');
                data.error = false;
                resultsMap.set(id, data);
                updateOrAddRow(data);
                logText.textContent = `Sucesso: ${id}`;
            } catch (e) {
                logText.textContent = `Falha: ${id}`;
            }
            isRunning = false;
            checkFailures();
        }

        function createErrorData(group, msg) {
            return {
                id: group.id,
                nomeInformado: group.nome,
                error: true,
                situacao: msg,
                anoFormacao: '?',
                ultimoEnvio: '?',
                lider: '?', viceLider: '?', area: '?', instituicao: '?', unidade: '?', contato: '?',
                pesquisadores: 0, estudantes: 0, tecnicos: 0, instParceiras: 0, inctsParceiras: 0,
                pesquisadoresNomes: '?',
                dataColeta: '-'
            };
        }

        function createWaitingData(group) {
            return {
                id: group.id,
                nomeInformado: group.nome,
                error: false,
                situacao: 'Aguardando...',
                anoFormacao: '-',
                ultimoEnvio: '-',
                lider: '-', viceLider: '-', area: '-', instituicao: '-', unidade: '-', contato: '-',
                pesquisadores: 0, estudantes: 0, tecnicos: 0, instParceiras: 0, inctsParceiras: 0,
                pesquisadoresNomes: '-',
                dataColeta: '-'
            };
        }

        function updateUIState(active) {
            startBtn.disabled = active;
            stopBtn.style.display = active ? 'inline-flex' : 'none';
            stopBtn.disabled = false;
            retryAllBtn.style.display = 'none';
            exportBtn.disabled = active || resultsMap.size === 0;
            progressContainer.style.display = 'block';
        }

        function checkFailures() {
            const hasFailures = Array.from(resultsMap.values()).some(d => d.error);
            retryAllBtn.style.display = hasFailures ? 'inline-flex' : 'none';
        }

        function updateProgress(curr, tot, msg) {
            const p = Math.round((curr / tot) * 100);
            progressText.textContent = `Processando: ${curr} de ${tot}`;
            progressPercent.textContent = `${p}%`;
            progressFill.style.width = `${p}%`;
            logText.textContent = msg;
        }

        function truncate(str, n) { return str.length > n ? str.substr(0, n - 1) + '...' : str; }

        exportBtn.addEventListener('click', () => {
            const headers = ['ID', 'Data Coleta', 'Nome Base', 'Situação', 'Líder', 'Vice-Líder', 'Último Envio', 'Ano Formação', 'Área', 'Instituição', 'Unidade', 'Contato', 'Pesquisadores', 'Pesquisadores (Nomes)', 'Estudantes', 'Técnicos', 'Instituições Parceiras', 'INCTs Parceiras'];
            const rows = [headers.join(',')];
            resultsMap.forEach(r => {
                const vals = [r.id, r.dataColeta, r.nomeInformado, r.situacao, r.lider, r.viceLider, r.ultimoEnvio, r.anoFormacao, r.area, r.instituicao, r.unidade, r.contato, r.pesquisadores, r.pesquisadoresNomes, r.estudantes, r.tecnicos, r.instParceiras, r.inctsParceiras];
                rows.push(vals.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
            });
            const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'coletor_dgp.csv'; a.click();
        });
    
