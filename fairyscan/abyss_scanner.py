#!/usr/bin/env python3
"""
abyss_scanner.py (Master Edition)
Ultra-fast concurrent streaming resolver, series batch scraper, and catalog mass-crawler.
"""

from __future__ import annotations

import argparse
import csv
import html as _html_module
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

DEFAULT_OUTPUT = "abyss_scan_report.csv"
REQUEST_TIMEOUT = 20
DEFAULT_WORKERS = 25

FAIRY_FQDN = "fairyanime.net"
FAIRY_ORIGIN = "https://fairyanime.net/"
TONY_FQDN = "streaming.tonytonychopper.com"
TONY_ORIGIN = "https://streaming.tonytonychopper.com/"
MARIMO_HOST = "player.marimo.me"

PLAYBACK_Y_PATH = "/playback/y/"

ABYSS_KEYWORD_RE = re.compile(r"abyss", re.IGNORECASE)
HTTP_URL_RE = re.compile(r"https?://[^\s\"'<>]+")

# Flexible regex for slug/vid extraction
SLUG_COMBINED_RE = re.compile(
    r"(?:var\s+|let\s+|const\s+)?slug\s*=\s*[\"'](?P<slug>[^\"']+)[\"']\s*(?:,\s*"
    r"(?:vid|video_id)\s*=\s*[\"'](?P<vid>[^\"']+)[\"'])?",
    re.IGNORECASE,
)
SLUG_SIMPLE_RE = re.compile(
    r"(?:slug|s)\s*[:=]\s*[\"']([a-zA-Z0-9_-]+)[\"']",
    re.IGNORECASE,
)
MARIMO_DEMO_RE = re.compile(
    r"https?://" + re.escape(MARIMO_HOST) + r"/[^\s\"'<>]+",
    re.IGNORECASE,
)
WATCH_LINK_RE = re.compile(r"/watch/[^\"'?#\s<>]+\.html", re.IGNORECASE)

# Thread safety lock for CSV file writing
_csv_write_lock = threading.Lock()


