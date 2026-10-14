# Panels

The rules behind the git panel (`GitPanel.tsx`, `GitFileList.tsx`, `GitDialogs.tsx`, `git-actions.ts`) are the daemon's: which checkouts a folder holds, how one message commits every repository with something staged, how a conflict is worked out and when a pull only fast-forwards. They sit in `apps/server/src/git/CLAUDE.md`; read it before changing what the panel shows or sends.
