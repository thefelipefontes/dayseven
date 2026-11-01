# Moving activities out of the user doc

Status: plan only. Nothing has been migrated or deployed. Written 2026-11-01, while 1.8.5 was being shipped.

## In short

- **The 1 MiB wall is far away.** The biggest user doc is 108 KB (324 activities). At that user's current pace of about 30 workouts a month, it reaches 1 MiB in about 8 years. Nobody else is close. An average activity takes 305 bytes, so 1 MiB holds about 3,200 activities, not 2,000–2,500.
- **The real cost is how often the whole history is moved around.** It isn't how big the history is.
  - A cold start reads the whole user doc 7 times.
  - Every save reads and rewrites the whole history.
  - The challenge-stats listener downloads the whole doc again after every write to it.
  - The feed and leaderboard read each friend's whole doc. The leaderboard reads it 3 times per friend.
  - The precondition on every phone and Watch save conflicts with *any* write to the user doc: badge counts, streaks, goals, server counters.
- **Recommendation:**
  1. Do **Phase 0 in 1.8.6**. It removes most of the repeated reads without touching the data model.
  2. Then move activities into **one doc per week**: `users/{uid}/activityWeeks/{weekKey}`, holding the same array shape as today. Do this as 1.9.0, behind a per-user switch. Two server-side mirrors keep older phone and Watch builds working.
  3. Delete the old array only once version stamps show no one is left on a pre-1.9.0 build.

## 1. Measured numbers

Measured on 2026-11-01 against production with `functions/scripts/activityStorageStats.js` (new, read-only, counts and sizes only, no identifiers). Sizes use Firestore's documented storage-size formula. The two `demoMode` docs are excluded.

| | |
|---|---|
| User docs | 148 (107 with at least one activity) |
| Activities, all users | 2,369. None missing an id or date; no duplicate ids |
| Average size of one activity | 305 bytes (largest single activity: 755 bytes; no route data is stored) |
| Doc size p50 / p90 / p99 / max | 2.1 KB / 18 KB / 50 KB / **108 KB** |
| Activities per user p50 / p90 / p99 / max | 2 / 44 / 165 / **324** |
| Docs over 100 KB / 250 KB / 500 KB | 1 / 0 / 0 |
| Share of each big doc that is `activities` | 82–96% |
| New activities per month, all users (last 90 days) | about 250 |
| Weeks with at least one activity, per user p50 / p90 / max | 2 / 11 / **40** |
| Busiest single week | 22 activities, 7.8 KB |
| Week docs a backfill would write | 482 |
| Friends per user p50 / p90 / max | 0 / 1 / 8 |
| Activity id types | 2,054 numbers, 315 strings (`hk_<uuid>`, `credit_…`) |

**Time to 1 MiB at each user's own pace** (activities dated in the last 90 days, times their average bytes per activity):

| Rank by size | Activities | Doc | Pace | Months to 1 MiB |
|---|---|---|---|---|
| 1 | 324 | 108 KB | 30 / month | **96** |
| 4 | 58 | 26 KB | 19 / month | 130 |
| 6 | 63 | 25 KB | 21 / month | 130 |
| 12 | 41 | 19 KB | 14 / month | 185 |

- **Worst plausible case:** someone logs 3 workouts a day, every day, which adds about 30 KB a month. Starting from zero, they would reach 1 MiB in about 3 years.
- **A long history can't arrive all at once.** HealthKit sync only looks back 30 days (`src/services/healthService.js:842`), so a new user can't import years of old workouts.
- **Other growing fields are small.** `personalRecords` is the largest, at 93 KB summed across *all* users.

To run the script again:

```bash
GCLOUD_ACCESS_TOKEN=$(gcloud auth print-access-token) PATH=/opt/homebrew/opt/node@20/bin:$PATH node functions/scripts/activityStorageStats.js --top 20
```

Plain ADC also works. The token variable is only there for when ADC asks for a re-login, which it did on 2026-11-01.

## 2. Who reads and writes `activities` today

### Phone and web (`src/`)

**Writes.** Every change goes through `saveActivityChanges` and then the outbox (`src/services/userService.js:689`). That includes manual log, edit, finish workout, delete, HealthKit auto-sync, onboarding credits, calorie backfill, location capture and challenge photo apply.

