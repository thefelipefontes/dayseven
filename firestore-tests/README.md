# Firestore rules and Cloud Function tests

Emulator tests for:

- `firestore.rules` (transitional) and `firestore.strict.rules`. Every case runs against both files.
- The Cloud Function triggers and the RevenueCat webhook (functions + auth emulators).
- The hourly scheduled jobs. They run in-process, with FCM stubbed and the clock shifted.
- Trigger and callable handlers (push limits, milestones, account deletion), in-process with FCM and Storage stubbed.
- The webhook's event mapping and the week rule (functions/weekRule.js), as plain unit tests.

## Run

You need Java for the Firestore emulator. Run the Firebase CLI under Node 20.

```bash
cd firestore-tests && npm install && PATH=/opt/homebrew/opt/node@20/bin:/opt/homebrew/opt/openjdk@21/bin:$PATH npm test
```

`npm test` writes `functions/.secret.local` if it's missing. That file is gitignored and holds a dummy webhook secret for the emulator. Everything runs against `demo-*` projects, so nothing reaches production.

## Two rule files

`firestore.rules` is what `firebase deploy` uses. Its TRANSITIONAL blocks keep app versions up to 1.8.3 working. Those versions read non-friends' user docs, list friend requests, and write friend docs one at a time.

`firestore.strict.rules` is the target state. Copy it over `firestore.rules` once almost every user runs a build with the new friend and profile reads.

Keep the two files identical outside the TRANSITIONAL blocks.
