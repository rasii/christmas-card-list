# Christmas Card List

An address book of the families we send Christmas cards to, get them from,
and make Chex mix for. It replaces the old Windows program (kept, unpublished,
in `legacy/`).

- Look up an address or phone number. Tapping a family shows it to read
  (copy the address, open it in Maps, call or text); changes are only made
  through Edit, so nothing gets changed by accident.
- Tick who gets a Christmas card, Chex, or an announcement, and keep the
  years each was sent, received and given.
- Each Christmas (the gift button, "This Christmas"): save the mail-merge
  file for address labels, print the Chex checklist, and mark the year as
  sent for everyone ticked.
- On a computer, "All columns" shows the full table the Windows program had.

Runs entirely in the browser. The list stays on the device unless Sync is
turned on (⋯ › Sync), which keeps it the same on the phone and the computer
through a small sync server of your own on Cloudflare (free tier; see
[worker/README.md](worker/README.md)). Works on an iPhone saved to the home
screen (Share › Add to Home Screen) and in any modern browser; Chrome and
Edge can install it as an app from the address bar.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page markup: the list, the edit form, the menu and the other dialogs |
| `app.css` | Styles (cards on a phone, a table on a computer, and the printed pages) |
| `app.js` | The app: the list on screen, search and filters, add / edit / delete, exports, printing, import, backup, the Sync screen |
| `data.js` | What a family record is, and the plain functions on records: years, names, the old program's XML, the mail-merge CSV, merging two copies of the list |
| `store.js` | IndexedDB key/value store: the list and the sync settings |
| `sync.js` | Sync: reads the list from the sync server, merges family by family (newest change wins, deletions kept), writes it back |
| `worker/worker.js` | The sync server (a Cloudflare Worker with one R2 bucket): accounts, sync codes, one list per account |
| `festive.js` | On opening: snowflakes down the screen (can be turned off in the menu). It can also play a few seconds of a carol from its notes, but that is switched off for now |
| `sw.js` | Service worker: the app opens from its cache (at once, and offline); a new version installs in the background |
| `version.js` | Version string shown in the menu; bump it on every release (it also names the offline cache) |
| `manifest.webmanifest`, `apple-touch-icon.png`, `icon-*.png` | Home-screen name and icons |
| `tree.png` | The tree in the header: the Windows program's icon, pixel for pixel |

## The data

`legacy/` holds the old program and the real list. It is in `.gitignore`
because it has names and home addresses: never commit it. To bring the old
list in, use ⋯ › Import from the Windows program… and pick `Krista_list.xml`.
Importing the same file again adds nothing twice.

⋯ › Save a backup file writes the whole list as JSON; Restore puts the list
back exactly as it was in that file.

## Developing

Serve the folder over HTTP (IndexedDB and the service worker don't work from
`file://`), for example:

```bash
py -3 -m http.server 8766
```

then open <http://localhost:8766/>.
