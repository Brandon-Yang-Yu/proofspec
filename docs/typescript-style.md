# TypeScript readability rules

**Write code for the next person who reads it (including an AI) — clear on the
first read, no puzzles.** Priority order: readability > expressing correctness >
performance > so-called brevity; when they conflict, pick the version with fewer
concepts; **prefer explicit over implicit.** Anything "shorter but harder to
follow" is rejected. These rules always apply (imported by `CLAUDE.md`).

**Readability is a hard requirement, not a suggestion.** The test (and you can
prove it fails): **without running the code and without jumping elsewhere, can you
say in one glance what this does and what it returns?** If you have to guess, trace
line by line, or run it in your head to know the result — it fails, and that is a
blocker just like a failing test. Fix it until it reads clearly. Common offenders:
hiding simple logic behind an indirection that makes you guess the output
(`ops.map(fn => fn(3, 4))`), writing one function of a kind as an arrow and another
as `function`, or comments like "arrow function" that say nothing.

Code examples are in English, to match the letters and UI; the notes here are in
English too.

---

## 1. Names carry the weight

- Whole words, no abbreviations: `templateId` not `tid`; `document` not `doc`
  (unless it is an established domain short form).
- Booleans read as predicates: `isReady` / `hasPending` / `canEdit`.
- Functions are verbs, values are nouns: `resolveOp()` / `pendingOps`.
- Do not encode the type in the name (TS already has types): no `strName`,
  no `arrOps`.
- **A name's first duty is honesty**, description second. A side effect the name
  doesn't mention (overwriting an argument, mutating a global) breeds bugs — if
  `updatePageContent` actually overwrites destructively, call it
  `replacePageContent`.
- Kill magic numbers/strings: pull `86_400_000` out into `MILLISECONDS_PER_DAY` —
  readers can grep it and see the meaning at a glance.
- One word per concept: don't write `getUser()` and also `getUserInfo` /
  `getUserDetails` — the reader shouldn't have to guess whether they're the same
  thing.

## 2. Types are documentation — make illegal states unrepresentable

This is TS's biggest readability payoff over other languages. Use a **discriminated
union** instead of "a pile of optional fields plus boolean flags"; the branches
then explain themselves and are exhaustive:

```ts
// ✗ Reader has to work out which field combinations are valid
type Turn = { streaming?: boolean; reply?: string; error?: string; interrupted?: boolean }

// ✓ Every valid state visible at a glance; the type replaces the comment
type Turn =
  | { kind: 'streaming'; text: string }
  | { kind: 'done'; reply: string }
  | { kind: 'interrupted' }
  | { kind: 'error'; message: string }
```

Another common illegal state is an **illegal combination** — optional fields that
allow "neither / both" when that should never happen. Enumerate the valid
combinations with a union so the illegal ones can't be constructed:

```ts
// ✗ Allows "neither", which breaks "at least one"
type Contact = { name: Name; email?: EmailInfo; postal?: PostalInfo }

// ✓ Only three valid cases; "neither" cannot be constructed
type ContactInfo = EmailInfo | PostalInfo | [EmailInfo, PostalInfo]
```

- Export types close to what uses them.
- At boundaries (API / JSON parsing) take `unknown` and narrow; zero `any`
  internally.
- Type-only imports use `import type`: they are erased at runtime, breaking the
  type → runtime dependency cycle. **But it only breaks the *runtime* cycle — at
  typecheck time `tsc` still follows the type you borrowed into the target file
  and checks its `import`s too.** So a type shared across a boundary (like the
  front/back `/api` contract) must live in a **pure-type file that imports nothing
  itself**, and each side does `import type` on it. Otherwise the frontend (which
  has DOM types but no Node types) borrows a type from a backend file, `tsc`
  follows it all the way to `node:*`, and the typecheck fails.
- **Exhaustiveness via `assertNever`**: a `switch` on the tag with a `default`
  catch-all makes a missing case a compile error the moment a new variant is added;
  narrowing keeps each field visible only in the right branch:

```ts
function assertNever(x: never): never { throw new Error('unhandled: ' + JSON.stringify(x)) }

switch (turn.kind) {
  case 'streaming': return turn.text
  case 'done': return turn.reply
  case 'interrupted': return ''
  case 'error': return turn.message
  default: return assertNever(turn) // add a variant but miss a case ⇒ type error
}
```

- **Parse, don't validate**: at the boundary, parse `unknown` into a rich type once
  (e.g. a private constructor plus `create(): T | undefined`) so illegal values
  can't be constructed; once you hold the rich type it is already validated and the
  interior needs no defensive checks.
- **Don't write generics you won't understand in three months**: fancy
  conditional/mapped types are the type-level version of "short but hard to follow".
  Unless they remove a lot of duplication, use plain types.

## 3. Control flow: guard clauses and early returns, no nesting

Keep the happy path down the left edge, read straight through:

```ts
// ✗ Pyramid                        // ✓ Rule out the odd cases first; main line un-indented
if (doc) {                         if (!doc) return
  if (!inFlight) {                 if (inFlight) return
    ...                            ...
  }
}
```

## 4. Params ≤ 2–3, no boolean params

A call site like `resolve(id, true, false)` is unreadable; a boolean param also
means the function does two things. **More than 2–3 params, or any boolean switch,
becomes an options object with destructuring** — the call site explains itself and
TS warns on unused properties:

