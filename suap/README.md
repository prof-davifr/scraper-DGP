# SUAP → lista de grupos de pesquisa

Extrai a lista de grupos de pesquisa do SUAP/IFBA e gera o arquivo que alimenta o
Coletor-DGP (`lista de grupos de pesquisa.txt`, formato `ID\tNome`).

## Por quê

A lista era exportada manualmente do SUAP — grupos novos ficavam de fora da varredura
do DGP. Hoje o SUAP tem **210 grupos**; a lista antiga tinha **197** (13 novos).

## Fonte

`https://suap.ifba.edu.br/admin/cnpq/grupopesquisa/?instituicao=IFBA`
(Django admin changelist, uma página só, sem paginação.)

## Uso

```bash
# 1. credenciais (gitignored, chmod 600)
cp suap/.env.example suap/.env
# edite suap/.env com SUAP_USER / SUAP_PASS

# 2. dependências
pip install -r suap/requirements.txt

# 3. rodar
python3 suap/listar_grupos.py
```

Opções: `--out CAMINHO`, `--url URL`, `--no-headless` (navegador visível), `--debug`.

A saída é idêntica ao formato manual: header `#\tNome` + linhas `ID\tNome`
(ID DGP de 16 dígitos). O script compara com a lista anterior e loga
**NOVOS** (entram na varredura) e **REMOVIDOS**.
