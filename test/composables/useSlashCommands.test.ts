import { describe, expect, test, vi } from 'vitest';
import { effectScope, ref } from 'vue';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/store/system/apiStore', () => ({ useApi: () => ({ botManagementInteraction: { GetSpaceCommands: mocks.get } }) }));
import { useSlashCommands } from '@/composables/useSlashCommands';

describe('space command loading', () => {
  test('concurrent lookups share a request and a late response cannot replace the next space commands', async () => {
    const pending = new Map<string, (value: any[]) => void>();
    mocks.get.mockImplementation((sid: string) => new Promise((resolve) => pending.set(sid, resolve)));
    const sid = ref('first');
    const scope = effectScope();
    const commands = scope.run(() => useSlashCommands(() => sid.value))!;
    const first = commands.fetchCommands();
    const duplicate = commands.fetchCommands();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    sid.value = 'second';
    const second = commands.fetchCommands();
    const current = [{ commandId: '2', name: 'stop', description: '', options: [] }];
    pending.get('second')!(current);
    await second;
    pending.get('first')!([{ commandId: '1', name: 'play', description: '', options: [] }]);
    await Promise.all([first, duplicate]);
    expect(commands.commands.value).toEqual(current);
    expect(commands.isLoading.value).toBe(false);
    scope.stop();
  });
});
