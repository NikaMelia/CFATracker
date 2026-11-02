# CFA Study Tracker

A simple study tracker for the CFA exam, built from the original Excel tracker (`Tracker 1.xlsx`).
It's plain HTML/CSS/JS: no install and no build step. Open `index.html` in a browser.
Optional username/password accounts with per-user cloud sync via Supabase: see below.

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

## Login & sync setup (Supabase, free)

Without setup the app runs in **local mode**: no login, data stays in the browser.
With Supabase, people **register themselves with a username and password** and each gets their **own private tracker**, synced across devices.

1. Create a free account at https://supabase.com, then click **New project** (any name, pick a region close to you).
2. **SQL Editor → New query**: paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. **Authentication → Sign In / Providers**:
   - Keep **"Allow new users to sign up"** ON.
   - Under **Email**, turn **OFF "Confirm email"**. This is required: usernames have no real inbox.
4. **Project Settings → API Keys**: copy the **Project URL** and the **publishable** key (or the legacy **anon public** key) into [`config.js`](config.js). Commit and push.

How usernames work: Supabase Auth needs an email, so the app stores username `anna` as `anna@nikamelia.github.io`
(set by `usernameDomain` in `config.js`). Nothing is ever emailed. In the Supabase dashboard (Authentication → Users) you'll see users listed that way.

The publishable/anon key is designed to be public. Row Level Security in `schema.sql` ensures each user can read and write only their own data.
Never put the **secret / service_role** key in this repo.

Note: with sign-ups on, anyone who finds the site can create an account. They only ever see their own empty tracker.

**Resetting a forgotten password** (there's no email to send a reset link to): in Supabase **SQL Editor** run
```sql
update auth.users
set encrypted_password = crypt('NewPassword123', gen_salt('bf'))
where email = 'anna@nikamelia.github.io';
```
They can then sign in and change it under Settings → Account.

On first sign-in a new user gets an empty tracker with the full curriculum. If that browser already had local data (from before login existed), the app offers to upload it.
Settings also has **Load Excel data** (the original spreadsheet's scores) and **Start over (blank)**.

## Data

- Cloud mode: saved automatically to your account (status shown at top right). Coming back to the tab picks up changes made on another device.
- Local mode: saved in the browser (`localStorage`) only.
- **Settings → Export backup** downloads a JSON copy of your data; **Import backup** loads one.
- To re-import an updated Excel file:
  ```bash
  pip install openpyxl
  python scripts/import_excel.py "Tracker 1.xlsx" seed.js
  ```
  Then use **Load Excel data** in Settings.

## Hosting

GitHub Pages: repo Settings → Pages → Deploy from branch → `main` / root.

`vendor/supabase-2.118.0.js` is the official `@supabase/supabase-js` browser build (MIT, see `vendor/supabase-LICENSE`), bundled so the app needs no CDN.
