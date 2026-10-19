#!/usr/bin/env bash
#
# Pipeline de atualização dos grupos de pesquisa do IFBA:
#
#   SUAP (lista de grupos)  →  DGP/CNPq (detalhes)  →  dashboard-prpgi (build)
#
#  1. suap/listar_grupos.py  — loga no SUAP e gera `lista de grupos de pesquisa.txt`
#  2. cli/coletar.js          — varre o DGP/CNPq e gera `coletor_dgp_YYYY-MM-DD.csv`
#  3. copia o CSV para o dashboard (`dados/scraper-DGP/`)
#  4. roda `npm run build` no dashboard (regenera `data.json` anonimizado)
#  5. valida e testa o dashboard
#
# O CSV bruto contém PII (nomes/contatos) e NÃO é versionado. Apenas o
# `data.json` (anonimizado) e a `lista de grupos` (só ID + nome) vão ao git.
#
# Uso:
#   ./pipeline.sh                  # roda tudo (precisa suap/.env)
#   ./pipeline.sh --skip-suap      # reusa a lista já gerada (não loga no SUAP)
#   ./pipeline.sh --commit         # após rodar, faz git add/commit/push nos 2 repos
#                                  # (sincroniza com o remoto antes; aborta se divergir)
#   ./pipeline.sh --dashboard DIR  # caminho alternativo do dashboard
#
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"

DASHBOARD="${DASHBOARD:-$ROOT/../dashboard-prpgi}"
SKIP_SUAP=false
DO_COMMIT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-suap) SKIP_SUAP=true ;;
    --commit)    DO_COMMIT=true ;;
    --dashboard) DASHBOARD="$2"; shift ;;
    *) echo "Opção desconhecida: $1" >&2; exit 2 ;;
  esac
  shift
done

echo "=== Pipeline DGP → dashboard ==="
echo "dashboard: $DASHBOARD"

# ── Sincronização com o remoto (só com --commit) ─────────────────────────────
# Os dois repos recebem commits automáticos: a lista vem do agendamento local
# (`scripts/atualizar-lista.sh`) e o `data.json` vem do workflow semanal do
# dashboard. Commitar em cima de um clone desatualizado gera push rejeitado, ou
# um rebase manual que desfaz a rodada automática. Por isso o pipeline só segue
# com os clones iguais ao remoto, e confere de novo antes de commitar.
sincronizar() {
  local repo="$1" nome="$2"
  echo "    $nome: git pull --ff-only"
  if ! git -C "$repo" pull --ff-only --quiet; then
    echo "ERRO: $nome não avança só por fast-forward (commits locais divergentes" >&2
    echo "      ou alterações locais em conflito). Resolva à mão e rode de novo." >&2
    exit 1
  fi
  conferir_remoto "$repo" "$nome"
}

# Falha se o clone difere do remoto (por exemplo, se o remoto andou durante a
# execução). Não tenta rebase: no dashboard, o outro commit é quase sempre a
# rodada automática regravando o mesmo `data.json`.
conferir_remoto() {
  local repo="$1" nome="$2"
  if ! git -C "$repo" fetch --quiet; then
    echo "ERRO: $nome: git fetch falhou. Nada foi commitado." >&2
    exit 1
  fi
  if [[ "$(git -C "$repo" rev-parse HEAD)" != "$(git -C "$repo" rev-parse '@{u}')" ]]; then
    echo "ERRO: $nome: o clone local difere do remoto (commit local não enviado," >&2
    echo "      ou o remoto mudou durante a execução, provavelmente pela rodada" >&2
    echo "      automática). Nada foi commitado. Sincronize e rode de novo." >&2
    exit 1
  fi
}

if [[ "$DO_COMMIT" == "true" ]]; then
  echo
  echo "── Sincronizando com o remoto (--commit) ─────────────────"
  sincronizar "$ROOT" "scraper-DGP"
  sincronizar "$DASHBOARD" "dashboard"
fi

# ── 1. Lista de grupos (SUAP) ────────────────────────────────────────────────
if [[ "$SKIP_SUAP" == "false" ]]; then
  echo
  echo "── 1/5 Lista de grupos (SUAP) ────────────────────────────"
  python3 suap/listar_grupos.py
else
  echo
  echo "── 1/5 SUAP pulado (--skip-suap) — usando lista existente ──"
  test -f "$ROOT/lista de grupos de pesquisa.txt" || {
    echo "ERRO: lista de grupos não encontrada. Rode sem --skip-suap." >&2
    exit 1
  }
fi

# ── 2. Varredura DGP ──────────────────────────────────────────────────────────
echo
echo "── 2/5 Varredura DGP/CNPq ────────────────────────────────"
CSV_NAME="coletor_dgp_$(date +%F).csv"
node cli/coletar.js --out "$CSV_NAME"

# ── 3. Copia CSV para o dashboard ────────────────────────────────────────────
echo
echo "── 3/5 Copiando CSV para o dashboard ────────────────────"
mkdir -p "$DASHBOARD/dados/scraper-DGP"
cp "$CSV_NAME" "$DASHBOARD/dados/scraper-DGP/$CSV_NAME"
echo "    → $DASHBOARD/dados/scraper-DGP/$CSV_NAME"

# ── 4. Build do dashboard ─────────────────────────────────────────────────────
echo
echo "── 4/5 Build do dashboard ────────────────────────────────"
( cd "$DASHBOARD" && npm run build )

# ── 5. Validação e testes ─────────────────────────────────────────────────────
echo
echo "── 5/5 Validação e testes ────────────────────────────────"
( cd "$DASHBOARD" && npm run validate && npm test )

echo
echo "=== Pipeline concluído ==="
echo "CSV gerado:      $ROOT/$CSV_NAME"
echo "data.json novo:  $DASHBOARD/data.json"

# ── Commit/push opcional ──────────────────────────────────────────────────────
if [[ "$DO_COMMIT" == "true" ]]; then
  echo
  echo "── Commit/push ───────────────────────────────────────────"
  DATE="$(date +%F)"
  conferir_remoto "$ROOT" "scraper-DGP"
  conferir_remoto "$DASHBOARD" "dashboard"
  FALHOU=false
  (
    cd "$ROOT"
    git add "lista de grupos de pesquisa.txt" suap cli pipeline.sh package.json package-lock.json .gitignore
    if git diff --cached --quiet; then
      echo "  (scraper-DGP: nada a commitar)"
    else
      git commit -m "dados: lista de grupos + pipeline DGP ($DATE)" \
        && git push
    fi
  ) || { echo "ERRO: scraper-DGP: commit/push falhou." >&2; FALHOU=true; }
  (
    cd "$DASHBOARD"
    git add data.json
    if git diff --cached --quiet; then
      echo "  (dashboard: nada a commitar)"
    else
      git commit -m "dados: atualiza grupos de pesquisa ($DATE)" \
        && git push
    fi
  ) || { echo "ERRO: dashboard: commit/push falhou." >&2; FALHOU=true; }
  if [[ "$FALHOU" == "true" ]]; then
    echo "Commit/push incompleto (veja os erros acima)." >&2
    exit 1
  fi
  echo "Commit/push concluído."
fi
