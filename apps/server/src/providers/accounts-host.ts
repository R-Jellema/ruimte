import type { AccountsHost } from '@adecore/agents/providers';

// The keychain prefix names where every sensitive value a person saved already sits; changing it loses them.
export const RUIMTE_ACCOUNTS_HOST: AccountsHost = { name: 'Ruimte', variablePrefixes: ['RUIMTE_'], keychainPrefix: 'ruimte' };