The outbox stores `{op: 'upsert'|'delete', id, activity, seq}` in localStorage `activityOutbox:<uid>`, then sends:
- **Native** (`userService.js:557`):
  1. GET `users/{uid}?mask.fieldPaths=activities`. This returns the whole array plus the doc's `updateTime`.
  2. Apply the ops.
  3. PATCH the **whole array** with `currentDocument.updateTime`.
  4. On a conflict, retry up to 5 times.
- **Web** (`userService.js:604`): `runTransaction` on the whole doc.

Fields derived from activities are written separately with `updateUserProfile` (merge, no precondition): `streaks`, `weekCelebrations` and `personalRecords`. The precondition is the *document's* `updateTime`, so the streak write that follows about 200 ms after each save is itself a conflict source.

**Own activities, read** with `getUserActivities` (`userService.js:721`), as a flat array:

| Needs the whole history | Needs a window |
|---|---|
| `computeStreaks` (`src/utils/streaks.js:71`): live streak, auto-shield, share card | Home: this week plus the 10 most recent |
| Launch records recalc and records after a delete (`src/App.jsx:14670`, `:17912`) | Rings and celebrations: this week (`judgeWeekFor`) |
| Profile: averages, totals, history list, calendar, photo gallery | Widget: this week plus the 5 most recent |
| Leaderboard "all" column; calorie backfill (newest 400) | Trends: up to 1 year; Week and Month stats modals: one period |
| | HealthKit dedupe: the 30-day sync window |

**Friends' activities.** There is no feed collection. The client reads each friend's **whole user doc**.

| Screen | Reads per friend today |
|---|---|
| Feed (`src/ActivityFeed.jsx:1422`) | 1 whole doc (60 s cache); keeps the top 50 across all friends |
| Leaderboard (`ActivityFeed.jsx:1790`) | **3 whole docs**: `getUserActivities`, `getPersonalRecords`, `getUserProfile`. Plus a 365-day `dailyHealth` query |
| Friend card, challenge detail | 1 whole doc, but only streaks, records and `challengeStats` are used |

Reactions and comments live at `users/{owner}/activityReactions/{String(id)}/…`, so activity ids must keep their exact value.

**Whole-doc reads on a cold start: 7.** In `handleUserAuth`, `src/App.jsx`:

| # | Line | Call | What it needs |
|---|---|---|---|
| 1 | 14919 | `getUserProfile` (SDK, gates the first render) | profile, `activities.length` |
| 2 | 13928 | `subscribeToUserChallengeStats` listener | `challengeStats` only. It **re-downloads the whole doc after every later write** |
| 3 | 15041 | `getUserGoals` | `goals` |
| 4 | 15088 | `getUserProfile(force)`: unmasked REST on native | streaks, plan, goal history, shield/vacation/injury, celebrations |
| 5 | 15237 | `getUserActivities(force)`: masked REST | **the only read that needs activities** |
| 6 | 15359 | `getCustomActivities` | `customActivities` |
| 7 | 15372 | `getPersonalRecords` (not cached) | records |

Launch also writes `goals` and `goalHistory` every time (15048), plus `unreadBadgeCount` and the timezone. Each of those writes:
- makes the listener in #2 download the whole doc again;
- fires five server triggers.

For the 108 KB user, a cold start moves roughly 750 KB to 1 MB.

### Watch (`ios/App/DaySeven Watch Watch App/`)

**Reads.** `GET users/{uid}`: the whole doc, no mask (`Services/FirestoreService.swift:270`). The Watch reads:
- after sign-in;
- on foreground (at most once every 30 s);
- on `dataChanged` from the phone;
- before **every** write.

It only uses this week (Sunday → today): rings, today's list, HealthKit-UUID dedupe and complications. Streak totals come from the `streaks` map.

**Writes.** One masked PATCH of the **whole array** together with `streaks.{lifts,cardio,recovery}`, record fields and `weekCelebrations`, with `currentDocument.updateTime` (`FirestoreService.swift:195`). It retries 3 times on a conflict, then falls back to an offline queue in the App Group. The phone never writes for the Watch.

**Older Watch builds behave worse:**
- **Up to 1.8.3 (1):** no precondition. A failed read can write `[]` plus the new workout, and edit/delete PATCH a stale in-memory array.
- **Before 1.7.6:** also drops fields the Watch doesn't model.
- **Every build:** turns numeric-string ids into integers, and truncates duration, calories and heart rate to integers.

