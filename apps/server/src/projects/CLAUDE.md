# Project, drawing and diagram files

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere, including the two project files and who closes a project.

- A drawing or diagram file follows its view between `.ruimte/<kind>s/` and `.ruimte/private/<kind>s/`, so a private drawing never sits in git either.
- A project file whose `version` is newer than this build is refused (`project-too-new`) and left untouched, never set aside as `.corrupt`. Same for a drawing and a diagram.
- A project is held by the clients that have it open (`ProjectHolds`), for as long as their socket lives. `closedAt` in the registry is the machine's own fact, which the sidebar an agent reads is filtered on.
- Closing (`ProjectStore.closeProject`) ends the sessions the project's document holds, read off the index, so a project nobody has on screen closes the same way.
