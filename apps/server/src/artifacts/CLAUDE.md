# Output

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere.

- Bytes are read by artifact id and version id only (`artifact.get`, `bytes.read` kind `artifact`), and a file by its index, never by its name. `$RUIMTE_HOME/artifacts` is not one of `OPEN_FOLDERS` (`src/fs/machine-home.ts`), so no `fs.*`, `bytes.read` of a path or `GET /fs/file` reaches the register. A file's `name` is a label and the name Copy to project suggests, never a path on disk.
- Provenance is written by the daemon from the context of the call (the caller's chat, its active turn, its open task, its node, this machine) and never from an argument, so an agent cannot set or claim it.
- A publish never shows half: bytes go to `.staging` with fsync, the manifest is written, one `rename` moves the folder into place, and only then is `register.json` written durably. At every start staging is cleared and the register is rebuilt from the version folders there are, so a version renamed but not registered is registered.
- A save names a request id; the register keeps it per artifact, so a retry answers the version it already made. A full disk refuses with `disk-full` before or during the write and leaves older versions alone.
- Nothing deletes a version on its own and no retention rule is stored. Cleanup proposes at ask time, and a confirm removes exactly the versions a person sent, checked again: never the latest, a version copied into a project, or one a node is pinned to.
- An artifact node's reference (`artifact` on the node) is one person's on one machine, so it lives in the private overlay (`OVERLAY_FIELDS`, `packages/contracts/src/project-split.ts`) and never in the shared file; a teammate's copy of the node shows that it is not on their machine. A node pins a version only with `version`; the pins of every project the index knows are what cleanup leaves alone (`ProjectIndex.pinnedArtifactVersions`).
- Copy to project writes inside the project folder only, refuses an existing name (`wx`), and refuses a link on the way or at the target.
- Nothing of an artifact's content (titles, names, bytes) goes into an error, telemetry, a usage count or a push.