**Phone-side Swift** never reads or writes activities in Firestore. Widgets get precomputed data from JS through `updateWidgetData`. No activity data crosses WatchConnectivity.

### Cloud Functions (`functions/index.js`)

**Hourly scans** use `.select()`, so they don't download the array. It comes along only on whole-doc reads (`readFullUser` :1024, `getUserPreferences` :345, `sendNotificationToUser` :571/:594) for the users a job acts on.

| Function | Activities it uses |
|---|---|
| `judgeUserWeek` :446 (used by streak reminders, weekly summary, goal reminder) | one Sunday–Saturday week |
| `sendDailyReminders` :1191 | today |
| `sendStreakReminders` :1086 | last 2 days, plus last week |
| `sendGoalReminder` :1298 | this week |
| `sendWeeklySummary` :1407 | last week and the week before |
| `sendMonthlySummary` :1565 | the last two whole months |
| `sendTrialEndingReminders` :1879 | last 7 days |
| `sendWinbackReminders` :1946 | "any real activity ever". It reads the whole doc *before* checking whether a stage is due |
| `sendActivationReminders` :2044 | "zero activities", plus this week |
| `onFriendActivityLogged` :2260 (trigger on `users/{uid}`) | diffs the array for new ids, then does **one whole-doc read per friend** for preferences |
| `onUserActivitiesUpdatedForChallenges` :2985 (trigger) | diffs the array, matches open challenges |
| `fulfillChallengeForUser` :2566, `applyChallengeIntent` :3401 | finds or rewrites one activity inside the array (in a transaction) |
| `onReactionCreated` :875 | checks that the activity id exists in the owner's array |
| `deleteAccount` / `onAuthUserDeleted` | `recursiveDelete(userRef)`, which already covers subcollections. **No change needed** |

Five triggers fire on every user-doc write, and each one receives the whole before and after doc: `protectUserFields`, `onStreakMilestone`, `onFriendActivityLogged`, `onGoalAchieved` and the challenges trigger.

### Rules, tests, indexes, scripts

- **Rules.** Both `firestore.rules` and `firestore.strict.rules` treat `activities` as an ordinary owner-writable field of the user doc. No subcollection for activities exists. The new subcollection's read rule will follow the strict file's user-doc rule, `ownerOrFriend`, in **both** files, the same way `dailyHealth` already does.
- **Tests** (`firestore-tests/`) always seed activities as an inline array: `rules.test.js:37`, `scheduledJobs.test.js:41`, `handlers.test.js`, `triggers.test.js:89`. Nothing tests the two activity triggers, `applyChallengeIntent` or `fulfillChallengeForUser`.
- **Indexes.** Nothing in `firestore.indexes.json` covers `users` or activities.
- **Scripts that write the array:**
  - `functions/scripts/` `repairEmptyTypeActivity.js`, `seedAutoLogMocks.js` and `seedFakeFeedActivities.js`;
  - `scripts/seed-reviewer.mjs`, which seeds the App Review account.

## 3. Target design

### Options

| | One doc per activity<br>`activities/{id}` | **One doc per week**<br>`activityWeeks/{weekKey}` | Per-activity docs plus server-built week summaries |
|---|---|---|---|
| This week (Home, Watch, server jobs) | a query, about 5–10 reads | **1 read** | 1 read |
| Whole history (streaks, records, Profile) | 1 read per activity (324 for the biggest user) | **1 read per week** (40) | 1 read per week |
| Save | 1 small write, no conflicts | read and write one small doc, precondition on that week only | 1 small write, then a server rebuild of the week |
| Watch code change | new parser and new write path | **URL and week key only**: same array shape | new parser; summaries lag a save by 1–3 s |
| Deletes and "what changed since" sync | needs tombstones | week docs are never deleted, so no tombstones | tombstones |
| Moving parts | few | **few** | a second derived copy plus a trigger that must never fail |

**Pick: one doc per week.** It matches how almost everything reads activities: by week. It keeps the shape every client and function already parses. It caps doc size (the busiest week on record is 7.8 KB). It needs no derived data and no category logic on the server.

What it costs:
- Point lookups by id need the activity's week. That's easy wherever the activity object is in hand. The one exception is `onReactionCreated`, which needs a small fallback (see below).
- Whole-history reads are one per week instead of one per user. At today's scale that is pennies. Later, a "changed since" sync brings it down to about 2 reads per launch.

### Schema

