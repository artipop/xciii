# Rules: conditions on arrows

Usually an event is one arrow: the step passed, the card moved. Conditions are
for when that is not enough. There are three kinds, by who makes the decision:
the board, the agent or a person.

## By a card property

Example: "The step passed → to Deploy, but only if Priority = High; the rest —
to Review".

Under the arrow in the stage panel there is **"+ branch on a condition"**: a
second arrow appears on the same event. The condition is a board property and
its value, both picked from lists. The first arrow whose condition holds fires;
an arrow without a condition is the fallback. The condition is written on the
arrow itself ("if Priority = High").

If the event arrives, no condition matches and there is no fallback arrow, the
card stays put and says so in a comment. So add the fallback arrow right away.

## By what the agent wrote

Example: "The step passed, and the agent's answer contains 'READY TO DEPLOY' →
to Deploy".

The condition "only if the agent wrote…" checks the agent's final comment. Ask
the agent in the task text to end its report with an agreed phrase — and the
branch with this condition fires only on its decision. The condition is
available only on outcomes of steps where an agent worked.

## By a mark on the card

A stage can wait for a mark on the card instead of a repository event: a person
sets "Approved = Yes" — and the card moves on immediately, without polling. In
the arrow's event list this is "the card was ticked"; which option — is its
condition (required).

The stage reacts only to the named property: ticking "Priority" will not fire
an arrow waiting for "Approved". If a session was running on the card at that
moment, it is cancelled — the person takes priority.

A card on such a stage shows in its route strip what it is waiting for,
condition included.
