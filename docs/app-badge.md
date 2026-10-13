# The number on the home-screen icon

A member with two unread notifications sees a **2** on the BVC icon on their
phone, the way Mail and Messages do it. It clears itself when they read them.

The number is the same one the bell shows inside the app, deliberately — an
icon and an app that disagree are worse than no badge at all.

## Where it works, and where it does not

| | |
| --- | --- |
| **iPhone / iPad, added to the Home Screen** | Yes, iOS 16.4 and later. This is the case that matters for the choir |
| **iPhone / iPad, opened as a normal Safari tab** | No. Apple exposes the API only to home-screen web apps — there is no icon to badge |
| **Android** | **No.** Chromium on Android does not implement the Badging API at all. Android's launcher shows its own dot for a pending notification instead, so those members still get a signal, just not a number |
| **Desktop, installed** | Yes, Chrome and Edge |
| **Desktop, ordinary tab** | No |

**Two things are needed on an iPhone**, and the second is the one people miss:

1. The site is added to the Home Screen (Share → Add to Home Screen)
2. Notifications are allowed

Apple ties badging to the notification permission. Without it the badge simply
never appears — and, awkwardly, `setAppBadge` does not fail or complain, so
there is nothing in the app to show something is wrong. If a member says the
number never shows up, that permission is the first thing to check.

## How it is kept right

Two places set it, because the app is usually closed when something arrives.

**While the app is open** — `client/components/BVCLayout.tsx` watches the same
unread query the bell uses and pushes the number to the icon whenever it
changes. That query already refetches every 30 seconds, so the badge follows it
without a timer of its own. Signing out sets it to zero.

**While the app is closed** — `public/sw.js` updates it when a push arrives,
and again when a notification is tapped.

The push cannot carry the number: `sendPushToAll` broadcasts one payload to
every subscription, so it does not know who is reading it. The service worker
therefore asks on its own behalf, and a same-origin fetch from a worker carries
the member's session cookie, so the server answers for the right person.

**If that lookup fails the badge is left exactly as it was** — signed out,
offline, or a platform that only pretends to support the API. A stale number is
better than a wrong one, and the notification itself has already told them
something happened.

## Changing what the number counts

It is `notifications.unread`, which includes announcements and messages,
because those create notifications. If it should count something else, the
single place to change is the `updateAppBadge` call in `BVCLayout.tsx` — and
then the fetch in `refreshBadge` inside `sw.js` has to be changed to match, or
the icon will say one thing while the app is closed and another once it opens.

## Testing it

It cannot be tested in a browser tab, so the real test is a phone:

1. On an iPhone, open the site in **Safari** → Share → **Add to Home Screen**
2. Open it from the home screen and allow notifications when asked
3. Post an announcement from an admin account
4. The notification arrives and the icon shows **1**
5. Open the app and read it — the icon clears

If step 4 shows a notification but no number, notifications were allowed but
the app was opened from Safari rather than the home-screen icon, or the phone
is on iOS 16.3 or older.

The parsing in `refreshBadge` is covered by a throwaway harness rather than a
test suite — there is no test runner in this repository. It was exercised
against the real tRPC/superjson response shape, an empty list, a 401, a thrown
fetch and a platform with no Badging API, and only the first two touch the
badge.
