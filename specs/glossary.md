# glossary

Answers what the spec's own words mean, and what happens when one of them changes.

A spec speaks in words — a turn, the margin — and two readers can hear two things in the
same one. A TERM fixes a meaning once, the way a legal document defines its defined terms:
the vocabulary is written in each CAPABILITY FILE beside the requirements that use it, and a
requirement uses a TERM in the exact form it was defined in — capitals, singular,
unchanged — so a reader always knows which words carry a meaning of their own.

The other half is the price of that. A definition is part of every PROMISE that uses the
word: rewrite it and the PROMISE behind it has not moved a line of its tests, but what
that test is claimed to prove has changed underneath it. This capability is what keeps
that change from passing unreviewed.

A TERM is not one of the format's reserved words. `### Requirement:`, `### Term:`, and the
Gherkin step keywords are the tool's — written in backticks, defined by the capabilities
that parse them, and meaning the same thing in every repository. A TERM is this project's:
defined in a CAPABILITY FILE, used in the exact form, and owned by whoever owns that repo's
spec.

### Term: TERM

A word defined once, in a Term section, that means that one thing everywhere. A requirement
uses a TERM in the exact form it was defined in — capitals, singular, unchanged — so a
reader always knows which words carry a meaning of their own.

### Requirement: A TERM is used when it appears in the exact form it was defined in

Finding every TERM a PROMISE's words use SHALL be a whole-word match of each TERM in the
exact form it was defined in, across the PROMISE's requirement heading and description,
its scenario title and steps, and other TERM definitions.

The convention is the matcher. A TERM written in capitals and used in capitals needs no
case folding, no plurals, no stemming: TURN matches TURN and nothing else, because the form
is the agreement. A word that merely contains the TERM — TURNING — or spells it differently
— turn, Turns — is not a use, and reading one as such would re-open a PROMISE the
vocabulary never reached.

<!-- scenarios: generated -->
- "A TERM is used when it appears as a whole word in the exact form it was defined in" → tests/glossary/use.test.ts
- "A word that merely contains the TERM, or spells it differently, is not a use" → tests/glossary/use.test.ts
<!-- /scenarios -->

### Requirement: A TERM is changed when its definition is not what it was

Comparing the vocabulary as it stands against the base revision, a TERM SHALL count as
changed when its definition is not the one that revision held — reworded, newly defined, or
gone.

The comparison is by word and whole definition. A definition moved to another file, or
re-ordered beside its neighbours, is the same definition and changes nothing: a TERM's
identity is the word, not where it is written.

<!-- scenarios: generated -->
- "A TERM the base revision does not have is changed" → tests/glossary/change.test.ts
- "A TERM the base revision had and this one does not is changed" → tests/glossary/change.test.ts
- "A reworded definition changes the TERM" → tests/glossary/change.test.ts
<!-- /scenarios -->

### Requirement: A changed TERM re-opens every PROMISE that uses it

A change to a TERM's definition SHALL count as reaching every PROMISE whose STANDARD uses
that TERM — directly, or through another TERM's definition — exactly as a change to the
tests does: the same work list, the same gate, the same reviewing.

A TERM used in a requirement's heading or description re-opens every scenario under that
requirement, because the description is the STANDARD each of them is judged against. A TERM
used in one scenario's title or steps re-opens that scenario alone: the others share the
action, not the sentence. A TERM used only inside another TERM's definition re-opens that
TERM's users, because a defined word built on a word that moved has moved with it.

A changed TERM no PROMISE uses re-opens nothing. The vocabulary is allowed to hold words
nobody leans on yet; only a PROMISE whose STANDARD moved is a PROMISE worth judging again.

<!-- scenarios: generated -->
- "A TERM used in a requirement's heading or description re-opens every scenario under it" → tests/glossary/reopen.test.ts
- "A TERM used in one scenario's title or steps re-opens that scenario alone" → tests/glossary/reopen.test.ts
- "A TERM used only inside another TERM's definition re-opens that TERM's users" → tests/glossary/reopen.test.ts
- "A changed TERM no PROMISE uses re-opens nothing" → tests/glossary/reopen.test.ts
<!-- /scenarios -->
