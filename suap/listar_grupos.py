#!/usr/bin/env python3
"""
Lista os grupos de pesquisa do SUAP/IFBA e gera o arquivo de entrada do Coletor-DGP.

Fonte: https://suap.ifba.edu.br/admin/cnpq/grupopesquisa/?instituicao=IFBA
       (Django admin changelist — uma página só, sem paginação)

Saída: `lista de grupos de pesquisa.txt` no formato `ID\\tNome` (ID DGP de 16 dígitos),
       exatamente o que o Coletor-DGP (parseTXT) e o `cli/coletar.js` esperam.

Uso:
  python3 suap/listar_grupos.py [--out CAMINHO] [--no-headless] [--debug]

Requisitos (instalar com `pip install -r suap/requirements.txt`):
  - selenium
  - webdriver-manager (opcional; o Selenium Manager resolve o chromedriver)

Credenciais: `suap/.env` (gitignored, chmod 600):
  SUAP_USER=...
  SUAP_PASS=...
  SUAP_BASE_URL=https://suap.ifba.edu.br
"""

import argparse
import logging
import os
import re
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "lista de grupos de pesquisa.txt"
DEFAULT_URL = "https://suap.ifba.edu.br/admin/cnpq/grupopesquisa/?instituicao=IFBA"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("suap-grupos")

ID_RE = re.compile(r"espelhogrupo/(\d{16})")


def load_env(path: Path) -> dict:
    """Carrega um .env simples (KEY=VALOR), sem dependência de python-dotenv."""
    if not path.exists():
        logger.error("Arquivo .env não encontrado: %s", path)
        sys.exit(1)
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def setup_driver(headless: bool, debug: bool):
    opts = Options()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    if not debug:
        opts.add_argument("--log-level=3")
    try:
        from webdriver_manager.chrome import ChromeDriverManager
        from selenium.webdriver.chrome.service import Service

        return webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)
    except ImportError:
        return webdriver.Chrome(options=opts)


def login(driver, user: str, password: str) -> bool:
    driver.get("https://suap.ifba.edu.br/accounts/login/")
    time.sleep(2)
    driver.find_element(By.ID, "id_username").send_keys(user)
    driver.find_element(By.ID, "id_password").send_keys(password)
    # O clique no botão "Acessar" é interceptado por um overlay (<ul class="_main_menu">),
    # então submete o form via JS.
    driver.execute_script("document.querySelector('form').submit()")
    time.sleep(4)
    if "login" in driver.current_url.lower():
        logger.error("Login falhou — verifique SUAP_USER/SUAP_PASS.")
        return False
    logger.info("Login OK: %s", driver.current_url)
    return True


def scrape_groups(driver, url: str) -> list[tuple[str, str]]:
    driver.get(url)
    time.sleep(4)
    if "login" in driver.current_url.lower():
        raise RuntimeError("Sessão expirou — é necessário reautenticar.")

    rows = driver.find_elements(By.CSS_SELECTOR, "#result_list tbody tr")
    groups: list[tuple[str, str]] = []
    for tr in rows:
        try:
            a = tr.find_element(By.CSS_SELECTOR, "td.field-get_url_grupo_pesquisa a")
            href = a.get_attribute("href") or ""
            m = ID_RE.search(href)
            if not m:
                continue
            gid = m.group(1)
            nome = tr.find_element(By.CSS_SELECTOR, "td.field-descricao").text.strip()
            groups.append((gid, nome))
        except Exception:
            # Linha sem os campos esperados (ex.: linha vazia) — ignora.
            continue

    # Garante unicidade e ordem estável
    seen = set()
    unique = []
    for gid, nome in groups:
        if gid not in seen:
            seen.add(gid)
            unique.append((gid, nome))
    return unique


def write_txt(groups: list[tuple[str, str]], out: Path) -> None:
    lines = ["#\tNome"]
    lines += [f"{gid}\t{nome}" for gid, nome in groups]
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    logger.info("Escrito %s (%d grupos)", out, len(groups))


def diff_with_previous(groups: list[tuple[str, str]], out: Path) -> None:
    if not out.exists():
        logger.info("Sem lista anterior — primeira geração.")
        return
    old: dict[str, str] = {}
    for line in out.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and re.fullmatch(r"\d{16}", parts[0]):
            old[parts[0]] = parts[1].strip()

    new = {gid: nome for gid, nome in groups}
    added = {k: v for k, v in new.items() if k not in old}
    removed = {k: v for k, v in old.items() if k not in new}

    logger.info("Comparação com a lista anterior: %d antes → %d agora", len(old), len(new))
    if added:
        logger.info("NOVOS (%d):", len(added))
        for gid, nome in sorted(added.items(), key=lambda x: x[1].lower()):
            logger.info("  + %s %s", gid, nome)
    if removed:
        logger.warning("REMOVIDOS (%d):", len(removed))
        for gid, nome in sorted(removed.items(), key=lambda x: x[1].lower()):
            logger.warning("  - %s %s", gid, nome)
    if not added and not removed:
        logger.info("Nenhuma mudança.")


def main():
    parser = argparse.ArgumentParser(description="Gera a lista de grupos de pesquisa a partir do SUAP/IFBA")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="Arquivo de saída (padrão: lista de grupos de pesquisa.txt)")
    parser.add_argument("--url", type=str, default=DEFAULT_URL, help="URL do changelist")
    parser.add_argument("--no-headless", action="store_true", help="Abre o navegador visível (debug)")
    parser.add_argument("--debug", action="store_true", help="Log de debug")
    args = parser.parse_args()

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)

    env = load_env(ROOT / "suap" / ".env")
    user = env.get("SUAP_USER", "")
    password = env.get("SUAP_PASS", "")
    if not user or not password:
        logger.error("SUAP_USER/SUAP_PASS ausentes em suap/.env")
        sys.exit(1)

    driver = None
    try:
        logger.info("Iniciando navegador...")
        driver = setup_driver(headless=not args.no_headless, debug=args.debug)
        driver.implicitly_wait(10)

        if not login(driver, user, password):
            sys.exit(1)

        logger.info("Extraindo grupos de %s", args.url)
        groups = scrape_groups(driver, args.url)
        if not groups:
            logger.error("Nenhum grupo encontrado — a estrutura da página pode ter mudado.")
            sys.exit(1)

        logger.info("Encontrados %d grupos.", len(groups))
        diff_with_previous(groups, args.out)
        write_txt(groups, args.out)
        print(f"\n✓ {len(groups)} grupos escritos em {args.out}")
    except KeyboardInterrupt:
        logger.info("Interrompido pelo usuário.")
        sys.exit(130)
    except Exception as e:
        logger.error("Erro fatal: %s", e, exc_info=args.debug)
        sys.exit(1)
    finally:
        if driver:
            driver.quit()


if __name__ == "__main__":
    main()
