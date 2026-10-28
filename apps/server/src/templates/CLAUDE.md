# Editor templates

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere.

- A person's templates live in `$RUIMTE_HOME/editor-templates.json` (0600), never in a project. Being under the home, no file request of a client reads or writes it.
- A project's templates live only in `.ruimte/templates.json`, which a team commits. It has no private twin: nothing in it is personal. `disabled` and `settings` are a person's and are never written there.
- Any client of the owner edits a person's templates, not only the local secret, since a template executes nothing. No template request is on a peer's list.
- A client reads and writes a project's templates only while it holds the project. `template.changed` for a project goes to the clients that hold it, for a person's to every client.
- Agents list and add new templates to the person's own set, and nothing else. `TemplateStore.addByAgent` marks the template (`addedBy`), changes and removes none, takes no project scope, and refuses a key that a template of the same kind and a shared language already has (`template-key-taken`), so an agent never shadows what a person relies on.- Templates execute nothing, and no template body is ever sent off the machine.
- Every write goes against the revision the client read (`rev-conflict`). The revision also moves on an edit made outside the store (a pull, a hand edit), found by the watcher or at the start of a write. Revisions count up from the start time of the daemon, so one never repeats after a restart.
- A file whose `version` is newer than this build is refused (`templates-too-new`) and left untouched, never set aside. `template.list` still answers a person's own templates when only the project file is too new, with `project: null` and `projectTooNew: true`; writes to that file stay refused. A file that is not JSON is set aside as `.corrupt-<timestamp>`.
- A file is read loose: a key or an entry this release does not read is written back as it was, in the place it was read. A save of a template changes only the fields it names, and the project file is written only when its text changes.
- The daemon checks the key, the length of the body and the languages itself (`template-check.ts`). It does not parse the snippet syntax of the body: the editor does, and drops what it cannot expand.
