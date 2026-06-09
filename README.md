# Coletor DGP

Sistema web para **extração automatizada de dados do Diretório de Grupos de Pesquisa (DGP)** do CNPq.

A ferramenta permite carregar uma lista de **IDs de grupos de pesquisa**, realizar a **varredura automática das páginas públicas do DGP**, extrair informações relevantes e **exportar os resultados em CSV**.

Projeto desenvolvido para apoiar instituições no monitoramento de grupos de pesquisa do DGP/CNPq.

---

## Acesso

A aplicação pode ser executada diretamente no navegador:

https://prof-davifr.github.io/coletor-dgp

---

## Funcionalidades

* Importação de lista de grupos via **TXT ou CSV**
* Extração automática de dados do DGP com **coleta paralela** (1–5 workers configurável)
* Identificação de **líder e vice-líder**
* Contagem de:

  * Pesquisadores
  * Estudantes
  * Técnicos
  * Instituições parceiras
  * INCTs parceiras
* Extração das **linhas de pesquisa** do grupo
* Registro da **data de coleta**
* Sistema de **retry automático para falhas**
* Possibilidade de **interromper a varredura**
* **Autosave de sessão** no `localStorage` com restauração automática ao recarregar
* Exportação dos resultados para **CSV**
* Visualização dos dados em **tabela interativa**
* **Modo teste** (limita execução aos primeiros 20 grupos)

---

## Dados coletados

A aplicação extrai informações públicas do **Diretório de Grupos de Pesquisa do CNPq**, incluindo:

* ID do grupo
* Nome do grupo
* Situação do grupo
* Líder e vice-líder
* Ano de formação
* Área predominante
* Instituição
* Unidade
* Contato do grupo
* Número de pesquisadores
* Número de estudantes
* Número de técnicos
* Instituições parceiras
* INCTs parceiras
* Lista de pesquisadores
* Linhas de pesquisa

---

## Formato dos arquivos de entrada

### TXT

Arquivo com **ID do grupo e nome**, separados por tabulação:

```
1234567890123456    Grupo de Pesquisa em Engenharia
2345678901234567    Grupo de Pesquisa em Física
```

### CSV

Também aceita arquivos CSV previamente exportados pela própria ferramenta.

---

## Como usar

1. Abra o sistema no navegador
2. Clique em **Carregar Arquivo**
3. Envie um arquivo `.txt` ou `.csv` com os IDs dos grupos
4. Clique em **Iniciar Varredura**
5. Aguarde a coleta dos dados
6. Clique em **Exportar CSV** para baixar os resultados

---

## Tecnologias utilizadas

* HTML5
* CSS3
* JavaScript (Vanilla)
* DOMParser
* Fetch API

A aplicação roda **100% no navegador**, sem necessidade de backend.

---

## Observações importantes

* A ferramenta utiliza **proxies CORS** para acessar as páginas do DGP.
* Por padrão, o scraper tenta primeiro um **proxy local** (`localhost:3000`), depois o **proxy personalizado** (se configurado), e então faz fallback para proxies públicos.
* Para usar o proxy local, execute `npm start` antes de abrir o scraper (`node proxy/proxy.js`).
* O funcionamento depende da **estrutura HTML atual das páginas do DGP**.
* Caso o site do CNPq seja alterado, pode ser necessário atualizar o parser.

---

## Proxy Local

Para evitar erros de CORS e aumentar a confiabilidade, o projeto inclui um proxy local:

```bash
npm install
npm start
```

O proxy roda em `http://localhost:3000` e é utilizado automaticamente pelo scraper como primeira opção.
O proxy local agora restringe requisições apenas ao domínio `dgp.cnpq.br`.

---

## Cloudflare Worker (Proxy Dedicado)

Para uma solução mais robusta sem depender de proxies públicos, o projeto inclui um Cloudflare Worker gratuito em `proxy/cloudflare/`:

```bash
# 1. Instalar Wrangler (uma vez)
npm install -g wrangler

# 2. Autenticar (uma vez)
wrangler login

# 3. Deploy
cd proxy/cloudflare
wrangler deploy
# Output: https://coletor-dgp-proxy.<seu-subdominio>.workers.dev
```

Após o deploy, cole a URL gerada (terminando em `?url=`) no campo **Proxy Personalizado** em Configurações Avançadas. A URL é salva automaticamente no `localStorage` e não precisa ser reconfigurada.

---

## Possíveis aplicações

* Pró-reitorias de pesquisa
* Levantamento institucional de grupos
* Análise de indicadores de pesquisa
* Construção de dashboards científicos
* Monitoramento de grupos do DGP

---

## Autor

**Davi Franco Rego**

---

## Licença

Este projeto está licenciado sob a **MIT License**.