```ts
// ✗ resolve(op, true, false)
// ✓ resolve(op, { accept: true, scope: 'single' })
```

Use default parameters for defaults, not hand-written checks: `function build(opts
= {})` beats `opts = opts !== undefined ? opts : {}`.

## 5. Name the intermediate steps, don't show off with one-liners

One well-named `const` beats a triple-nested ternary or a point-free pipeline:

```ts
// ✗ return xs.filter(x => x.s === 'p').map(x => x.id).filter((v, i, a) => a.indexOf(v) === i)

// ✓
const pending = ops.filter(op => op.status === 'pending')
const pendingIds = unique(pending.map(op => op.id))
return pendingIds
```

## 6. Deep modules, narrow interfaces — but don't over-split

One function that "does a whole thing behind a small interface" beats five
one-line helpers you have to chase. **The bar for extracting is "it removes
duplication or lowers the cost of understanding", not "the function got shorter".**
Splitting into a pile of small functions that only work through side effects is the
thing these rules oppose most.

- **The falsifiable test**: can the extracted unit be tested on its own, apart from
  shared mutable state? If not, you're using member variables as a hidden channel
  to build a maze, not splitting a function.
- **"Deep" = amount of implementation ÷ size of interface** (a big capability
  behind a small interface). Don't cut modules along the "read → change → write"
  order of operations (temporal decomposition leaks one design decision across all
  of them).
- Full reasoning in `docs/reference/reading-notes.md` (Ousterhout / qntm).

## 7. Comments say WHY only

Code says "what it does"; a comment says "**why** it's done this way / here's a
trap".

```ts
// ✓ Writes must be serial: out of order would overwrite with stale innerHTML and revert the document
// ✗ loop over ops   ← noise, the code already says this
```

- Delete commented-out dead code — that's git's job; leaving it in the file just
  causes doubt.

## 8. Leave consistency to tools, not willpower

Formatting goes to Prettier, the style floor to typescript-eslint (`strict` plus
`stylistic`); there is one way to do each thing across the whole repo. Then reviews
stop arguing about style and all the attention goes to the logic.

- Write the same kind of thing the same way: don't make `add` an arrow and `mul` a
  `function` declaration — a style jump makes the reader think there's hidden
  meaning.
- Push mechanically-decidable readability into CI hard gates: eslint's `complexity`
  / `max-depth` / `no-nested-ternary` / `eqeqeq` (`===`) etc. fail the build when
  exceeded, so it doesn't rely on willpower.

## 9. Immutable by default

Don't mutate an incoming array/object in place — return a new copy; use `readonly`
wherever you can:

```ts
// ✗ cart.push(item)          ← mutated the argument, the caller gets ambushed
// ✓ const next = [...cart, item]
```

`readonly` / `ReadonlyArray<T>` / `as const` plus `strictNullChecks` pin down "what
must not change" at compile time; pure functions (output depends only on input) are
naturally testable and can be reasoned about locally.

## 10. Expected errors are values; `throw` is only for real exceptions

**An expected failure is part of the domain — return it as a value, encode it in
the type.** Validation failing, not found, a reconciliation FAIL, a business rule
broken: express these with a Result or a discriminated union so the caller is
forced by the type to branch and can't miss it. This is rule 2 ("make illegal
states unrepresentable") applied to errors, and it is more explicit than `throw`:
`throw` is invisible to the type system (the signature doesn't show what it throws,
and `catch (e)` is still `unknown`).

```ts
// ✗ Failure via throw: the signature is a lie, the caller isn't forced to handle it
function build(md: string): Docx { if (bad) throw new Error('reconcile failed'); /* ... */ }

// ✓ Failure is in the return type, the caller must branch
type BuildResult = { ok: true; docx: Docx } | { ok: false; reason: string }
function build(md: string): BuildResult { /* ... */ }
```

- Reserve `throw` for **true exceptions / programmer errors** (a broken invariant,
  an unwritable DB, a bug): fail fast and blow up.
- If you must throw, throw an `Error` (you want the stack), not a string; when you
  `catch`, don't swallow it and don't just `console.log` — handle it, rethrow, or
  send it to the logger.
- Boundaries (third-party libs, `JSON.parse`, `fetch`) throw by nature: catch once
  at the boundary and convert to your Result; don't let raw exceptions seep into
  the domain layer.
- One `{ ok }` discriminated union is enough — you don't need `neverthrow` /
  `Effect` up front; reach for a library only when you need stronger composition
  (chaining, async) (YAGNI).

---

## Further reading (by relevance)

> The full distillation of the four articles plus ts-reset is in
> `docs/reference/reading-notes.md` (archived, not in the always-loaded context).

- qntm, "It's probably time to stop recommending Clean Code" — the case against
  over-extraction: https://qntm.org/clean
- Ousterhout, notes on "A Philosophy of Software Design" (deep modules > a pile of
  shallow functions): https://bagerbach.com/books/a-philosophy-of-software-design/
- Krycho, "Making Illegal States Unrepresentable in TS" (the source of rule 2):
  https://v5.chriskrycho.com/journal/making-illegal-states-unrepresentable-in-ts/
- `labs42io/clean-code-typescript` (Bad/Good pairs — discount its "split functions
  as small as possible" advice as you read): https://github.com/labs42io/clean-code-typescript
- `mattpocock/ts-reset` (zero-ceremony, makes `JSON.parse` / `.filter(Boolean)`
  types more honest): https://github.com/mattpocock/ts-reset
