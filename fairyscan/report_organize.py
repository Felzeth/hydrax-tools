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
from typing import Any

DEFAULT_INPUT = "abyss_scan_report.csv"

EPISODE_NUM_RE = re.compile(r"(?:ตอนที่|ep(?:isode)?\.?)\s*0*(\d+)", re.IGNORECASE)
NUMBER_RE = re.compile(r"(\d+)")


def extract_series_and_episode(page_title: str) -> tuple[str, int]:
    title = (page_title or "").strip()
    
    ep_num = 0
    ep_match = EPISODE_NUM_RE.search(title)
    if ep_match:
        try:
            ep_num = int(ep_match.group(1))
        except ValueError:
            pass
    
    if ep_num == 0:
        all_nums = NUMBER_RE.findall(title)
        if all_nums:
            try:
                ep_num = int(all_nums[-1])
            except ValueError:
                pass

    series_name = EPISODE_NUM_RE.sub("", title)
    for suffix in ["- fairyanime", "แฟร์รี่อนิเมะ", "พากย์ไทย", "ซับไทย"]:
        series_name = series_name.replace(suffix, "")
    
    series_name = re.sub(r"\s*-\s*$", "", series_name).strip().lower()
    return series_name, ep_num


def sort_key(row: dict[str, Any]) -> tuple[str, int, str]:
    page_title = row.get("page_title") or ""
    series_key, ep_num = extract_series_and_episode(page_title)
    return (series_key, ep_num, page_title)


def organize_csv_inplace(file_path: str) -> None:
    if not os.path.exists(file_path):
        print(f"[Error] File '{file_path}' not found.", file=sys.stderr)
        return

    rows: list[dict[str, str]] = []
    fieldnames: list[str] = []

    with open(file_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames:
            fieldnames = list(reader.fieldnames)
        for row in reader:
            rows.append(row)

    if not rows:
        print("[Warning] CSV file is empty.")
        return

    sorted_rows = sorted(rows, key=sort_key)

    # Overwrite the original file directly
    with open(file_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(sorted_rows)

    print(f"[Success] Organized and updated '{file_path}' in-place ({len(sorted_rows)} rows sorted).")


def main() -> int:
    parser = argparse.ArgumentParser(description="Organize and sort Abyss scan CSV reports in-place.")
    parser.add_argument("-f", "--file", default=DEFAULT_INPUT, help="CSV file path to sort in-place.")
    args = parser.parse_args()

    organize_csv_inplace(args.file)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())