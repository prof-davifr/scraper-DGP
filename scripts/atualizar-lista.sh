#!/usr/bin/env bash
#
# Mantém em dia a `lista de grupos de pesquisa.txt` — a entrada do coletor DGP.
#
# Por que existe: a varredura do DGP já roda sozinha, num agendamento do
# `dashboard-prpgi`. Mas ela parte desta lista, e a lista só sai do SUAP, que
# exige login institucional e a rede do IFBA. O runner público não alcança o
# SUAP, então este passo roda aqui, na máquina do assessor.
#
# O script é conservador de propósito:
#   - se o SUAP não responde (fora da rede do IFBA), ele sai sem erro;
#   - se a lista foi atualizada há poucos dias, ele sai sem fazer nada;
#   - se nada mudou no SUAP, ele não cria commit;
#   - ele só versiona a lista (ID + nome). O CSV do DGP tem dados pessoais e
#     continua fora do git.
#
# Uso:
#   ./scripts/atualizar-lista.sh            # cadência normal (7 dias)
#   MAX_IDADE_DIAS=0 ./scripts/atualizar-lista.sh   # força a execução agora
#
# Agendamento: veja `systemd/` neste repositório.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LISTA="lista de grupos de pesquisa.txt"
MAX_IDADE_DIAS="${MAX_IDADE_DIAS:-7}"
DASHBOARD_REPO="${DASHBOARD_REPO:-prof-davifr/dashboard-prpgi}"
MARCA="${XDG_STATE_HOME:-$HOME/.local/state}/scraper-DGP/ultima-consulta-suap"

log() { printf '%s  %s\n' "$(date '+%F %T')" "$*"; }

# O serviço do systemd não herda o ambiente do terminal, e o `python3` do
# sistema não tem selenium. Escolhe o primeiro interpretador que consegue
# importar selenium; `PYTHON=/caminho/python3` força um específico.
escolher_python() {
  local cand
  if [[ -n "${PYTHON:-}" ]]; then echo "$PYTHON"; return; fi
  for cand in "$HOME"/.pyenv/versions/*/bin/python3 "$(command -v python3 || true)"; do
    [[ -x "$cand" ]] || continue
    if "$cand" -c 'import selenium' >/dev/null 2>&1; then echo "$cand"; return; fi
  done
  return 1
}

# Marca a consulta como feita. Vale também quando o SUAP não mudou nada: o que
# controla a cadência é a consulta, não o commit. Sem isso, uma semana sem
# grupo novo faria o robô entrar no SUAP todo dia.
marcar() { mkdir -p "$(dirname "$MARCA")" && touch "$MARCA"; }

# ── 1. O SUAP está ao alcance? ───────────────────────────────────────────────
if ! curl -sfI --max-time 15 https://suap.ifba.edu.br/ >/dev/null 2>&1; then
  log "SUAP fora de alcance — máquina provavelmente fora da rede do IFBA."
  log "Nada a fazer. A próxima execução tenta de novo."
  exit 0
fi

# ── 2. O SUAP já foi consultado há pouco? ────────────────────────────────────
if [[ -f "$MARCA" ]]; then
  IDADE=$(( ( $(date +%s) - $(stat -c %Y "$MARCA") ) / 86400 ))
  if (( IDADE < MAX_IDADE_DIAS )); then
    log "SUAP consultado há $IDADE dia(s), abaixo do limite de $MAX_IDADE_DIAS. Nada a fazer."
    exit 0
  fi
  log "Última consulta ao SUAP há $IDADE dia(s). Vou consultar de novo."
else
  log "Sem registro de consulta anterior. Vou consultar o SUAP."
fi

# ── 3. Sincroniza antes de escrever ──────────────────────────────────────────
git pull --rebase --autostash

# ── 4. Gera a lista a partir do SUAP ─────────────────────────────────────────
PY="$(escolher_python)" || {
  log "ERRO: nenhum python3 com selenium. Instale com 'pip install -r suap/requirements.txt'."
  exit 1
}
log "Interpretador: $PY"
"$PY" suap/listar_grupos.py

marcar

# ── 5. Publica somente se o SUAP trouxe grupo novo ou removido ───────────────
if git diff --quiet -- "$LISTA"; then
  log "Nenhum grupo novo ou removido. Lista inalterada."
  exit 0
fi

# O SUAP não garante ordem estável entre grupos de nome idêntico, e duas linhas
# trocadas de lugar não são mudança nenhuma. Sem esta guarda, cada rodada geraria
# um commit vazio de sentido e uma varredura do DGP à toa.
if diff -q <(git show "HEAD:$LISTA" | sort) <(sort -- "$LISTA") >/dev/null 2>&1; then
  log "Só a ordem das linhas mudou. Descartando."
  git checkout -- "$LISTA"
  exit 0
fi

RESUMO="$(git diff --numstat -- "$LISTA" | awk '{printf "+%s -%s linha(s)", $1, $2}')"
git add -- "$LISTA"
git commit -m "dados: lista de grupos de pesquisa ($(date +%F))"
git push
log "Lista publicada ($RESUMO)."

# ── 6. Pede a varredura agora, sem esperar o agendamento semanal ─────────────
if command -v gh >/dev/null 2>&1; then
  if gh workflow run refresh-grupos.yml --repo "$DASHBOARD_REPO" >/dev/null 2>&1; then
    log "Varredura do DGP disparada em $DASHBOARD_REPO."
  else
    log "AVISO: não consegui disparar a varredura. Ela roda no horário agendado."
  fi
fi
