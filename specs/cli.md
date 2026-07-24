# cli

The commands people and CI actually run.

Everything else in this tool is a library. This is where it becomes something you can put
in a build.

### Requirement: Checking never writes

The command that checks SHALL NOT modify any file.

A check that quietly fixed what it found would report success on a repo that was wrong
until the moment it ran. The build would go green and the committed files would go on
disagreeing with what was reviewed.

Writing back is a separate command, run on purpose.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: The exit code says what happened

The check SHALL exit zero when the tests and the committed files agree, and non-zero when
they do not.

A tool that cannot be configured or cannot read its inputs SHALL exit with a different
non-zero code than a spec that has drifted. CI needs to tell "your spec is wrong" apart
from "I could not run".

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: It runs in a conventional repo with no configuration

Running the check in a repo that keeps its capability files and its tests in the usual
places SHALL work with no configuration file present.

Both locations SHALL be configurable for repos that do it differently. Nothing else needs
setting: there is no compiler to point at and no project to build.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: Any answer can be given in a form a program can read

Every command SHALL be able to return its answer as JSON, carrying the same content as
the form written for a person.

The tree, the positions, and the failures are all things another tool will want — an
editor, a CI annotation, and in a later version an MCP server. Each of those should read
the same answer rather than parse the one meant for a terminal.

<!-- scenarios: generated -->
<!-- /scenarios -->
