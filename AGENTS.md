# AGENTS.md — Coletor DGP

## Fonte de Dados

- **Sistema**: DGP/CNPq (Diretório de Grupos de Pesquisa)
- **URL base**: `http://dgp.cnpq.br/dgp/espelhogrupo/{id}`
- **Proxies**: localhost:3000, allorigins.win, codetabs, corsproxy.io, cors-anywhere (fallback)
- **API alternativa**: Cloudflare Worker em `proxy/cloudflare/`

## Dados Coletados

| Campo | Descrição |
|-------|-----------|
| ID | Identificador de 16 dígitos do grupo |
| Nome Base | Nome do grupo de pesquisa |
| Situação | Certificado/Excluído |
| Líder(es) | Nome do líder do grupo |
| Vice-Líder | Nome do vice-líder |
| Último Envio | Data do último envio ao CNPq |
| Ano Formação | Ano de formação do grupo |
| Área | Área predominante |
| Instituição | Instituição do grupo |
| Unidade | Unidade/campus |
| Pesquisadores | Quantidade de pesquisadores |
| Estudantes | Quantidade de estudantes |
| Técnicos | Quantidade de técnicos |
| Instituições Parceiras | Quantidade de parceiras |
| Linhas de Pesquisa | Linhas de pesquisa cadastradas |

## Formato de Entrada

Arquivo `.txt` (IDs separados por tab) ou `.csv` com colunas.

## Formato de Saída

CSV (`coletor_dgp_[data].csv`) exportado pelo frontend.

## Projetos Consumidores

- **dashboard-prpgi** → `dados/scraper-DGP/coletor_dgp_ifba.csv` → `data.json`
- **dados feminino** (PRPGI) → `coletor_dgp_2026-06-19.csv`

## Fluxo

```
dgp.cnpq.br → [proxy CORS] → app.js (frontend) → CSV exportado
                                                         ↓
                                           dashboard-prpgi/build.js → data.json
```

## TODO.md

Este projeto mantém um `TODO.md` na raiz com o planejamento e acompanhamento das tarefas.
O agente é responsável por criar e manter este arquivo atualizado.

O arquivo `TODO.md` da raiz de `/home/davi/projetos/` consolida automaticamente os TODOs de todos os subprojetos.
Execute `python3 /home/davi/projetos/_gen_sumula.py` para regenerar a súmula consolidada após alterações neste TODO.md.

