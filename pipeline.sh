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
  (
    cd "$ROOT"
    git add "lista de grupos de pesquisa.txt" suap cli pipeline.sh package.json package-lock.json .gitignore
    git commit -m "dados: lista de grupos + pipeline DGP ($DATE)" || echo "  (scraper-DGP: nada a commitar)"
    git push || echo "  (scraper-DGP: push falhou)"
  )
  (
    cd "$DASHBOARD"
    git add data.json
    git commit -m "dados: atualiza grupos de pesquisa ($DATE)" || echo "  (dashboard: nada a commitar)"
    git push || echo "  (dashboard: push falhou)"
  )
  echo "Commit/push concluído (verifique as mensagens acima)."
fi
