#!/usr/bin/env python3
"""
organize_report.py (In-Place Sorting)
Sorts and organizes the CSV report in-place, grouped by series and episode order.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from typing import Any

DEFAULT_INPUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "abyss_scan_report.csv")
CSV_FIELDS = ("watch_url", "page_title", "final_abyss_url", "tony_slug", "error")

EPISODE_NUM_RE = re.compile(r"(?:ตอนที่|ep(?:isode)?\.?)\s*0*(\d+)", re.IGNORECASE)


def extract_series_and_episode(page_title: str | None) -> tuple[str, int]:
    title = (page_title or "").strip()

    ep_match = EPISODE_NUM_RE.search(title)
    ep_num = int(ep_match.group(1)) if ep_match else 0

    series_name = EPISODE_NUM_RE.sub("", title, count=1)
    series_name = re.sub(r"(?<!\w)\d+\s*[-–—]\s*\d+(?!\w)", "", series_name)
    for suffix in ("fairyanime", "แฟรี่อนิเมะ", "แฟร์รี่อนิเมะ", "พากย์ไทย", "ซับไทย"):
        series_name = re.sub(re.escape(suffix), "", series_name, flags=re.IGNORECASE)

    series_name = re.sub(r"\s*-\s*$", "", series_name).strip().casefold()
    return series_name, ep_num


def sort_key(row: dict[str, Any]) -> tuple[str, int, str]:
    page_title = row.get("page_title") or ""
    series_key, ep_num = extract_series_and_episode(page_title)
    return (series_key, ep_num, page_title.casefold())


def organize_csv_inplace(file_path: str) -> bool:
    if not os.path.exists(file_path):
        print(f"[Error] File '{file_path}' not found.", file=sys.stderr)
        return False

    rows: list[dict[str, str]] = []
    fieldnames: list[str] = []

    with open(file_path, "r", encoding="utf-8", newline="") as f:
        first_row = next(csv.reader(f), None)
        if first_row is None:
            print("[Warning] CSV file is empty.")
            return True

        has_header = "page_title" in first_row
        is_headerless_report = (
            len(first_row) == len(CSV_FIELDS)
            and first_row[0].strip().casefold().startswith(("http://", "https://"))
        )
        if has_header:
            fieldnames = first_row
            f.seek(0)
            reader = csv.DictReader(f)
        elif is_headerless_report:
            fieldnames = list(CSV_FIELDS)
            f.seek(0)
            reader = csv.DictReader(f, fieldnames=fieldnames)
        else:
            print("[Error] CSV is missing the required 'page_title' column.", file=sys.stderr)
            return False

        for row in reader:
            rows.append(row)

    sorted_rows = sorted(rows, key=sort_key)

    # Overwrite the original file directly
    with open(file_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(sorted_rows)

    print(f"[Success] Organized and updated '{file_path}' in-place ({len(sorted_rows)} rows sorted).")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Organize and sort Abyss scan CSV reports in-place."
    )
    parser.add_argument(
        "-f",
        "--file",
        default=DEFAULT_INPUT,
        help="CSV file path to sort in-place (defaults to abyss_scan_report.csv beside this script).",
    )
    args = parser.parse_args()

    return 0 if organize_csv_inplace(args.file) else 1


if __name__ == "__main__":
    raise SystemExit(main())