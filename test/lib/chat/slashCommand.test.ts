import { describe, expect, test } from 'vitest';
import type { SpaceCommand } from '@argon/glue';
import { resolveSlashCommand } from '@/lib/chat/slashCommand';

const command = (name: string, options: string[] = []): SpaceCommand => ({
  commandId: name, name, description: name, options: options.map((name) => ({ name })),
}) as SpaceCommand;

describe('commands resolved from composer text', () => {
  test('a pasted /play preserves the complete URL as its one option', () => {
    const play = command('play', ['query']);
    expect(resolveSlashCommand('/play https://example.com/watch?v=a&list=b', [play]))
      .toEqual({ cmd: play, options: [{ name: 'query', value: 'https://example.com/watch?v=a&list=b' }] });
    expect(resolveSlashCommand('/PLAY  a song with spaces', [play])?.options)
      .toEqual([{ name: 'query', value: 'a song with spaces' }]);
  });

  test('editing a picked command resolves the new name; prefixes and ordinary text do not invoke it', () => {
    const play = command('play', ['query']);
    const stop = command('stop');
    expect(resolveSlashCommand('/stop', [play, stop])?.cmd).toBe(stop);
    for (const text of ['/player url', 'text /play url', '//play url', '/unknown url']) {
      expect(resolveSlashCommand(text, [play, stop])).toBeNull();
    }
  });

  test('multiple named options support quoted values and omit unknown names', () => {
    expect(resolveSlashCommand('/queue query:"a song" mode:next unknown:value', [command('queue', ['query', 'mode'])])?.options)
      .toEqual([{ name: 'query', value: 'a song' }, { name: 'mode', value: 'next' }]);
  });

  test('picking a particular bot preserves it when two bots share a command name', () => {
    const first = command('play', ['query']);
    const picked = { ...first, commandId: 'other-bot-play' };
    expect(resolveSlashCommand('/play song', [first, picked], picked.commandId)?.cmd).toBe(picked);
    expect(resolveSlashCommand('/play song', [first, picked])?.cmd).toBe(first);
  });
});
