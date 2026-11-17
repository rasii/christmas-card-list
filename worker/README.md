# Christmas Card List sync server

A Cloudflare Worker (`worker.js`) plus one R2 storage bucket. It keeps the
list so it can be opened on the phone and the computer. The app does the
merging; the Worker stores one file per account and checks sync codes.
Everything is set up in Cloudflare's website, with nothing to install.

Cost: Cloudflare's free tier. The whole list is about 100 KB.

## Codes

- **Invite code**: you choose it. Anyone who has it can create a sync
  account (Sync › New account). It shows nobody's list. Change it at any
  time; existing accounts keep working.
- **Sync code**: made by the server when the account is created. It opens
  that account's list and nothing else. Enter it once on each device. Anyone
  with this code can read and change the list, so keep it private.

Use a long, random invite code, for example from a password manager.
Letters and digits only: it's compared ignoring case, spaces and
punctuation, so those add nothing.

## Setting it up (about 10 minutes)

1. **Account.** Sign in at <https://dash.cloudflare.com>.
2. **Storage.** Open **R2 Object Storage**, click **Create bucket**, name it
   `card-list-sync`, keep the other settings, and click **Create bucket**.
3. **The Worker.**
   1. Open **Workers & Pages** (under Compute), click **Create**, choose
      **Start with Hello World!**, and name it `card-list-sync`.
   2. Click **Deploy**, then **Edit code**.
   3. Delete everything in the editor, paste in the whole of `worker.js`,
      and click **Deploy**.
4. **Connect the storage.** In the Worker, open **Settings › Bindings ›
   Add › R2 bucket**. Set the variable name to `BUCKET` (exactly), choose
   `card-list-sync`, and click **Deploy**.
5. **Secret.** In **Settings › Variables and Secrets**, click **Add**, set
   the type to **Secret**, and add `INVITE_CODE` with your invite code.
   Click **Deploy**.
6. **Check it works.** The Worker's address is shown at the top of its page,
   e.g. `https://card-list-sync.yourname.workers.dev`. Opening it in a
   browser should show `{"app":"card-list-sync","ok":true}`.
7. **Make it the app's default.** Put the address in `DEFAULT_URL` at the
   top of `sync.js`. Then nobody has to type it. Until then, enter it in the
   Sync screen's "Sync server" box.

If the app is hosted anywhere other than `https://rasii.github.io`, add that
address to `ORIGINS` at the top of `worker.js`.

## In the app

- **First device** (the one that has the list): ⋯ › Sync › New account.
  Enter a name and the invite code, then Turn on sync. The sync code is
  shown; keep it somewhere safe.
- **Other devices:** ⋯ › Sync › I have a sync code. Enter it and Turn on
  sync. The list appears.

## Changing things later

- **New invite code:** Worker › Settings › Variables and Secrets, edit
  `INVITE_CODE`.
- **Turn an account off:** in the R2 bucket, open `accounts/<id>.json` and
  set `"disabled": true`.
- **Updates to `worker.js`:** paste the new version in Edit code and Deploy.
  The stored list is kept.
