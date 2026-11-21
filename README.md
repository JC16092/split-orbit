# Split Orbit

A two-person web app: split shared expenses evenly (AUD) and run house duties
on a rotating rota. Everything syncs live between both people's devices.

- **Frontend:** one static page, no build step (vanilla JS + Firebase SDK from CDN)
- **Backend:** Firebase — Firestore (realtime database) + Authentication (Google)
- **Hosting:** Firebase Hosting → a permanent `https://<project>.web.app` URL
- **Installable:** PWA — "Add to Home Screen" on phone, works offline for reading

---

## Is it really free?

Yes. This runs entirely on Firebase's **Spark plan (free, no credit card)**:

| Resource            | Free allowance / day | Two people use roughly |
|---------------------|----------------------|------------------------|
| Firestore reads     | 50,000               | 200–1,000              |
| Firestore writes    | 20,000               | 20–100                 |
| Firestore storage   | 1 GiB                | < 1 MB                 |
| Hosting transfer    | 360 MB/day, 10 GB stored | tiny               |
| Authentication      | unlimited            | —                      |

You will not get near the limits. Firebase only asks for a card if you
*manually* upgrade to the paid "Blaze" plan — don't, you don't need it.
The free project **never sleeps** and has no expiry.

---

## One-time setup (~10 minutes)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. **Add project** → name it `split-orbit` (or anything) → Continue.
3. Google Analytics: **turn it off** (not needed) → **Create project**.

### 2. Enable Firestore
1. Left sidebar → **Build → Firestore Database** → **Create database**.
2. Choose **Start in production mode** → Next.
3. Location: pick the closest — for Australia, `australia-southeast1` (Sydney). → **Enable**.

### 3. Enable Google sign-in
1. Left sidebar → **Build → Authentication** → **Get started**.
2. **Sign-in method** tab → **Google** → toggle **Enable**.
3. Pick a support email (your own) → **Save**.

### 4. Get your web config
1. Top-left gear → **Project settings** → **General** tab.
2. Scroll to **Your apps** → click the **`</>`** (web) icon.
3. App nickname: `split-orbit` → **Register app** (skip "Firebase Hosting" checkbox here) → Continue to console.
4. Back in **Project settings → General → Your apps**, under **SDK setup and configuration**, select **Config**. You'll see:
   ```js
   const firebaseConfig = {
     apiKey: "AIza…",
     authDomain: "split-orbit-xxxx.firebaseapp.com",
     projectId: "split-orbit-xxxx",
     …
   };
   ```
5. Copy that object into **[`public/firebase-config.js`](public/firebase-config.js)**, replacing the placeholder.

### 5. Lock it to your two accounts
1. Open **[`firestore.rules`](firestore.rules)** and put both Gmail addresses in the list
   (lowercase — yours and your partner's).
2. Open **[`.firebaserc`](.firebaserc)** and set `"default"` to your **projectId**
   (the `split-orbit-xxxx` value from step 4).

### 6. Deploy
Install the CLI once, then deploy:
```bash
npm install -g firebase-tools
firebase login
cd split-orbit
firebase deploy
```
The last line of the output is your live URL: `https://<projectId>.web.app`.

Every future change: edit files, run `firebase deploy` again.

---

## First run

1. Open the URL, **Continue with Google**, sign in as yourself.
2. Fill in the deck name and both names. You can leave your partner's email
   blank — they'll claim their spot automatically the first time they sign in
   (their email still has to be in `firestore.rules`).
3. Send your partner the same URL. They sign in with their Google account and
   land straight on the shared deck.
4. On a phone: browser menu → **Add to Home Screen**.

---

## How things work

Four tabs: **Home** (balance + spending breakdown + today), **Money** (expenses),
**Chores** (weekly roster), **History** (settled + recurring + deleted). Settings
is the gear in the header.

- **Money** — each expense has a category, who paid, and who it was for
  (`both` = 50/50, or all on one person). Each outstanding expense has an
  **I paid my share / Mark received** button; settling it moves it to History.
  **Settle up** on Home clears the whole balance at once. Undo/redo in the header;
  deleted expenses sit in **Recently deleted** for 28 days.
- **Chores** — each duty is **fixed** to one person or **alternates weekly**.
  Tap a day cell or the **Mark done** button. The header shows done/due counts
  for the week.
- **Recurring bills** (History tab) — rent, internet, subscriptions auto-post on
  a chosen day each month, next time either of you opens the app.
- **Live sync** — every open device updates within ~1s (Firestore `onSnapshot`).
  Whatever one person changes shows on the other's screen while the app is open.
  (No push notifications — deliberately kept out.)

## Files

```
firebase.json          hosting + firestore config
firestore.rules        access control — YOUR TWO EMAILS go here
.firebaserc            your project id
public/
  index.html           app shell
  styles.css           all styling
  app.js               all logic (auth, Firestore, UI)
  firebase-config.js   YOUR FIREBASE KEYS go here
  manifest.webmanifest PWA manifest
  icon.svg             app icon
  sw.js                offline shell service worker
```

Firestore collections: `config/household`, `expenses`, `settlements`,
`duties`, `recurring`.

## Optional: custom domain

Firebase Hosting → **Add custom domain** → follow the DNS steps. Still free.

## Optional: bump the Firebase SDK version

The version is pinned in `public/app.js` (`.../firebasejs/10.14.1/...`).
To update, change all four import URLs to the same newer version number.

## Setup (Firebase)

This app uses Firebase (Google Auth + Firestore). To run your own copy:

1. Create a free Firebase project.
2. In `public/firebase-config.js`, replace the `YOUR_*` placeholders with your
   web app config, and set `OWNER_EMAIL` to the Google account allowed to sign in.
3. Update the email in `firestore.rules` to match.
4. Deploy: `firebase deploy`.

## License

[MIT](LICENSE)
