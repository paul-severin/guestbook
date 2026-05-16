# Guestbook Webapp

## GitHub Storage Implementation

### Hosting
Single static webapp hosted on GitHub Pages (from the `guestbook-data` repo itself).

### Architecture
- Single combined webapp: shows entry list + button to add new entry
- No backend/proxy — GitHub API called directly from browser JS
- GitHub fine-grained token scoped to the `guestbook-data` repo, Contents read+write only

### Storage Structure
Dedicated repo: `guestbook-data`

- One JSON file per entry: `entries/2026-03-22-anna.json`
- Multiple images per entry: `images/2026-03-22-anna-1.jpg`, `images/2026-03-22-anna-2.jpg`, etc.

### Reading
- List entries via GitHub API directory listing of `entries/`
- Fetch individual entry JSON lazily when user expands an entry
- Images loaded via API as blob URLs (repo is private — raw GitHub URLs require auth)
- Use auth token on all API calls to avoid rate limits

### Writing
- Single submission flow: write all files (entry JSON + images) as independent commits
- **Images must be uploaded sequentially, not in parallel** — concurrent writes to the same GitHub repo cause 409 conflicts
- Compress and resize images client-side via Canvas API before upload (target <200KB, max 800px wide)
- Multiple images allowed per entry

### Entry ID Format
`YYYY-MM-DD-{name-slug}-{4-char-random}` e.g. `2026-03-22-anna-ab12`
- Random suffix prevents collisions when same name is submitted multiple times on the same day

### Spam Protection
Honeypot hidden field to deter bots

---

## Tech Stack
- **Pure static HTML/JS/CSS** — no build tools, no frameworks, no npm
- **3 pages:** `index.html` (list), `form.html` (new entry), `entry.html` (read-only detail)
- **Shared styles:** `style.css` across all three pages
- **Storage abstraction:** `storage.js` — `GuestbookStorage` base class + `GitHubStorage` implementation. Swap the class to change backend.

## Access Token
- **Production (Pages):** token is NOT baked into the deployed site. Users open the app via a per-share URL with `#token=<github_pat>` in the hash fragment. `auth.js` reads the hash on load, persists the token in `sessionStorage` (per-tab), and strips the hash from the URL bar. Closing the tab clears the token.
- **Local dev:** `config.local.js` (gitignored) sets `window.GUESTBOOK_TOKEN/OWNER/REPO` directly so the app works without a share-link.
- **Deploy workflow:** only `GUESTBOOK_OWNER` and `GUESTBOOK_REPO` are `sed`-injected into the HTML. The `GUESTBOOK_TOKEN` GH Actions secret is no longer used by the workflow.
- **Locked screen:** if no token is present, `gbRequireToken()` (in `auth.js`) replaces the page with a "Zugang erforderlich" message and halts page init.

---

## Design
- **Aesthetic:** Botanical / handwritten — warm cream background, elegant and organic, inspired by printed wedding guestbook style
- **Fonts:**
  - `Dancing Script` — section titles, page header, entry names
  - `Lato` — UI labels, metadata, buttons
  - `Caveat` — user-typed input text and read-only display of entry content
- **Color palette** (CSS variables in `style.css`):
  - `--cream: #f7f3ec` — page background
  - `--green-dark: #4a6741` — primary color (headings, buttons, checkmarks)
  - `--green: #7a9e7e` — hover states
  - `--gold-light: #d4af37` — decorative accents, dividers
  - `--border: #c8bfad` — card borders, input lines
  - `--text-light: #7a6f63` — secondary text
- **Checkboxes/radios:** Custom styled with handwritten SVG checkmark (`positive-check-mark.svg`) in `--green-dark`
- **UI feel — analog, not digital:** Every interactive element should feel like it belongs in a printed book or on paper, not in a web app. Avoid pill buttons, rounded rectangles, filled backgrounds, drop shadows, and other hallmarks of modern digital UI. Prefer underlines, subtle borders, ink-like text treatments, and typographic emphasis. Interactions should feel like turning a page or writing with a pen, not clicking a button.