```
users/{uid}/activityWeeks/{weekKey}     weekKey = Sunday of the activity's week, 'YYYY-MM-DD'
  activities: [ ...today's activity objects, unchanged... ]
  updatedAt:  server timestamp, set by every write (rules enforce it)
  mirror:     { origin: 'array' | 'backfill' | 'repair', at }   server-only, set only by the migration mirrors
```

- **`weekKey`** is the same calendar math everywhere: Sunday of the activity's local `YYYY-MM-DD` date. That's `weekKeyFromDateStr` in `src/utils/weekGoals.js`, `SharedDefaults.weekStart` on the Watch, and the Sunday logic in `judgeUserWeek`. A shared list of test dates will pin it down across JS, Swift and Node: year end, DST weekends, and Saturday/Sunday edges.
- **Week docs are never deleted.** An emptied week keeps `activities: []`. That keeps a future "changed since `updatedAt`" sync free of tombstones. `updatedAt` is in from the first build that writes week docs, because a Watch build that skipped it could never be caught up by that sync.
- **Activity objects keep their exact `id` value and type.** Comparisons stay `String(id)`, as the outbox already does.
- **Indexes.** Add a field override that turns off indexing of `activityWeeks.activities`. Nothing queries inside it, and it saves an index entry per activity. The automatic `updatedAt` index stays.

### Reads after the move

| Consumer | After |
|---|---|
| Phone cold start | the user doc, which becomes small; then this week's doc for first render; then the other weeks in the background (40 for the biggest user, about 104 KB once instead of 7 × 108 KB) |
| Streak math | unchanged. The client flattens the loaded weeks into the same array for `computeStreaks` and `weekGoals`. Anything that acts on "the whole history" waits for a new "all weeks loaded" flag, the successor of `activitiesLoadedFromServer`. That covers the launch streak recalc, the records ratchet, auto-shield and records after a delete |
| Feed | each friend's 2 newest week docs (`orderBy(documentId, desc).limit(2)`) instead of their whole doc |
| Leaderboard | each friend's small user doc once (records, streaks, `challengeStats`) plus their week docs. If the year and all-time columns ever get slow, a per-user weekly-totals doc can come later |
| Watch | `GET users/{uid}/activityWeeks/{thisWeek}` plus the user doc for streaks. HealthKit dedupe compares same-date items, which are always in the same week |
| Server jobs | 1 week doc for daily, goal, trial, streak and weekly; about 9 for monthly. "Any activity ever" (win-back, activation) becomes a `limit(1)` query on `activityWeeks`, skipping weeks that only hold `onboarding_credit` |

### Writes and the outbox

The outbox keeps its idea and most of its code. **The doc it read-modify-writes becomes the week doc instead of the user doc.**

1. **Each op gets a `week`.**
   - For an upsert, it comes from `activity.date`.
   - For a delete, it's the week the activity was in.
   - An edit that changes the date queues an upsert into the new week *and* a delete from the old one.
   - Ops collapse by `(id, week)` instead of by `id`, so the move's delete isn't swallowed.
2. **Flushing**, one week doc at a time: GET the doc and its `updateTime`, run `applyActivityOps` on its `activities`, and write back.
   - **Native:** the write goes through REST `:commit` instead of PATCH. That lets one request carry `currentDocument.updateTime`, or `exists: false` for a brand-new week, plus the `updatedAt` server transform. A move across weeks is one `:commit` with two writes, which is atomic.
   - **Web:** `runTransaction` over the one or two week docs.
3. **Conflicts become rare.** The precondition only fails when the *same week* changed. Badge counts, streak writes, goal writes and server counters no longer cause retries.
4. **Outbox entries left over from 1.8.x** (no `week`) are upgraded on first load:
   - an upsert takes its week from the activity's date;
   - a delete finds its week in the loaded history, so flushing waits until history has loaded once.

**Watch writes** follow the same pattern: GET the week doc, modify, then `:commit` with its `updateTime` and the `updatedAt` transform. Then it does a separate masked PATCH of `streaks.*`, record fields and `weekCelebrations` on the user doc, keeping today's user-doc precondition. This splits one atomic write into two. If the second write fails, the activity is saved but the Watch's streak +1 isn't. The phone's streak recalc on its next launch corrects it, and it already overrides the Watch's numbers today.

### Server

