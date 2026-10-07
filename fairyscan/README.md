<p align="center">
  <img src="https://i.8upload.com/image/13378d302634f790/favicon-5.png" alt="Fairyscan Logo" width="128" height="128">
</p>

# Fairyscan

# What is it?

Fairyscan is a high-performance concurrent mass-scraper built to extract direct streaming links from [Fairyanime.net](https://fairyanime.net).

# Key Features

- **Multi-Threaded**: 25-worker concurrent engine for fast extraction.
- **Catalog & Series Scraping**: Crawls pagination pages (`-c`) and series batch folders (`-s`).
- **Automated CSV Sorting**: In-place grouping by series name with natural episode numerical order.

# Why fairyanime?

Fairyanime hosts an extensive anime catalog utilizing specialized media players. Fairyscan is tailored specifically to harvest these Thai sub and dub streaming sources[: 3].
Especially the one from hydrax. aka, abyss

## Known issue

`report_organize.py` is currently broken and should not be relied on to organize scan reports.
