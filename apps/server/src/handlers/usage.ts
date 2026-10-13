import { usageHandlers } from '@adecore/agents/host';
import type { UsageMonitor, UsageService } from '@adecore/agents/usage';
import type { Dispatcher } from '../dispatcher.ts';
import { registerAgentHandlers } from './agent.ts';

export function registerUsageHandlers(dispatcher: Dispatcher, usage: UsageService, limits: UsageMonitor): void {
    registerAgentHandlers(dispatcher, usageHandlers(usage, limits));
}
