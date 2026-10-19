<p align="center">
  <img src="https://i.8upload.com/image/13378d302634f790/favicon-5.png" alt="Fairyscan Logo" width="128" height="128">
</p>

# Fairyscan

# What is it?

Fairyscan is a high-performance concurrent mass-scraper built to extract direct streaming links from [Fairyanime.net](https://fairyanime.net).

# Key Features

- **Multi-Threaded**: 25-worker concurrent engine for fast extraction.
- **Catalog & Series Scraping**: Crawls pagination pages (`-c`) and series batch folders (`-s`).
- **Automated CSV Sorting**: In-place grouping by series name with numerical episode order.

# Why fairyanime?

Fairyanime hosts an extensive anime catalog utilizing specialized media players. Fairyscan is tailored specifically to harvest these Thai sub and dub streaming sources[: 3].
Especially the one from hydrax. aka, abyss

## Organizing scan reports

Run `python report_organize.py` to sort `abyss_scan_report.csv` next to the script,
regardless of the current working directory. It sorts reports with or without the
standard header and restores the header when writing. To sort another report, pass
its path with `python report_organize.py --file path\to\report.csv`.