- **Activity triggers move to the week docs.** `onFriendActivityLogged` and the challenges trigger move to `onDocumentWritten('users/{uid}/activityWeeks/{week}')` and diff the week's array by id, with the same diff code they use today.
  - They ignore writes whose `mirror.origin` is `backfill` or `repair`, so the backfill can't send "just worked out" pushes or fulfil challenges with old workouts.
  - The old and new versions both check `config/activityStorage.triggers` (`'array'` or `'weeks'`), so the switch is one flag flip with no gap and no double pushes.
- **`judgeUserWeek` takes one week's activities** instead of the whole user doc.
- **`applyChallengeIntent` and `fulfillChallengeForUser`** read and write the activity wherever that user's activities currently live (see the switch below).
- **`onReactionCreated`** looks for the id in the owner's newest 8 weeks, then in the rest. Reactions are rare and the feed only shows recent activities.
- **`deleteAccount`:** no change.

### Rules (identical block in both files)

- `users/{uid}/activityWeeks/{weekKey}`:
  - **read:** `ownerOrFriend(uid)`;
  - **create/update:** owner only;
  - **checks:** the doc id is a `YYYY-MM-DD` key, the doc holds only `activities`, `updatedAt` and `mirror`, `activities` is a list of at most 100 items, `updatedAt == request.time`, and `mirror` is never touched by a client;
  - **delete:** never.
  - **Until the switch is flipped for anyone, client writes stay denied.** Only the server writes week docs in Phases 1–2.
- Add `activityStore` (the switch, below) and `activitiesMirror` to `serverOnlyUserKeys` in both files.
- **Phase 4:** clients may no longer write `activities` on the user doc.
- Every cross-user reader is a friend today (feed, leaderboard, friend card, completed-challenge feed), so friend-only reads break nothing. The emulator tests will confirm it.

### Per-user switch

`users/{uid}.activityStore`:
- `'weeks'` means the week docs are the truth for this user;
- missing means the array is.

It is server-only, so users can be flipped one at a time: Felipe first, then testers, then everyone. Clients from 1.9.0 read it from the profile they already load at launch. Older builds ignore it and keep using the array, which the mirrors keep complete. The web app reads the same field. So merging 1.9.0's code to `main`, which deploys the web app, changes nothing until someone is flipped.

### Mirrors (temporary, removed in Phase 4)

**Forward: array → week docs** (Phase 1 until Phase 4). A trigger on `users/{uid}` writes.
- **When it acts.** It does nothing unless `activities` changed. It also skips writes that changed `activitiesMirror`, which are the server's own writes.
- **Not flipped (the array is the truth):** in a transaction, re-read the current user doc and rebuild every week touched by the change from the *current* array. It reads current state, not the event's copy, so out-of-order or repeated trigger deliveries still land on the right result. It also repairs any drift.
- **Flipped (only old builds still write the array):** apply only the ids that changed in this write. Propagate a removal only when it is the only one in the write. Stale-array writes from old Watch builds drop several items at once. The real deletes the app makes are one at a time, so anything bigger is logged and skipped.
- **In both cases** it writes only when something differs, and stamps `mirror`.

**Reverse: week docs → array** (Phase 3 until Phase 4, flipped users only). A trigger on `activityWeeks` writes that skips writes that changed `mirror`.
- In a transaction it re-reads the user doc and the current week doc.
- It sets the array entries for the changed ids to the week doc's current version, and writes `activities` and `activitiesMirror` only when they differ.
- This keeps the array a complete copy. Old builds (an old Watch app, an iPad that never updated) see everything and don't compute streaks from a partial history. Flipping a user back stays possible.

The markers plus "write only when different" stop the two mirrors from feeding each other in a loop.

## 4. Migration phases

| Phase | Ships as | What changes | Move on when |
|---|---|---|---|
| 0 | **app 1.8.6** + a functions deploy | Fewer repeated reads, version stamp, update gate. No data change | 1.8.6 is out |
| 1 | server only | Week docs exist and mirror the array; backfill | parity script clean for a week |
| 2 | server only | Scheduled jobs and activity triggers read week docs | a week of normal pushes and challenge fulfilment |
| 3 | **app 1.9.0** (phone, Watch, web) + server | Clients read and write week docs once flipped; reverse mirror on | Felipe, then testers, then everyone flipped |
| 4 | **1.9.x cleanup release** + server | Arrays deleted, mirrors off, legacy code removed | no pre-1.9.0 client seen for 4 weeks |

