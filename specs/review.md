# review

Answers whether every PROMISE a change reached has been judged, and what a judgement of
one is worth.

`touched` names every PROMISE a change put its hands on. That report is read so that someone —
in practice an agent — can ask of each one: *is this Gherkin still an honest reading of this
test?* Nothing recorded the answer, so nothing could tell a change that had been reviewed from
one that had merely been reported on. This capability is that record.

It reads no files. `cli` owns the LEDGER on disk and assembles the touched report; what a line
of that LEDGER means, what KEY a judgement is filed under, and whether a change has been
judged through are this capability's — the same split `spec-file` and `cli` already keep over
the CAPABILITY FILE.

### Term: KEY

The digest a judgement is filed under, made of the CLAIM, the PROOF, the STANDARD, and the
definition of every TERM the STANDARD uses. What line anything sits on is no part of a KEY,
so a file reformatted moves no judgement.

### Term: LEDGER

The append-only record of judgements: one line per reviewed PROMISE, filed under the KEY it
was judged under. A line is a fact about a KEY, so two branches that both reviewed both keep
their lines.

### Term: PROMISE

One scenario claimed at one PROOF SITE: its CLAIM, its PROOF, and the STANDARD it is judged
against, bound into the one unit the gate holds. Change any of the three and the PROMISE that
was judged is not this one.

### Term: STANDARD

The description of a requirement — what every scenario under it is judged against. The
definition of every TERM the STANDARD uses is part of it, so a redefined word is a different
question asked of every PROMISE beneath it.

### Requirement: A KEY says what it is for

A judgement SHALL be filed under a digest of the scenario's identity, the description written
under its requirement, its CLAIM, the source of the lines that prove it, and the definitions
of every TERM that PROMISE's STANDARD uses. A requirement's address SHALL be a digest of its
identity alone.

Keying a judgement by what it judged is what makes a stale review impossible to hold rather
than something to detect. Change the CLAIM, the PROOF, or the STANDARD, and the scenario is
simply not the KEY its review was filed under: it comes back unjudged, with no expiry rule
anywhere that could be written wrong. A rule that has to notice staleness fails silently when
it does not, and failing silently here means a PROMISE passing the gate unlooked-at.

The line a step or a PROOF sits on SHALL NOT be part of the KEY. A blank line inserted above a
test moves nothing anyone judged, and keying on position would empty the LEDGER every time a
file was reformatted.

The description SHALL be part of it. It is the STANDARD the CLAIM is judged against, so a
reworded SHALL is a different question being asked of every scenario under it, and every
judgement made under the old wording is worth taking again.

The definitions of every TERM the STANDARD uses SHALL be part of it too, for the same reason:
a definition is part of the STANDARD, so a redefined word is a different question being asked
of every PROMISE that uses it. A PROMISE whose STANDARD uses no TERM SHALL key exactly as it
did before any glossary existed — a repository that defines no TERM has its LEDGER stand
byte for byte as it stood, and that is a property of construction, not a rule to remember.

A removed PROOF SHALL be keyed by its identity alone. Nothing of it is left to weigh, so the
only question it raises — was this PROMISE meant to die — is answered once and stays answered.

A requirement's address SHALL NOT take anything from its description. It says where to ask,
not what was judged, and an address that moved partway through a review would send the
reviewer nowhere.

<!-- scenarios: generated -->
- "A PROMISE that uses a TERM keys its definition" → tests/review/digest.test.ts
- "A PROMISE that uses no TERM keys exactly as it did with no glossary" → tests/review/digest.test.ts
- "A removed PROOF is keyed by its identity alone" → tests/review/digest.test.ts
- "A requirement is addressed by its identity alone" → tests/review/digest.test.ts
- "A rewritten CLAIM gives the scenario a new KEY" → tests/review/digest.test.ts
- "A rewritten PROOF gives the scenario a new KEY" → tests/review/digest.test.ts
- "A rewritten requirement description gives every scenario under it a new KEY" → tests/review/digest.test.ts
- "The same CLAIM proven at a different line keeps its KEY" → tests/review/digest.test.ts
<!-- /scenarios -->

### Requirement: Passing a scenario means citing the line that proves it

A pass on a scenario the change touched SHALL name a line that its proving lines own and that
is not blank, and SHALL carry that line as it is written. A pass on a PROOF the change removed
SHALL cite nothing, and one offering a citation SHALL be refused. A reported problem SHALL
carry a note and no citation. Any of the three without what it requires SHALL be refused.

A removed PROOF is the exception because there is nothing left to point at. Requiring a
citation of it would make a pass unreachable, and a gate that cannot be cleared on a branch
that deleted a PROOF is not a gate — it is an outage, and the way through one is for whoever
hits it to start writing the verdict that does go through, whatever they actually found.

The asymmetry is the whole mechanism. A gate whose reviewer is also the party the gate blocks
has a reader with a reason to lie, and the answer is not to punish bad news — that is what
makes lying pay — but to make good news the expensive answer. Reporting a problem stays the
cheapest thing a reviewer can say, so the path of least resistance is an honest one.

