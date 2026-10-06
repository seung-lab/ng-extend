import { secureWrite } from './secure_write';
export async function taskAction(action: 'claim' | 'claim_cell' | 'release' | 'complete' | 'heartbeat' | 'save_link' | 'set_anchor', args: Record<string, unknown>) {
  return secureWrite('pilot.task', { operation: action, args });
}
export async function practiceAction(action: 'claim' | 'heartbeat' | 'begin_reset' | 'check_reset' | 'finish_reset', args: Record<string, unknown>) {
  return secureWrite('pilot.practice', { operation: action, args });
}