### Phase 0: 1.8.6, no data change

**App:**
- **Cold start, 7 whole-doc reads down to 3.**
  - #4 and #5 become one forced unmasked REST read, which returns the profile, the activities and the `updateTime`.
  - #3, #6 and #7 take goals, custom activities and records from that result.
  - #1, the first-render read, stays as it is, because it is part of the startup gate behind the old "stuck on 7" bug.
  - #2, the `challengeStats` listener, stays.
- **Launch writes happen only when the value changed:** `goals`/`goalHistory` (`App.jsx:15048`), `unreadBadgeCount` and the timezone. Each one avoided saves five trigger runs, one listener re-download and one possible outbox conflict.
- **Leaderboard: 3 reads per friend down to 1.** All three calls read the same doc.
- **Version stamp.** When the value changes, the phone writes `clientInfo: {app, build, platform}` and the Watch writes `watchClientInfo`. That happens once per update, not per launch. This is how Phase 4 knows when old builds are gone. Builds before 1.8.6 can't report, so "active recently but no stamp" counts as old.
- **Update gate.** On launch the app reads `config/minAppVersion`. Below it, a full-screen "Update DaySeven" with an App Store link. It stays unused until Phase 4. It has to ship early, because only builds that contain it can be stopped.

**Functions:**
- `onFriendActivityLogged` reads only the preferences field per friend.
- `sendNotificationToUser` reads the doc once instead of twice.
- Win-back checks whether a stage is due before reading the whole doc.

**Cost:** 1–2 days of work; low risk. Rollback is a normal app or functions rollback.

### Phase 1: server only, week docs mirror the array

1. Rules for `activityWeeks` in both files, with client writes denied. Rules tests for owner, friend, stranger, a bad week id, too many items, `updatedAt` and `mirror`.
2. Index override for `activityWeeks.activities`.
3. Deploy the **forward mirror**, by itself.
4. **Backfill.** New script `functions/scripts/backfillActivityWeeks.js`.
   - It is a dry run by default: it prints counts only.
   - `--apply` processes one user per transaction. It re-reads the user doc, groups the array by week, and writes each week doc with `mirror.origin = 'backfill'`.
   - The mirror is already live, so a save during the backfill is either picked up by the mirror or by the transaction's re-read.
   - It is safe to rerun. Today that's 482 writes.
   - **I'll ask before running `--apply`.**
5. **Parity check.** New script `functions/scripts/checkActivityWeeksParity.js`. It is read-only and prints counts only. For each user it compares the array with the flattened week docs by id, ignoring the Watch's int/string id and integer-truncation quirks, and prints mismatch counts. Run it after the backfill and daily for a week. A `--repair` flag rewrites drifted weeks with `mirror.origin = 'repair'`.

**Cost:**
- About 482 writes and 148 reads once.
- Then, per activity change, one more trigger run, about 3 reads and 1–2 writes. At about 250 new activities a month, that's well under a dollar.
- 2–3 days with tests.

**Rollback:** delete the mirror function. Nothing reads the week docs yet.

### Phase 2: server only, jobs and triggers read week docs

- Scheduled jobs, `judgeUserWeek`, `onReactionCreated` and the challenge functions read week docs, as in the table in section 3.
- The two activity triggers are deployed on `activityWeeks` and switched with `config/activityStorage.triggers = 'weeks'`.
- This works for every user, flipped or not, because the forward mirror keeps the week docs right.
- The mirror lags a save by a second or two. Jobs run on a schedule, and the triggers now fire after the mirror, so nothing depends on that lag.

**Tests:** `scheduledJobs.test.js` and `handlers.test.js` seed week docs. New trigger tests cover the friend push and challenge match, and check that a backfill-origin write sends nothing.

**Cost:** fewer whole-doc reads on the server. 2–3 days.

**Rollback:** set the flag back to `'array'` and redeploy the previous job code.

### Phase 3: 1.9.0, clients switch, per user

**App (phone and web):**
- A storage layer that, for flipped users, reads this week first and the other weeks in the background. The "all weeks loaded" flag gates whole-history actions.
- The per-week outbox described above.
- Feed and leaderboard read friends' week docs. A friend's week docs exist whether or not *they* are flipped, because the forward mirror keeps them current.

**Watch:**
- Reads and writes week docs when the user doc says `'weeks'`.
- Stamps `watchClientInfo`.

