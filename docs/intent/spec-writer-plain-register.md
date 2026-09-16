# spec-writer-plain-register — spec prose a first-time reader can follow

## The problem

The repo's spec prose is dense. Sentences carry three ideas between two em-dashes. Words
are chosen for precision inside long clauses. The people who read it easily are the
people who wrote it. A reader coming cold pays for every nested clause.

The spec writer's own rule points the wrong way: "the register you write in is the one
already on the page" (`.pi/agents/spec-writer.md`, "How you work"). Written into every
existing spec, that rule copies the density forward onto every new and rewritten row.

## The change

1. `.pi/agents/spec-writer.md` — add a readability bar to the prose discipline, as rules
   a reader can check, not an aspiration:
   - The bar: a reader who is not a programmer and was not in the conversation can
     follow every sentence on first reading. Defined TERMS are the only words allowed to
     carry technical weight, each in its exact form. File names, field names, and
     numbers stay as they are — they are labels, not difficulty.
   - One idea per sentence. A sentence with two em-dash clauses is two sentences.
   - Everyday words. A technical word appears only when its exact name matters, and then
     in its exact form.
   - Say the mechanism first — who does what, with what input, producing what — then the
     why, if the why is still needed after the mechanism is on the page.
   - No decoration: no metaphor for its own sake, no aphorism doing an argument's job.
2. The same file's register sentences change direction. New prose does not copy its
   neighbors' density: "the register the surrounding spec already uses" becomes the
   plain register named above. The frontmatter description moves with it.
3. `.pi/agents/investigator.md`: intent docs are written at the same bar. The executor
   reads them cold, on a branch, with none of the conversation behind it.
4. `docs/design.md`, in the section that records the spec writer: record the register
   decision. Plain first-read English is the register every new spec prose in this repo
   writes at; the older dense prose is history to read past, not a target to match.

## Done means

- `spec-writer.md` carries the bar as checkable rules, and no sentence in it points at
  the neighbors' density as the register to copy.
- `investigator.md` names the same bar for intent docs.
- `design.md` records the register decision.
- `pnpm test` green; the docket reports this TASK mergeable.
