# Git

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere, including worktrees and an agent's merge; `apps/server/README.md` ("Git", "Worktrees") has the requests. The panel is `apps/client/src/shell/panels/GitPanel.tsx` and the conflict overlay `apps/client/src/conflicts`.

- A project folder holds one or more checkouts: the repository it is in, its initialized submodules, and the repositories sitting beside it one level down (`repos.ts`).
- The git panel has no active repository. The staged files say where a commit lands, so one message commits every repository that has something staged, and nothing staged with more than one repository changed is nothing to commit yet. The changes, the commit log and the counts in the header are every repository at once, and so are fetch, pull and push.
- What names a single repository (merge, rebase, stash, a branch, a pull request) sits on that repository's row in the list and in its own level of the branch menu, one level in, since `main` says nothing about which repository is on it. A folder with exactly one repository reads as the panel always did, chip and actions menu included.
- A conflict is worked out in the app and never through a marker in a file. The daemon hands over the three versions git holds in its index (`git.conflict`), and a resolution is written over the digest it was read at, so a file that moved since refuses instead of losing what moved it.
- The checkout says what stopped in it (`operation` on `git.status`), which is what opens the overlay again after a reload, on a second client and from a terminal that left a merge halfway. Finishing or taking one back is one verb (`git.operation`), and a worktree merge aborts through the very same call.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A pull only fast-forwards until a person says how a branch that moved on both sides comes together, since a merge commit nobody asked for is a commit to undo.
- An agent CLI may propose a resolution, one stretch at a time or over every file at once, and a proposal is an edit in the overlay: nothing is written to a file, staged or committed on an agent's word alone.