**Server:**
- Deploy the reverse mirror.
- Change the rules to allow owner writes to week docs.

**Rollout:**
1. Flip Felipe's account. Test on device:
   - phone save, edit across weeks, delete;
   - Watch save and discard;
   - airplane-mode save, then reconnect;
   - an old Watch build writing while the phone is on 1.9.0;
   - web and phone side by side.
2. Flip testers, then everyone. Run the parity check before each step.

**Cost:**
- **Each save:** about 1 KB read and written instead of the whole history.
- **Each cold start:** a small user doc plus 1 week doc, then the other weeks once. That's more billed reads (up to 41 for the biggest user) but about 7× less data.
- **Each friend:** 2 small reads in the feed.
- **The reverse mirror** adds one server-side user-doc write per change, which is what clients do today, until Phase 4.
- **Work:** about 1–2 weeks across phone, web, Watch and tests.

**Rollback:** unset `activityStore` for the user. The reverse mirror kept their array complete.

### Phase 4: cleanup release, the point of no return

**When:**
- the version stamps show no pre-1.9.0 phone or Watch active for 4 weeks;
- `config/minAppVersion` has been raised to 1.9.0.

**Steps:**
1. Take a Firestore export to a bucket, as a backup.
2. Turn both mirrors off.
3. Run a script that deletes `activities` and `activitiesMirror` from every user doc.
4. Rules: clients can no longer write `activities` on the user doc.
5. Remove the array code paths from the app, the Watch and the functions.
6. Update the scripts that seed or repair arrays, including `scripts/seed-reviewer.mjs` for the App Review account.

**Result:** user docs drop to a few KB, so every remaining whole-doc read, listener update and trigger payload gets small.

**Rollback:** only by restoring the export, so this goes last and only on Felipe's word.

## 5. Risks

| Risk | What would happen | Guard |
|---|---|---|
| Old builds write stale arrays (phone up to 1.8.4, Watch up to 1.8.3 (1)) | a dropped item looks like a delete | flipped users: removals propagate only one at a time and the rest are logged. The version stamp and update gate shrink this group. It is no worse than today, where the same writes lose data outright |
| Trigger deliveries arrive out of order or twice | a week doc briefly misses an edit | both mirrors re-read current state in a transaction and write only when something differs; the parity script catches the rest |
| The two mirrors feed each other | endless writes | the `mirror` / `activitiesMirror` markers plus write-only-when-different |
| The backfill or a repair looks like new workouts | pushes to friends, challenges fulfilled with old workouts | triggers skip `backfill`/`repair` origins; the week-doc triggers go live in Phase 2, after the backfill |
| Week key computed differently in JS, Swift and Node | an activity lands in the wrong week, so a week counts wrong | one shared list of test dates; the parity script flags any activity whose date isn't in its doc's week |
| Watch activity save and streak write are no longer one write | a Watch +1 is missed if the second write fails | the phone's launch recalc already corrects the Watch's numbers |
| Whole-history actions run on partial history | records lowered, a shield spent, a streak reset | the "all weeks loaded" flag, the same guard `activitiesLoadedFromServer` gives today |
| 1.8.x outbox entries carry no week | a queued delete can't find its doc | upgraded on load; flushing waits for history |
| Id type changes during a move | reactions/comments detach; `===` comparisons in `App.jsx` miss | ids are copied as-is; comparisons that matter use `String(id)` |
| More billed reads for whole-history screens | cost rises with users × weeks | pennies at 148 users; a "changed since `updatedAt`" sync later cuts launches to about 2 reads |
| Merging 1.9.0's code to `main` ships the web app | web behaves differently from iOS | nothing changes until a user is flipped, and the flip covers all of that user's devices |

## 6. Decisions for Felipe

1. **Timing.** Phase 0 in 1.8.6 is worth doing now on its own. Phases 1–4 aren't urgent at the measured pace. Doing them while there are 148 users and few old builds is easier than later. Suggested: Phases 1–2 after 1.8.6, and 1.9.0 when it fits the roadmap.
2. **Update gate.** OK to show a blocking "Update DaySeven" screen once 1.9.0 is the minimum?
3. **Week docs vs one doc per activity:** recommendation above.
4. **Leaderboard.** Read friends' week docs (fine at 8 friends × 40 weeks), or add a per-user weekly-totals doc when it's built?
