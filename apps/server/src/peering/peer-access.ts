import type { PeerLink } from '@ruimte/contracts';
import { RequestError, type ClientConnection } from '../dispatcher.ts';
import type { PeerLinks } from './links.ts';

/*
 * The links a person made here for the machine behind this client. Every `peer.*` request starts with
 * this: being let in as a peer grants nothing, and without a link the machine gets `peer-not-linked`.
 * A client that is not a peer never reaches a peer request, since the dispatcher refuses it first.
 */
export function requirePeerLinks(client: ClientConnection, links: Pick<PeerLinks, 'list'>): Array<Omit<PeerLink, 'projectName'>> {
    const machineId = client.access?.peer?.machineId;
    const own = machineId === undefined ? [] : links.list().filter((link) => link.machineId === machineId);
    if (own.length === 0) {
        throw new RequestError('peer-not-linked', 'No project here is linked to this machine');
    }
    return own;
}
