# DaySeven · App Store listing (rewrite, 2026-09-21)

Positioning: **win the week, not the day.** For anyone who wants to be in shape without fitness running their life. The "hybrid athlete" identity language is gone, and the all-goals streak is now the "Winning Streak" (renamed 2026-09-23, see the end of this doc); lifting + cardio + recovery is simply what a complete week looks like.

Paste each field into App Store Connect → App Information / Version page. Limits are Apple's; counts are verified.

---

## App name (30 max)

**Decision (2026-09-21): keep `Fitness Tracker - DaySeven`.** No change.

Considered and passed on for now:
- `DaySeven: Workout Streaks` (25)
- `DaySeven: Weekly Fitness Goals` (30)

Reasoning for the alternates, kept for later: "fitness tracker" is one of the most competitive searches on the store and a new app won't rank for it. "Workout streaks" and "weekly goals" are searches DaySeven can actually win, and they describe what it does. Leading with the brand name also matches how people will look for it after seeing your content.

## Subtitle (30 max)

**Recommended:** `Win the week, not the day` (25)

Alternate: `Weekly goals. Real life.` (24)
Current: `Accountability & Streaks`

## Promotional text (170 max · editable anytime without review)

`Your body doesn't reset at midnight. Set weekly goals for lifting, cardio and recovery, miss a day without losing your streak, and win the week.` (144)

## Keywords (100 max · comma-separated, no spaces)

`weekly,goals,habit,gym,lifting,running,cardio,strength,recovery,sauna,steps,log,consistency,friends` (99)

Words already in the name and subtitle (dayseven, workout, streaks, win, week, day) are indexed automatically, so they are left out here on purpose.

---

## Description (4000 max)

```
Most fitness apps punish you for having a life. Miss one day and your streak is gone.

DaySeven works differently. Your body doesn't reset at midnight, so your goals shouldn't either. Set what a good week looks like, log as you go, and by day seven you either won the week or you didn't. Miss a Tuesday? It doesn't matter. The week isn't over.

It's built for people with jobs, relationships, travel and dinner plans who still want to be in great shape.

SET YOUR WEEK
• How many times you'll lift
• How many cardio sessions you'll do
• How many recovery sessions you'll take (sauna, cold plunge, yoga, stretching)
• Optional daily step and calorie targets

Set a bar you can clear on a busy week. Raise it when you're ready.

WIN THE WEEK, BUILD THE STREAK
Hit all three goals by the end of the week and you build your Winning Streak: strength, cardio and recovery in the same week. A rough day never breaks it. Only an unfinished week does. Milestones at 1 month, 3 months, 6 months and beyond.

LOG ANYTHING IN SECONDS
• Lifting, with the muscle groups you trained
• Running, cycling and other cardio with distance, pace and heart rate
• Recovery: sauna, cold plunge, yoga, mobility
• Custom activities with your own icon

WORKS WITH APPLE HEALTH AND APPLE WATCH
• Workouts, steps, calories and heart rate sync automatically
• Link Apple Watch or Whoop workouts straight to your log
• See live heart rate and calories during a workout

SEE THE BIG PICTURE
• A heatmap of your consistency
• Personal records and stats
• Weekly, monthly and yearly trends
• Progress photos you can compare over time

BETTER WITH FRIENDS
• Add friends and see each other's weeks
• React to workouts
• Leaderboards and head-to-head challenges
• Share your wins as cards for social

Nobody wants to be the one who didn't close out their week.

DaySeven Pro unlocks every feature. Start with a free trial, then choose monthly or annual. Manage or cancel anytime in your App Store settings.

Stop trying to be perfect every day. Win the week.

Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

Notes on the description
- First three lines are what shows before "more", so they carry the whole pitch: the problem, the idea, who it's for.
- "Winning Streak" is named once, in the streak section, and defined in the same sentence, since a store visitor has never seen the term.
- No weight-loss or medical claims anywhere, on purpose. After the August HealthKit rejection, the listing stays strictly about logging, goals and consistency.
- Prices are left out of the body because they vary by country; the App Store shows them automatically.
- Add your Privacy Policy URL in App Store Connect's dedicated field (required for subscription apps).

---

## Screenshot captions (7 panels)

**Decision (2026-09-21): keep the current captions for now.** The new set below is parked until the in-app "Winning Streak" rename (2026-09-23) ships and screenshots are re-captured anyway.

| # | Screen | Now | New headline | New subline |
|---|---|---|---|---|
| 1 | Home | Set Your Standards. / Earn Your Streaks. | **Win the week.** / **Not the day.** | Miss a day. Keep your streak. |
| 2 | Goals | Three rings. One goal. | **Three rings.** / **One week.** | Strength. Cardio. Recovery. |
| 3 | Feed | Better with Friends. | **Better with friends.** | Share your wins. Hype each other up. |
| 4 | History | Your Stats. Your Records. Your Proof. | **Proof you showed up.** | Streaks, personal bests and week-by-week history. |
| 5 | Leaderboard | Compete. / Dominate. | **A little competition helps.** | Rankings across steps, workouts, calories & more. |
| 6 | Challenges | Bet on Yourself. | **Bet on yourself.** | Head-to-head challenges with friends. |
| 7 | Trends | Zoom Out. See the Big Picture. | **Zoom out.** / **See the big picture.** | Weekly, monthly & yearly trends. |

Panel 1 is the one that matters: most people only ever see the first two or three. It now says the same thing as the guide, the landing page and your videos.
Panel 5 drops "Dominate": it fights the "without sacrificing your life" tone.

---

## Inside the app (needs a release, not just a listing edit)

"Hybrid athlete" as an identity is gone from the app. On 2026-09-21 "Hybrid Streak" was kept; on **2026-09-23 it was renamed "Winning Streak"** to match "win the week" (Profile hero, top pill, share cards, celebrations, friend profiles, iPhone widget). Where only one word fits beside Strength, Cardio and Recovery (share-card and friend-profile records) it reads "Winning"; the week-stats tile reads "Week won". "Winning weeks" alone was rejected because it doesn't say *in a row*. The "Hybrid" activity group (Yoga, Pilates, Walking) stays too, since there it means "can count toward either goal".

Rewritten in the new voice:
- Onboarding: "This is what hybrid actually looks like." → "This is what a complete week looks like."; "your first hybrid week" → "your first full week"
- Discord invite: "current and aspiring hybrid athletes" → "people leveling up their physiques without giving up their lives"

Because "Hybrid Streak" is unchanged, the existing screenshots don't need re-capturing for this. Internal identifiers like the `hybrid` activity category and the `already_hybrid` onboarding value are untouched.
