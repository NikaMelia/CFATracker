# CFA Study Tracker

A simple study tracker for the CFA exam, built from the original Excel tracker (`Tracker 1.xlsx`).
It's plain HTML/CSS/JS: no install and no build step. Open `index.html` in a browser.

## What it does (Excel sheet → app tab)

| Excel | App |
|---|---|
| **Hours Tracker**: exam date, hours done/left (300 h goal), days left/gone, hours per topic | **Dashboard** KPIs + **Study hours** tab (log date / hours / topic / note, totals by topic, hours-per-week chart) |
| **Topics Tracker**: per-reading date and score (correct/total), topic totals, weighted grade, exam weights, readings done, conspect status, hours per reading | **First pass** tab + **Dashboard** topic table (conspect status is editable there) |
| **Revision**: same layout for the second pass, incl. sub-items (Ethics Reading 91 split by Standard, Schweser / CFA website questions) and notes like "Durations only" | **Revision** tab. Extra items and sub-items can be added under any topic or reading |

Extras over the spreadsheet:
- Add more passes (e.g. "Revision 2", "Mock exams"), each with its own tab (Settings → Practice passes).
- "Weakest readings" list, grade bars per topic (first pass vs revision), colour-coded scores (≥80% green, 70–80% amber, <70% red).
- Editable curriculum and exam weights, so the tracker can be reused for Level II/III.
- Works on phone and desktop, with light and dark mode.

Grades match the Excel formulas: topic grade = Σcorrect / Σtotal; weighted grade = Σ(weight × topic grade) over the topics that have scores.

## Data

- Data is saved in the browser (`localStorage`). It isn't synced between devices.
- **Settings → Export backup** downloads a JSON file. **Import backup** loads it on another device or browser. Export regularly.
- **Settings → Reset to Excel data** restores the data imported from the spreadsheet.
- To re-import an updated Excel file:
  ```bash
  pip install openpyxl
  python scripts/import_excel.py "Tracker 1.xlsx" seed.js
  ```
  Then use "Reset to Excel data" (or clear site data) in the browser.

## Hosting (optional)

Enable **GitHub Pages** (repo Settings → Pages → Deploy from branch → `main` / root) to get a URL she can open anywhere.
Each device keeps its own data, so use Export/Import to move between them.