What the citation buys is worth stating exactly, because it is less than it looks. It does not
prove the reviewer read anything: the proving source was handed to them, so any line of it is
theirs to quote. What it does is force them to commit to one claim-to-assertion
correspondence — and the commonest real drift, a CLAIM promising something no line asserts, is
precisely the one that cannot be pointed at.

The cited line SHALL be carried as written rather than as a number. The number alone tells
whoever reads the LEDGER in a diff nothing; the source lets them see at a glance whether the
reviewer pointed at an assertion or at an import, which is the check no mechanical rule here
can make.

Whether a line is an assertion SHALL NOT be judged here. That needs to know what language the
test is written in, and `test-scan` is the only capability that knows.

<!-- scenarios: generated -->
- "A pass citing a blank line is refused" → tests/review/record.test.ts
- "A pass citing a line outside the proving lines is refused" → tests/review/record.test.ts
- "A pass citing a proving line carries that line as it is written" → tests/review/record.test.ts
- "A pass citing no line at all is refused" → tests/review/record.test.ts
- "A pass on a removed PROOF cites nothing" → tests/review/record.test.ts
- "A pass on a removed PROOF that cites a line is refused" → tests/review/record.test.ts
- "A reported problem is recorded with its note and no citation" → tests/review/record.test.ts
- "A reported problem with no note is refused" → tests/review/record.test.ts
<!-- /scenarios -->

### Requirement: Every review names who made it

A review SHALL name its reviewer, and one that does not SHALL be refused.

An unsigned judgement is one nobody can be asked about. The first question a reader of the
LEDGER has is whether the reviewer was the author, since the author is the worst possible
reviewer of their own work: the context that just wrote the code has already convinced itself.

Whether they were the same party SHALL NOT be decided here. The tool does not know who wrote
the change, and spawning a reviewer that never watched it get written is the harness's job,
not this one's. What the record can do is make every judgement attributable, so the question
can be asked at all.

<!-- scenarios: generated -->
- "A review naming no reviewer is refused" → tests/review/record.test.ts
<!-- /scenarios -->

### Requirement: The LEDGER keeps one review to a line, and the last one stands

The LEDGER SHALL be read as one review to a line, a later review of a KEY SHALL stand over an
earlier one, a line that is not a review SHALL be reported rather than skipped, and a LEDGER
with no lines SHALL hold no reviews.

Appending rather than editing is what lets the record be committed and still merge. Every line
is a fact about a KEY and a KEY is a digest, so two branches that both reviewed produce lines
that either say the same thing or concern different KEY — the union of them is the right
answer, which is what a text merge of an append-only file already produces. A correction is a
later line, which is also why the last one stands.

A line it cannot read SHALL stop the read rather than be passed over. Skipping a damaged
record is how a PROMISE gets through the gate unjudged, which is the one thing the LEDGER
exists to prevent, and a half-resolved merge is exactly what that damage looks like.

An absent or empty LEDGER SHALL NOT be an error. Every branch starts there.

<!-- scenarios: generated -->
- "A LEDGER with no lines holds no reviews" → tests/review/ledger.test.ts
- "A later review of the same KEY supersedes the earlier one" → tests/review/ledger.test.ts
- "A line that is not a review is reported rather than skipped" → tests/review/ledger.test.ts
- "A review written to the LEDGER reads back as it was written" → tests/review/ledger.test.ts
<!-- /scenarios -->

### Requirement: A change is unsettled until every PROMISE it reached has been judged

Given every PROMISE a change reached and the reviews recorded, review SHALL name every touched
scenario and every removed PROOF that no review stands against, and SHALL name a removed PROOF
as removed.

This is the gate's question, and it is a lookup rather than a comparison: a review that went
stale is not a review filed under a wrong KEY, it is no review at all, so nothing has to work
out that anything expired.

A reported problem SHALL count as judged. The gate asks whether every PROMISE was judged, not
whether every judgement was favourable — a reviewer who cannot report a problem without
blocking their own branch has a reason to write a pass, and the gate would then be measuring
their willingness to let themselves through rather than what they found. A recorded problem is
attributable, carries a note, and sits in the diff for a person to read, which is a different
thing from one nobody ever looked for.

A removed PROOF SHALL be named as removed. It asks a different question from a touched
scenario — not whether the CLAIM still reads its PROOF honestly, but whether the PROMISE was
meant to die — and a reviewer given the wrong question answers the wrong one.

<!-- scenarios: generated -->
- "A change with every PROMISE judged is settled" → tests/review/pending.test.ts
- "A removed PROOF with no review is pending" → tests/review/pending.test.ts
- "A reported problem counts as judged" → tests/review/pending.test.ts
- "A scenario reviewed under an older KEY is pending again" → tests/review/pending.test.ts
- "A scenario with no review under its KEY is pending" → tests/review/pending.test.ts
<!-- /scenarios -->
