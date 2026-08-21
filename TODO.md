# TODO — Coletor DGP

Coletor do Diretório de Grupos de Pesquisa (DGP/CNPq) do IFBA — versão web
(`assets/app.js`) + CLI headless (`cli/coletar.js`) + extrator da lista do SUAP
(`suap/listar_grupos.py`) + pipeline (`pipeline.sh`).

---

## 🟢 Concluído (ago/2026)

### Automação da lista de grupos (SUAP) e varredura headless (DGP)
- [x] **`suap/listar_grupos.py`** (Selenium) — loga no SUAP, lê o changelist
      `admin/cnpq/grupopesquisa/?instituicao=IFBA` (uma página, sem paginação) e
      gera `lista de grupos de pesquisa.txt` (`ID\tNome`). Compara com a lista
      anterior e loga **novos/removidos**. Login via submit JS (o botão "Acessar"
      é interceptado por um overlay `<ul class="_main_menu">`).
- [x] **`cli/coletar.js` + `cli/parser.js`** — port fiel do parser de `app.js`
      para Node + jsdom. Sem proxy CORS (o `fetch` nativo acessa `dgp.cnpq.br`
      direto). Concorrência, retry e timeout. Gera `coletor_dgp_YYYY-MM-DD.csv`
      no mesmo formato de 19 colunas.
- [x] **`pipeline.sh`** — encadeia SUAP→DGP→dashboard (`npm run build` +
      `validate` + `test`). Flags `--skip-suap`, `--dashboard DIR`, `--commit`.
- [x] **`cli/smoke.js` + `.github/workflows/ci.yml`** — valida o parser contra o
      fixture `samples/espelhogrupo-exemplo.html` e a lista versionada, e faz uma
      varredura real de 3 grupos (sem PII versionada).
- [x] **`lista de grupos de pesquisa.txt` versionada** (só ID + nome, sem PII);
      CSVs continuam ignorados (PII).
- [x] Senha do SUAP atualizada nos `.env` gitignored (este repo,
      `scraper-SUAPCNPQ` e `scraper-SUAPPos`) em 21/08/2026.

### Resultado da 1ª rodada (21/08/2026)
- SUAP: **210 grupos** (a lista manual tinha **197** → **13 novos**, 0 removidos).
- Varredura DGP: **210/210 coletados, 0 erros** (~165 s).
- Situações: 154 Certificado, 29 Excluído, 22 Em preenchimento, 4
  Não-atualizado >12m, 1 **Aguardando certificação** (situação nova).
- Dashboard: `data.json` regenerado com `grupos=210`, `validate` OK, 294 testes.

---

## 📋 Backlog

- [ ] **Mover o fixture HTML para um grupo "Certificado"** — o fixture atual
      (`Agrobiosaneamento`) é "Excluído"; um grupo ativo exercitaria mais campos
      (linhas de pesquisa, INCTs).
- [ ] **CI de ponta a ponta com segredos** — hoje o SUAP exige credenciais + rede
      institucional e o CSV tem PII, então o pipeline completo roda localmente
      (`pipeline.sh`). Avaliar um runner auto-hospedado se a PRPGI quiser agendar.
- [ ] **Dedup de grupos por nome** — a lista do SUAP pode trazer duplicatas por
      nome (ex.: "Educação, Linguagens e Práxis Pedagógica" aparece 2x na lista
      antiga). Hoje a chave é o ID DGP; nomes duplicados não são problema.
- [ ] **Modo incremental** — re-varredura só dos grupos novos/alterados em vez de
      210 a cada rodada (o custo atual é ~3 min, aceitável).