def build_http_session(cf_clearance: str | None = None, php_sessid: str | None = None) -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,image/apng,*/*;q=0.8"
        ),
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    })
    
    if cf_clearance:
        session.cookies.set("cf_clearance", cf_clearance, domain=".fairyanime.net")
    if php_sessid:
        session.cookies.set("PHPSESSID", php_sessid, domain=".fairyanime.net")
        
    return session


def normalize_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    if not url.startswith("http"):
        url = "https://" + url
    return url


def ensure_http_url(value: str) -> str | None:
    value = (value or "").strip()
    if not value:
        return None
    if not value.startswith("http"):
        value = "https://" + value
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https"):
        return None
    return value


def unescape_html_entities(text: str) -> str:
    return _html_module.unescape(text or "")


def extract_page_title(page_html: str, fallback: str) -> str:
    try:
        soup = BeautifulSoup(page_html, "html.parser")
        tag = soup.find("title")
        if tag and tag.string:
            return tag.string.strip()
    except Exception:
        pass
    return fallback


def fetch_text(
    session: requests.Session,
    url: str,
    *,
    timeout: int = REQUEST_TIMEOUT,
    referer: str | None = None,
    verbose: bool = False,
) -> tuple[int, str]:
    try:
        if referer:
            session.headers["Referer"] = referer
        else:
            session.headers.pop("Referer", None)
    except Exception:
        pass

    if verbose:
        print(f"    [HTTP GET] {url} (Referer: {referer or 'None'})")

    try:
        resp = session.get(url, timeout=timeout, allow_redirects=True)
        status_code = resp.status_code
        text = resp.text or ""
        if verbose:
            print(f"    [HTTP {status_code}] Length: {len(text)} bytes")
        return status_code, text
    except Exception as exc:
        if verbose:
            print(f"    [HTTP ERROR] {exc}")
        return 0, ""


def extract_slug_from_html(page_html: str) -> tuple[str, str]:
    page_html = page_html or ""
    match = SLUG_COMBINED_RE.search(page_html)
    if match:
        slug = match.group("slug")
        vid = match.groupdict().get("vid") or ""
        if slug:
            return slug, vid

    matches = SLUG_SIMPLE_RE.findall(page_html)
    if matches:
        return matches[0], ""

    return "", ""


def build_playback_y_url(slug: str) -> str:
    return TONY_ORIGIN.rstrip("/") + PLAYBACK_Y_PATH + slug + "/"


def extract_marimo_demo_url(y_text: str) -> str:
    raw_text = unescape_html_entities(y_text or "")
    match = MARIMO_DEMO_RE.search(raw_text)
    if not match:
        return ""
    url = ensure_http_url(match.group(0))
    return unescape_html_entities(url) if url else ""


def extract_abyss_url(response_text: str) -> str:
    text = unescape_html_entities(response_text or "")
    for match in HTTP_URL_RE.finditer(text):
        url = ensure_http_url(match.group(0))
        if url and ABYSS_KEYWORD_RE.search(url):
            return url
    return ""


def discover_episode_links(series_url: str, series_html: str, verbose: bool = False) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    try:
        soup = BeautifulSoup(series_html or "", "html.parser")
        tbodies = soup.find_all("tbody")
        for tbody in tbodies:
            for row in tbody.find_all("tr"):
                anchor = row.find("a", href=True)
                if not anchor:
                    continue
                href = anchor["href"]
                if not WATCH_LINK_RE.search(href) and "/watch/" not in href:
                    continue
                absolute = urljoin(series_url, href)
                if absolute in seen:
                    continue
                seen.add(absolute)
                found.append(absolute)
    except Exception as exc:
        if verbose:
            print(f"    [Parser Warning] tbody parsing error: {exc}")

    if not found:
        for match in WATCH_LINK_RE.finditer(series_html or ""):
            absolute = urljoin(series_url, match.group(0))
            if absolute not in seen:
                seen.add(absolute)
                found.append(absolute)
    return found


def discover_series_from_catalog_page(catalog_url: str, catalog_html: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    try:
        soup = BeautifulSoup(catalog_html or "", "html.parser")
        for a in soup.find_all("a", href=True):
            href = a["href"]
            absolute = urljoin(catalog_url, href)
            parsed = urlparse(absolute)
            if parsed.netloc != FAIRY_FQDN:
                continue
            path = parsed.path.strip("/")
            if not path or "page" in path or "category" in path or "genre" in path or "status" in path or "watch" in path or "base" in path:
                continue
            if "/" not in path and absolute not in seen:
                seen.add(absolute)
                found.append(absolute)
    except Exception:
        pass
    return found


CSV_FIELDS = [
    "watch_url",
    "page_title",
    "final_abyss_url",
    "tony_slug",
    "error",
]


def scan_watch_url(
    session: requests.Session,
    watch_url: str,
    *,
    timeout: int = REQUEST_TIMEOUT,
    verbose: bool = False,
) -> dict[str, Any]:
    report: dict[str, Any] = {field: "" for field in CSV_FIELDS}

    watch_url = normalize_url(watch_url)
    if not watch_url:
        report["error"] = "Empty watch URL."
        return report

    report["watch_url"] = watch_url

    try:
        status, page_html = fetch_text(session, watch_url, timeout=timeout, referer=FAIRY_ORIGIN, verbose=verbose)
        if status != 200:
            report["error"] = f"Watch page returned HTTP status {status}"
            return report

        report["page_title"] = extract_page_title(page_html, fallback=watch_url)

        # Transform watch URL to /base/{id}/ URL with mandatory trailing slash
        parsed_url = urlparse(watch_url)
        path_parts = parsed_url.path.strip("/").split("/")
        if "watch" in path_parts:
            idx = path_parts.index("watch")
            if idx + 1 < len(path_parts):
                vid_id = path_parts[idx + 1].replace(".html", "")
                base_url = f"{parsed_url.scheme}://{parsed_url.netloc}/base/{vid_id}/"
            else:
                base_url = watch_url
        else:
            base_url = watch_url

        if verbose:
            print(f"    [Transform] Fetching base URL: {base_url}")

        base_status, base_html = fetch_text(session, base_url, timeout=timeout, referer=watch_url, verbose=verbose)
        if base_status != 200:
            report["error"] = f"Base page returned HTTP status {base_status}"
            return report

        slug, _vid_hint = extract_slug_from_html(base_html)
        if not slug:
            report["error"] = "TonyTonyChopper slug not found in base page HTML."
            return report
        report["tony_slug"] = slug

        y_url = build_playback_y_url(slug)
        y_status, y_text = fetch_text(session, y_url, timeout=timeout, referer=FAIRY_ORIGIN, verbose=verbose)
        if y_status != 200:
            report["error"] = f"TonyTonyChopper endpoint returned HTTP status {y_status}"
            return report

        marimo_url = extract_marimo_demo_url(y_text)
        if not marimo_url:
            report["error"] = "player.marimo.me demo URL not found in /y/ response."
            return report

        m_status, marimo_text = fetch_text(session, marimo_url, timeout=timeout, referer=TONY_ORIGIN, verbose=verbose)
        if m_status != 200:
            report["error"] = f"Marimo endpoint returned HTTP status {m_status}"
            return report

        report["final_abyss_url"] = extract_abyss_url(marimo_text)
        if not report["final_abyss_url"]:
            report["error"] = "No abyss streaming URL found in marimo response."
        return report

    except requests.RequestException as exc:
        report["error"] = f"Request failed: {type(exc).__name__}: {exc}"
        return report
    except Exception as exc:
        report["error"] = f"Unexpected error: {type(exc).__name__}: {exc}"
        return report


def ensure_csv_header(path: str = DEFAULT_OUTPUT) -> None:
    if not os.path.exists(path):
        with open(path, "a", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
            writer.writeheader()


def write_report_row(report: dict[str, Any], path: str = DEFAULT_OUTPUT) -> None:
    file_exists = os.path.exists(path)
    filtered_report = {field: report.get(field, "") for field in CSV_FIELDS}
    with open(path, "a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        if not file_exists:
            writer.writeheader()
        writer.writerow(filtered_report)


def process_single_episode_worker(
    session: requests.Session,
    watch_url: str,
    timeout: int,
    verbose: bool,
) -> dict[str, Any]:
    try:
        return scan_watch_url(session, watch_url, timeout=timeout, verbose=verbose)
    except Exception as exc:
        report = {field: "" for field in CSV_FIELDS}
        report["watch_url"] = watch_url
        report["error"] = f"{type(exc).__name__}: {exc}"
        return report


def run_batch(
    session: requests.Session,
    watch_urls: list[str],
    *,
    timeout: int,
    delay: float,
    output_path: str,
    verbose: bool,
    max_workers: int = DEFAULT_WORKERS,
) -> int:
    ensure_csv_header(output_path)
    resolved = 0
    total = len(watch_urls)

    print(f"\n[+] Starting concurrent batch scan with {max_workers} workers for {total} episodes...")

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_url = {
            executor.submit(process_single_episode_worker, session, url, timeout, verbose): (i, url)
            for i, url in enumerate(watch_urls, start=1)
        }

        completed_count = 0
        for future in as_completed(future_to_url):
            _idx, watch_url = future_to_url[future]
            completed_count += 1
            try:
                report = future.result()
            except Exception as exc:
                report = {field: "" for field in CSV_FIELDS}
                report["watch_url"] = watch_url
                report["error"] = f"Thread exception: {exc}"

            with _csv_write_lock:
                write_report_row(report, path=output_path)

            status_indicator = "SUCCESS" if report.get("final_abyss_url") else "FAILED"
            print(f"[{completed_count}/{total}] ({status_indicator}) {watch_url}")
            if report.get("page_title"):
                print(f"  -> Title:  {report.get('page_title')}")
            if report.get("final_abyss_url"):
                print(f"  -> Abyss:  {report.get('final_abyss_url')}")
                resolved += 1
            if report.get("error"):
                print(f"  -> Error:  {report['error']}")

            if delay > 0:
                time.sleep(delay)

    return resolved


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Direct streaming resolver + concurrent catalog mass-scraper.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("-u", "--url", action="append", help="Watch URL (repeatable).")
    group.add_argument("-s", "--series", action="append", help="Series directory URL (repeatable).")
    group.add_argument("-c", "--catalog", action="append", help="Catalog pagination URL (e.g., https://fairyanime.net/page/1/).")
    group.add_argument("-f", "--file", help="Text file with URLs.")
    
    parser.add_argument("--cf-clearance", help="Cloudflare cf_clearance cookie value.")
    parser.add_argument("--php-sessid", help="PHPSESSID cookie value.")
    parser.add_argument("--timeout", type=int, default=REQUEST_TIMEOUT, help="Request timeout.")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="Number of concurrent worker threads.")
    parser.add_argument("--delay", type=float, default=0.0, help="Optional delay per thread.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Output CSV path.")
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable verbose HTTP debugging.")
    return parser


def run_cli(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    session = build_http_session(cf_clearance=args.cf_clearance, php_sessid=args.php_sessid)

    watch_urls: list[str] = []
    series_urls: list[str] = []
    catalog_urls: list[str] = []

    if args.url:
        watch_urls = [u.strip() for u in args.url if u.strip()]
    elif args.series:
        series_urls = [u.strip() for u in args.series if u.strip()]
    elif args.catalog:
        catalog_urls = [u.strip() for u in args.catalog if u.strip()]
    elif args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                if "/watch/" in line:
                    watch_urls.append(line)
                elif "page/" in line:
                    catalog_urls.append(line)
                else:
                    series_urls.append(line)

    for cat_url in catalog_urls:
        print(f"[catalog] Crawling catalog page: {cat_url}")
        status, html_content = fetch_text(session, cat_url, timeout=args.timeout, referer=FAIRY_ORIGIN, verbose=args.verbose)
        if status != 200:
            print(f"  [Error] Catalog page returned HTTP {status}")
            continue
        discovered_series = discover_series_from_catalog_page(cat_url, html_content)
        print(f"  -> Discovered {len(discovered_series)} series directory link(s).")
        for s_url in discovered_series:
            if s_url not in series_urls:
                series_urls.append(s_url)

    for s_url in series_urls:
        print(f"[series] Fetching directory: {s_url}")
        status, html_content = fetch_text(session, s_url, timeout=args.timeout, referer=FAIRY_ORIGIN, verbose=args.verbose)
        if status != 200:
            print(f"  [Error] Series page returned HTTP {status}")
            continue
        discovered_eps = discover_episode_links(s_url, html_content, verbose=args.verbose)
        print(f"  -> Discovered {len(discovered_eps)} episode(s) from `<tbody>` rows.")
        for ep in discovered_eps:
            if ep not in watch_urls:
                watch_urls.append(ep)

    if not watch_urls:
        print("No valid watch URLs to process.", file=sys.stderr)
        return 1

    resolved = run_batch(
        session,
        watch_urls,
        timeout=args.timeout,
        delay=args.delay,
        output_path=args.output,
        verbose=args.verbose,
        max_workers=args.workers,
    )

    print(f"\nCompleted: {resolved}/{len(watch_urls)} resolved. Saved to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(run_cli())