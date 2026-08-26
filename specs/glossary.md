# glossary

Answers what the spec's own words mean, and what happens when one of them changes.

A spec speaks in words — a turn, the margin — and two readers can hear two things in the
same one. A term fixes a meaning once, the way a legal document defines its defined terms:
the vocabulary is written in the capability files beside the requirements that use it, and a
requirement uses a term in the exact form it was defined in — capitals, singular,
unchanged — so a reader always knows which words carry a meaning of their own.

The other half is the price of that. A definition is part of every promise that uses the
word: rewrite it and the promises have not moved a line of their tests, but what those
tests are claimed to prove has changed underneath them. This capability is what keeps that
change from passing unreviewed.

### Requirement: A term is used when it appears in the exact form it was defined in

Finding the terms a promise's words use SHALL be a whole-word match of each defined term in
the exact form it was defined in, across the promise's requirement heading and description,
its scenario title and steps, and other terms' definitions.

The convention is the matcher. A term written in capitals and used in capitals needs no
case folding, no plurals, no stemming: TURN matches TURN and nothing else, because the form
is the agreement. A word that merely contains the term — TURNING — or spells it differently
— turn, Turns — is not a use, and reading one as such would re-open promises the vocabulary
never reached.

<!-- scenarios: generated -->
- "A term is used when it appears as a whole word in the exact form it was defined in" → tests/glossary/use.test.ts
- "A word that merely contains the term, or spells it differently, is not a use" → tests/glossary/use.test.ts
<!-- /scenarios -->

### Requirement: A term is changed when its definition is not what it was

Comparing the vocabulary as it stands against the base revision, a term SHALL count as
changed when its definition is not the one that revision held — reworded, newly defined, or
gone.

The comparison is by word and whole definition. A definition moved to another file, or
re-ordered beside its neighbours, is the same definition and changes nothing: a term's
identity is the word, not where it is written.

<!-- scenarios: generated -->
- "A reworded definition changes the term" → tests/glossary/change.test.ts
- "A term the base revision does not have is changed" → tests/glossary/change.test.ts
- "A term the base revision had and this one does not is changed" → tests/glossary/change.test.ts
<!-- /scenarios -->

### Requirement: A changed term re-opens every promise that uses it

A change to a term's definition SHALL count as reaching every promise whose standard uses
that term — directly, or through another term's definition — exactly as a change to the
tests does: the same work list, the same gate, the same reviewing.

A term used in a requirement's heading or description re-opens every scenario under that
requirement, because the description is the standard each of them is judged against. A term
used in one scenario's title or steps re-opens that scenario alone: the others share the
action, not the sentence. A term used only inside another term's definition re-opens that
term's users, because a defined word built on a word that moved has moved with it.

A changed term no promise uses re-opens nothing. The vocabulary is allowed to hold words
nobody leans on yet; only a promise whose standard moved is a promise worth judging again.

<!-- scenarios: generated -->
- "A changed term no promise uses re-opens nothing" → tests/glossary/reopen.test.ts
- "A term used in a requirement's heading or description re-opens every scenario under it" → tests/glossary/reopen.test.ts
- "A term used in one scenario's title or steps re-opens that scenario alone" → tests/glossary/reopen.test.ts
- "A term used only inside another term's definition re-opens that term's users" → tests/glossary/reopen.test.ts
<!-- /scenarios -->
