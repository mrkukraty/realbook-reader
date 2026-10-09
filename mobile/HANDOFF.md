# Mobile build handoff

State of the Expo app in `mobile/` and the exact next steps, so any session (Claude Code, Cowork, or you by hand) can continue.

## Verified so far
- `npx tsc --noEmit`: clean
- `npx expo-doctor`: 21/21 checks passed
- `npx jest`: 41/41 tests pass
- `npx expo export --platform android`: Android JS bundle builds
- Not verified: running on a real phone or emulator (none available on the dev machine)

## Next steps: first Android build (installable APK)
Run in `mobile/`:

1. Log in to Expo (approve the code in the browser where you are signed in to expo.dev):
   `npx eas-cli@latest login --device`
2. Link the project to your Expo account (creates the EAS project id in app.json):
   `npx eas-cli@latest init`
3. Start the cloud build (about 10 to 20 minutes; the APK download link appears at the end and on expo.dev):
   `npx eas-cli@latest build --platform android --profile preview`
4. Install the APK on an Android phone from that link (allow "install unknown apps").

## iOS
Requires a paid Apple Developer account. `npx eas-cli@latest build --platform ios --profile preview` runs in the EAS cloud, so no Mac is needed.

## Day-to-day
- `npx expo start`, then open with a development build (the app uses native modules: sqlite, webview, reanimated)
- `npx eas-cli@latest build --profile development --platform android` makes the dev-client APK
