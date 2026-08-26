# Handoff: vocabulary underscore, near-form WARN, description axis

Three tasks in dependency order: R3 → R2 → R1. Each one re-keys this repo's own
promises (the term axis or the description axis fires), so each ends with a
re-judging round under a fresh reviewer identity. Baseline before starting:
275 tests green, `check` pass, `touched` exit 0.

## Why (found while reviewing the glossary-adoption merge)

1. `touched`'s second axis only knows TERM changes. Rewriting a requirement's
   **description** moves every scenario key under it (keying folds the
   description in — `review.md` "A KEY says what it is for" says so in prose),
   but re-opening does not fire. Measured on a clean tree (`--since HEAD`,
   one description reworded): `requirements reached: 0`, gate exit 0. The
   promises changed meaning with no review asked for. §34's argument for the
   term axis applies to descriptions word for word; only the term layer was
   built.
2. §34 deferred a WARN for a definition spelling a defined TERM in a near
   form, because this repo's own prose was lowercase everywhere. The adoption
   worktree (merged as 58c4b81) removed that excuse: spec text now uses the
   exact forms or avoids the words.
3. Multi-word TERM names (`PROOF SITE`, `CAPABILITY FILE`) are ambiguous to a
   reader and make near-form detection noisy — `proof site` is ordinary
   English. Underscores make one TERM one token and near-form detection exact.

## R3 — phrase TERM words joined by underscores

specs: `glossary.md` (new requirement, below) + `guard.md` (tighten the
capitals rule).

- Rename in `specs/` and `tests/` Gherkin + `// Requirement:`/`// Scenario:`
  tags: `PROOF SITE` → `PROOF_SITE`, `CAPABILITY FILE` → `CAPABILITY_FILE`.
  README and `docs/` stay as they are (decided: prose about the tool does not
  adopt the vocabulary). Fixture Gherkin inside template literals stays as-is
  where it is deliberate; code identifiers do not change.
- Guard rule (`src/guard/guard.ts` termFindings): names must match
  `/^[A-Z]+(?:_[A-Z]+)*$/` — spaces no longer allowed in a TERM name.
- The matcher needs no change: `wholeWord` in `src/glossary/use.ts` uses
  `(?<![\w])…(?![\w])`, and `_` is a word character, so `PROOF_SITE` is
  already one whole word.
- The rename is itself a term-axis change (old TERM gone + new TERM new), so
  the gate will go red on its own after `write` + re-judge. Reviewer identity:
  `underscore-review`.

Gherkin:

```gherkin
### Requirement: The words of a phrase TERM are joined by underscores

A TERM of more than one word SHALL join its words with underscores — PROOF_SITE —
so that one TERM is one token: a reader can tell a defined word from two words
standing beside each other, and the matcher can treat it as a single whole word
with no rule of its own.

# Scenario: A TERM heading that spaces its words fails the build
# GIVEN a vocabulary whose TERM is named PROOF SITE with a space
# WHEN the guard runs
# THEN the build fails naming the TERM, because two capitals standing beside each
#      other are indistinguishable from ordinary emphasis, and the form is what
#      makes a TERM self-evident

# Scenario: A phrase TERM joined by underscores is one word to the matcher
# GIVEN a PROMISE whose STANDARD writes PROOF_SITE, and a text beside it writing
#      PROOF SITE
# WHEN the terms each is found to use are asked for
# THEN the first uses the TERM and the second does not, because PROOF_SITE is one
#      whole word and PROOF SITE is two words and no term at all
```

## R2 — near-form spelling in a definition warns

specs: `guard.md`. Finding kind `term-near-form`, severity WARN (build passes).

Rule: inside a TERM's definition, a whole-word match of a defined TERM's
**bare lowercase singular** (e.g. `claim` where CLAIM is defined) → WARN naming
the TERM and the everyday spelling. Deliberately NOT matched: plurals
(`claims`, `proofs`) — they may be verbs or ordinary plurals, and stemming is
a guess about English. This repo's own vocabulary self-checks clean under
this rule: the only lowercase hit anywhere is "claims" in PROOF SITE's
definition, which is a verb and correctly outside the rule.

Gherkin:

```gherkin
### Requirement: A TERM's definition spells a defined TERM in a near form only at the risk of losing the edge

The guard SHALL warn, without failing the build, when a TERM's definition spells
another defined TERM in its everyday form, naming the TERM and the everyday
spelling. The edges of the vocabulary live only in the exact form, so a
paraphrase cuts an edge the machine still believes in — the warning is where
that becomes visible.

# Scenario: A definition writing a defined TERM in its everyday form warns
# GIVEN a vocabulary whose definition of PROOF_SITE writes claim where CLAIM is defined
# WHEN the guard runs
# THEN a warning names the definition and the everyday spelling and the build still
#      passes, because the reviewer reading the changed definition's then and now is
#      the backstop, and the warning tells them where to look

# Scenario: A verb sharing the TERM's spelling is not a near form
# GIVEN a definition that says "one place that claims to prove"
# WHEN the guard runs
# THEN nothing is reported, because verbs are everyday English and the guard does
#      not stem
```

(After R3, PROOF SITE in these examples becomes PROOF_SITE.)

## R1 — a changed description counts as a change the tests did not make

specs: `cli.md`, beside "A changed TERM counts as a change the tests did not
make". This is the main body of work.

Implementation notes (verified against `src/cli/run.ts`):

- `reachedBy` already reads changed spec files (`readChangedFiles` with
  `specsDir`, then `changedTermsSince` reads the base version via
  `readFileAt`). Extend the same path: `readCapabilityFile` on both base and
  working versions of each changed file, compare each requirement's
  description by identity (capability + requirement name), produce
  `DescriptionChange { before, after }`.
- A requirement that exists only in the working version counts as changed
  (its scenarios have fresh keys and no judgements; entering the work list is
  the honest behavior, symmetric with a new TERM re-opening its users).
- Re-opening covers **every** scenario under the requirement (the description
  is the STANDARD of each of them) — not a "which words does it use" walk.
  Route through the existing `reopenedInto`.
- Report shape: today `ScenarioReach.reopenedBy` carries `TermChange[]`.
  Either generalize to `readonly (TermChange | DescriptionChange)[]` or add a
  `changed: 'description'` state — the session decides; Gherkin constrains
  behavior only. The requirement report should carry the description then and
  now for scenarios it re-opened.

Gherkin:

```gherkin
### Requirement: A changed description counts as a change the tests did not make

The work list SHALL count the PROMISE a changed description re-opened exactly as
it counts the PROMISE a changed test or a changed TERM reached — the same
shapes, the same gate — by comparing each requirement's description against the
same base revision the tests are measured from.

The description is the STANDARD every scenario under the requirement is judged
against, and keying already folds it into every key under it: a reworded
description is a different question being asked of every scenario, and every
judgement made under the old wording is worth taking again. Reading the change
and not re-opening would let a branch change what its PROMISE mean with the
gate silent.

# Scenario: A reworded description's PROMISE are in the work list and hold the gate
# GIVEN a repo committed in sync whose capability file then rewords one requirement's
#       description while the tests do not move a line
# WHEN the work list is asked for
# THEN the requirement is in it with every scenario of it pending, and the gate stays
#      shut, because the tests changing was never the only way a PROMISE could change
#      what it means

# Scenario: A scenario re-opened by a description carries the wording then and now
# GIVEN the same repo, with one of its re-opened promises fetched by address
# WHEN the requirement is read
# THEN each scenario carries the description the base revision held and the one that
#      stands now, because the distance the wording moved is the whole of what the
#      reviewer was asked

# Scenario: A description the change left byte for byte unchanged re-opens nothing
# GIVEN a capability file whose requirements moved or were reordered since the base
#       revision with no description text changing
# WHEN the work list is asked for
# THEN no PROMISE under it is pending, because a description moved is the same
#      description

# Scenario: A PROMISE both a description change and a test change reached is gathered once
# GIVEN a repo whose capability file rewords one requirement's description while a line
#       of one of its tests also moves
# WHEN the requirement is fetched by address
# THEN the scenario whose test moved is gathered once carrying both what moved and the
#      description it is now judged under, because it is one PROMISE and one judgement
#      settles it
```

## Working rules (same as the adoption session)

- `pnpm test` before and after every capability's edits; edit → `write` →
  `check` → vitest loop per capability.
- All Gherkin in English; `// Requirement:` tags must match spec headings
  exactly or the guard fails.
- Conventional commits with scope. Reviewer identities per round: R3
  `underscore-review`, R2 (if it re-keys anything) `near-form-review`, R1
  `standard-axis-review`.
- Judging loop: `pnpm proofspec touched --requirement <addr>` → read claim +
  proof lines → `pnpm proofspec review <key> --verdict ok --proves <line>
  --by <who>`; gone/re-keyed promises take `--verdict drift --note <where it
  went>`.
- Archive to `design.md` when done (§36), then merge to main.
