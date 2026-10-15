# Transport

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere.

- A link to a machine opens only for a hold (`transport/workspace-hold.ts`, `transport/remote-holds.ts` for the machines the nodes of the open project run on, `ensureMachine`, an open machine detail in settings or the usage page, and this machine while the desktop app shows the start screen) and closes 30 s after the last one. Nothing else may open one: not lists, status dots, auto-registration or limit bars. Clients sit on `machineTransport(id)`, which never opens a link.
- A node with a `machine` of its own draws from that machine: `NodeMachineScope` (`transport/node-machine.tsx`) gives everything in its frame that machine's transport and clients, while the project, the drawings and the diagrams stay the workspace's. Code with no subtree to ask uses `endpointOfNodeId` (`state/node-endpoint.ts`).
