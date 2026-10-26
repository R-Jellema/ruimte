import { isIPv4, isIPv6 } from 'node:net';

/*
 * Cloudflare's published ranges, from https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
 * (checked 2026-09-15). They change rarely; a range missing here only means a client behind that edge
 * is counted against the edge's address, never that a header is believed from someone else.
 */
const CLOUDFLARE_RANGES = [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32'
] as const;

function ipv4Bits(address: string): bigint {
    return address.split('.').reduce((bits, part) => (bits << 8n) | BigInt(Number(part)), 0n);
}

/* The eight groups of an IPv6 address, `::` and a trailing IPv4 part spelled out. */
export function ipv6GroupsOf(address: string): number[] {
    const groupsIn = (part: string): number[] =>
        part === ''
            ? []
            : part.split(':').flatMap((group) => {
                  if (!group.includes('.')) {
                      return [Number.parseInt(group, 16)];
                  }
                  const [a = 0, b = 0, c = 0, d = 0] = group.split('.').map(Number);
                  return [a * 256 + b, c * 256 + d];
              });
    const [head = '', tail] = address.split('::');
    const front = groupsIn(head);
    if (tail === undefined) {
        return front;
    }
    const back = groupsIn(tail);
    return [...front, ...Array<number>(8 - front.length - back.length).fill(0), ...back];
}

function ipv6Bits(address: string): bigint {
    return ipv6GroupsOf(address).reduce((bits, group) => (bits << 16n) | BigInt(group), 0n);
}

interface Range {
    family: 4 | 6;
    network: bigint;
    mask: bigint;
}

function rangeOf(cidr: string): Range {
    const [address = '', prefixText = ''] = cidr.split('/');
    const family = isIPv4(address) ? 4 : 6;
    const width = family === 4 ? 32n : 128n;
    const prefix = BigInt(Number(prefixText));
    const mask = ((1n << prefix) - 1n) << (width - prefix);
    const bits = family === 4 ? ipv4Bits(address) : ipv6Bits(address);
    return { family, network: bits & mask, mask };
}

const RANGES = CLOUDFLARE_RANGES.map(rangeOf);

/* Whether an address belongs to Cloudflare's edge; an IPv4-mapped IPv6 address counts as its IPv4 half. */
export function isCloudflareAddress(address: string): boolean {
    const plain = address.startsWith('::ffff:') && isIPv4(address.slice('::ffff:'.length)) ? address.slice('::ffff:'.length) : address;
    const family = isIPv4(plain) ? 4 : isIPv6(plain) ? 6 : null;

    if (family === null) {
        return false;
    }

    const bits = family === 4 ? ipv4Bits(plain) : ipv6Bits(plain);

    return RANGES.some((range) => range.family === family && (bits & range.mask) === range.network);
}
