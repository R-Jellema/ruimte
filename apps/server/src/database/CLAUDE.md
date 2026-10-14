# Databases

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere; `apps/server/README.md` ("Databases") has the files, the helper and the passwords, and the verb is `apps/server/src/canvas/database-verb.ts`.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- Agents read a project's databases through `ruimte-context database`, read only by default: one SELECT or WITH statement through `page` on a session opened read only, and a SQLite file only inside the project folder.
- Writing (`execute`) is only on a connection a person on this machine set to write, kept under `$RUIMTE_HOME/database-access` and never in the project (`agent-access.ts`), and never from `supervised`.
- The daemon holds a connection's password only in memory, handed over by a client of the project and bound to where the connection pointed then, and drops it when the last client lets the project go (`agent-passwords.ts`).
