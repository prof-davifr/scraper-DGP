# TODO — Coletor DGP

Coletor do Diretório de Grupos de Pesquisa (DGP/CNPq) do IFBA — versão web
(`assets/app.js`) + CLI headless (`cli/coletar.js`) + extrator da lista do SUAP
(`suap/listar_grupos.py`) + pipeline (`pipeline.sh`).

Onde termina a automação hoje (31/08/2026):

```
SUAP (lista de grupos)  →  DGP/CNPq (detalhes)  →  dashboard-prpgi (data.json)
   MANUAL/local              AUTOMÁTICO             AUTOMÁTICO
   (credencial + rede)       (GitHub Actions, semanal, lista versionada)
```

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

### Atualização semanal em produção, sem intervenção
- [x] **A varredura DGP → `data.json` roda sozinha** no `dashboard-prpgi`
      (`.github/workflows/refresh-grupos.yml`, seg 06:00 UTC): dá checkout deste
      repo, roda `npm ci` + `node cli/coletar.js --out /tmp/coletor.csv`, aplica
      `scripts/refresh-grupos.js` e só commita se o `data.json` mudou. Não usa
      credencial e não versiona PII — a entrada é a lista pública deste repo.
- [x] **Duas rodadas verdes**: 24/08 (3m09s) e 31/08 (3m27s), ambas commitando
      `chore(data): atualiza grupos de pesquisa (DGP) [auto]` no dashboard
      (`9ace5b4` e `d047af9`) com deploy do Pages logo em seguida.
- [x] **CI semanal do parser deste repo** vigiando o HTML do DGP — rodadas
      agendadas verdes em 24/08 (20s) e 31/08 (21s).

### Resultado da 1ª rodada (21/08/2026)
- SUAP: **210 grupos** (a lista manual tinha **197** → **13 novos**, 0 removidos).
- Varredura DGP: **210/210 coletados, 0 erros** (~165 s).
- Situações: 154 Certificado, 29 Excluído, 22 Em preenchimento, 4
  Não-atualizado >12m, 1 **Aguardando certificação** (situação nova).
- Dashboard: `data.json` regenerado com `grupos=210`, `validate` OK, 294 testes.

### Deriva capturada pela rodada automática (31/08/2026)
Mesmos 210 IDs, situações diferentes — é exatamente o que a automação existe para
pegar: 151 Certificado (−3), 30 Excluído (+1), 3 Aguardando certificação (+2),
22 Em preenchimento e 4 Não-atualizado >12m estáveis.

---

## 📋 Backlog

- [ ] **Reexecutar a lista do SUAP — congelada desde 21/08/2026.**
      `lista de grupos de pesquisa.txt` tem um único commit (`39f4807`, 21/08).
      Grupo novo não entra na varredura. A rodada semanal revarre sempre os
      **mesmos 210 IDs**: grupo criado no SUAP depois dessa data é invisível para
      o dashboard, e grupo removido continua na base. Esta é a única etapa ainda
      manual (exige credencial do SUAP + rede institucional). Falta decidir a
      cadência — cron local mensal com `./pipeline.sh --commit`, ou rodar
      `npm run listar` à mão e commitar só a lista.
- [ ] **`pipeline.sh --commit` colide com o commit automático do dashboard.**
      O script faz `git add/commit/push` do `data.json` sem `git pull` antes, e
      agora o workflow semanal também commita nesse mesmo arquivo.
      Push local a partir de clone desatualizado é rejeitado (ou o rebase manual
      desfaz a rodada automática). Falta inserir `git pull --rebase` — ou
      `--ff-only` com aborto explícito — antes do commit nos dois repos.
- [ ] **Mover o fixture HTML para um grupo "Certificado".**
      Continua valendo: o fixture (`Agrobiosaneamento`) segue "Excluído" e as 12
      asserções de `cli/smoke.js` não cobrem **linhas de pesquisa nem INCTs**,
      que só um grupo ativo exercita. Escolher um grupo
      certificado e estável antes de trocar.
- [ ] **Etapa SUAP só automatiza com runner auto-hospedado — decidir na PRPGI.**
      Só funciona com uma máquina na rede do IFBA guardando
      `SUAP_USER`/`SUAP_PASS`; o runner público do GitHub não alcança o SUAP.
      Depende de quem hospeda a máquina e de quem responde pela credencial.
      Alternativa a investigar antes: descobrir grupos novos direto da busca
      pública do DGP por instituição, o que dispensaria a credencial.
- [ ] **Modo incremental: revarrer só os grupos novos/alterados, não os 210.**
      Custo atual medido no Actions: ~3 min por rodada, aceitável. Só vira
      prioridade se a lista crescer muito ou o DGP passar a limitar taxa.
- [ ] **Dedup de grupos por nome — confirmar cadastros duplicados na PRPGI.**
      Verificado em 31/08: a lista tem **3 nomes repetidos**
      ("Educação, Linguagens e Práxis Pedagógica", "Laboratório de Estudos Brasil
      Profundo", "Modelagem matemática de processos biológicos em lodos
      ativados") e **zero IDs repetidos**. Como a chave é o ID DGP, não há
      defeito de código a corrigir; falta só a confirmação institucional.
