import { RequestError, type ClientConnection } from '../dispatcher.ts';
import type { PeerLinks } from './links.ts';

/*
 * The machine behind this client, once a person here linked a project to it. Every `peer.*` request starts with
 * this: being let in as a peer grants nothing, and without a link the machine gets `peer-not-linked`.
 * A client that is not a peer never reaches a peer request, since the dispatcher refuses it first.
 */
export function requirePeerLinks(client: ClientConnection, links: Pick<PeerLinks, 'list'>): string {
    const machineId = client.access?.peer?.machineId;

    if (machineId === undefined || !links.list().some((link) => link.machineId === machineId)) {
        throw new RequestError('peer-not-linked', 'No project here is linked to this machine');
    }

    return machineId;
}
