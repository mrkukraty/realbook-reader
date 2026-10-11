# Login and book sync (parked)

Optional accounts for the mobile app: email sign-in that copies a person's books and reading positions to
their private space so they can be downloaded on other devices. It was removed from the app and parked here.
Nothing in this folder is built, bundled or tested by the app.

It was never run against a real server. Typecheck, unit tests and bundling passed when it was removed.

## What is here

| Path | What it is |
|---|---|
| `login-feature.patch` | The whole change as one patch, including the small edits to existing files |
| `mobile/src/app/account.tsx` | Account screen: sign in, create account, sync, download, remove |
| `mobile/src/state/account-store.ts` | Sign-in state and the sync, download and remove actions |
| `mobile/src/cloud/client.ts` | Supabase client; the session is kept in the app's own database |
| `mobile/src/cloud/sync-logic.ts` | Pure sync decisions (what to upload, which reading position wins) |
| `mobile/__tests__/cloud-sync.test.ts` | Unit tests for the sync decisions |
| `mobile/supabase/schema.sql` | Table, private bucket and per-user access rules to run in Supabase |
| `mobile/.env.example` | The two settings the app needs |

The files are copies kept for reading. The patch is what restores the feature, because it also carries the
edits to `_layout.tsx`, `index.tsx`, `settings.tsx` and `package.json`.

## Bringing it back

From the repository root:

```
git apply archive/login-feature/login-feature.patch
cd mobile
npm install
npx tsc --noEmit
npx jest
```

If the patch no longer applies because the app has changed, use `git apply --3way`, or copy the files from
`mobile/` here into the same paths under the real `mobile/` and redo the three small edits by hand:

- `src/app/_layout.tsx`: register the `account` screen and call `useAccount.getState().init()` after the library loads
- `src/app/index.tsx`: add the Account button to the library header
- `package.json`: add `@supabase/supabase-js` with `npx expo install @supabase/supabase-js`

Then set up the server:

1. Create a project at https://supabase.com.
2. Run `mobile/supabase/schema.sql` in its SQL editor.
3. Copy `mobile/.env.example` to `mobile/.env` and fill in the project URL and publishable key.

## Known gaps

- No password reset
- Bookmarks, highlights and notes do not sync
- Books over 50 MB stay on the device
- Mobile app only; the web app has no login
