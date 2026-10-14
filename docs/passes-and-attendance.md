# Passes and attendance

A member's pass balance and the attendance register have to agree. Every
rehearsal they attend on a pass takes one session off; un-marking them puts it
back. If those two ever drift apart, somebody is either paying for a rehearsal
they did not attend or attending one they did not pay for, and neither is
discoverable by looking at the screen.

## What keeps them together

**One transaction.** `applyAttendance` in `db.ts` writes the attendance row and
moves the pass balance inside a single database transaction. Either both land
or neither does. Before 14 October 2026 they were two separate writes, and
anything failing between them — a dropped connection is the realistic one —
left the member recorded as present with the session still in hand, silently.

**A row lock.** The pass is read `FOR UPDATE`. Two admins marking the same
member at the same moment would otherwise both read the same balance and both
write it minus one, costing the member a session no attendance row accounts
for. This is not hypothetical at a rehearsal where two people share the
marking. Whichever mark loses that race is written as a single session rather
than as a pass it could not actually take, and the activity log says so.

**The restore is capped and never misses.** Un-marking adds the session back,
capped at what the pass was sold with, so repeated un-marks cannot inflate a
balance. It also finds a pass that has been used up: deducting the last session
sets `active = false`, and the old code looked only at active passes — so
un-marking a member whose pass had just hit zero restored nothing and they were
simply out a session. Verified against a throwaway TiDB: the old path returned
no pass at all in that case.

**Checked, not assumed.** All of the above was exercised against a throwaway
TiDB in a container — the deduct, the un-mark, the cap, the exhausted-pass
restore, two simultaneous marks on a one-session pass, and a forced failure
mid-transaction. There is no test runner in this repository, so the harness was
a throwaway; what it proved is recorded here instead.

**Notifications stay outside.** The activity log, the low-balance email and the
admin alerts all run after the transaction commits. A transaction holds a
pooled connection, and an email provider having a slow afternoon must not hold
a lock on somebody's pass.

## What still does not go through it

Rows written straight into the database. The 6 October Manus import did exactly
that, on purpose, because the balances it carried were already deducted.
Anything imported that way is correct by construction but was never checked by
this code.

## Checking

Actions → **Database audit** → `passdrift`. Read-only, safe against production,
and reports both directions:

- a pass-using attendance mark with no deduction logged that day — the member
  kept a session they used
- more taken off than the attendance accounts for — the member lost one

It nets restores against deductions, so mark-then-un-mark does not read as a
loss, and it defaults to 13 October 2026, the first rehearsal marked on the
live site. Before that the 33 imported rows would all be flagged, which is true
and useless.

Last run, 14 October 2026: 39 marks across 39 member-days, every one with a
matching deduction, and nobody short a session.

If it ever does report drift, fix it under Admin → Members by adjusting the
balance. Do not re-mark attendance — the row is already there, and re-marking
will not deduct for a mark it already considers made.
