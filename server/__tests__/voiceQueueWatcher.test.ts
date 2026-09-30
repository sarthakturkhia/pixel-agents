import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatToolStatus } from '../src/providers/hook/claude/claude.js';
import {
  encodeProjectPath,
  readVoiceQueueFiles,
  toVoiceQueue,
  WAKE_WAIT_MS,
} from '../src/voiceQueueWatcher.js';

const REPO = '/Users/me/shirtbox/team';
const agents = [
  { id: 1, projectDir: `/Users/me/.claude/projects/${encodeProjectPath(`${REPO}/admin`)}` },
  { id: 2, projectDir: `/Users/me/.claude/projects/${encodeProjectPath(`${REPO}/finance`)}` },
  { id: 3, projectDir: `/Users/me/.claude/projects/${encodeProjectPath(`${REPO}/marketing`)}` },
];

describe('voiceQueueWatcher', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-'));
    fs.mkdirSync(path.join(home, '.voicemode', 'conch.queue.d'), { recursive: true });
    fs.mkdirSync(path.join(home, '.pixel-agents'), { recursive: true });
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  const write = (rel: string, data: unknown) =>
    fs.writeFileSync(path.join(home, rel), JSON.stringify(data));

  it('reports nobody when there are no files', () => {
    fs.rmSync(path.join(home, '.voicemode'), { recursive: true });
    expect(readVoiceQueueFiles(home)).toEqual({
      speakingPath: null,
      waitingPaths: [],
      wake: null,
      standup: false,
    });
  });

  it('reads the holder and orders waiters by seq', () => {
    write('.voicemode/conch', { pid: process.pid, project_path: `${REPO}/admin`, held: false });
    write('.voicemode/conch.queue.d/2-b.json', {
      seq: 2,
      pid: process.pid,
      project_path: `${REPO}/marketing`,
    });
    write('.voicemode/conch.queue.d/1-a.json', {
      seq: 1,
      pid: process.pid,
      project_path: `${REPO}/finance`,
    });
    const files = readVoiceQueueFiles(home);
    expect(files.speakingPath).toBe(`${REPO}/admin`);
    expect(files.waitingPaths).toEqual([`${REPO}/finance`, `${REPO}/marketing`]);
    expect(toVoiceQueue(files, agents, Date.now(), null)).toEqual({
      type: 'voiceQueue',
      standup: false,
      speakingId: 1,
      waiting: [
        { id: 2, position: 1 },
        { id: 3, position: 2 },
      ],
    });
  });

  it('ignores an expired hold and dead waiters', () => {
    write('.voicemode/conch', {
      pid: process.pid,
      project_path: `${REPO}/admin`,
      held: true,
      expires: new Date(Date.now() - 1000).toISOString(),
    });
    write('.voicemode/conch.queue.d/1-a.json', {
      seq: 1,
      pid: 999999,
      project_path: `${REPO}/finance`,
    });
    expect(readVoiceQueueFiles(home)).toMatchObject({ speakingPath: null, waitingPaths: [] });
  });

  it('counts a fresh wake ping as waiting until that agent gets the mic', () => {
    const now = Date.now();
    write('.pixel-agents/voice-wake.json', { project_path: `${REPO}/marketing`, at: now - 1000 });
    const files = readVoiceQueueFiles(home, now);
    expect(toVoiceQueue(files, agents, now, null).waiting).toEqual([{ id: 3, position: 1 }]);
    // Used up once marketing has spoken, and stale after WAKE_WAIT_MS.
    expect(toVoiceQueue(files, agents, now, now - 1000).waiting).toEqual([]);
    expect(toVoiceQueue(files, agents, now + WAKE_WAIT_MS, null).waiting).toEqual([]);
  });

  it('never lists the speaker as waiting', () => {
    const files = {
      speakingPath: `${REPO}/finance`,
      waitingPaths: [`${REPO}/finance`],
      wake: { path: `${REPO}/finance`, at: Date.now() },
    };
    expect(toVoiceQueue(files, agents, Date.now(), null)).toMatchObject({
      speakingId: 2,
      waiting: [],
    });
  });
});

describe('stand-up flag', () => {
  it('is on while standup.json is active and not past its end', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-'));
    fs.mkdirSync(path.join(home, '.pixel-agents'), { recursive: true });
    const f = path.join(home, '.pixel-agents', 'standup.json');
    const now = Date.now();
    fs.writeFileSync(f, JSON.stringify({ active: true, until: now + 60_000 }));
    expect(readVoiceQueueFiles(home, now).standup).toBe(true);
    fs.writeFileSync(f, JSON.stringify({ active: true, until: now - 1 }));
    expect(readVoiceQueueFiles(home, now).standup).toBe(false);
    fs.writeFileSync(f, JSON.stringify({ active: false }));
    expect(readVoiceQueueFiles(home, now).standup).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe('SendMessage status', () => {
  it('names the recipient', () => {
    expect(formatToolStatus('SendMessage', { to: 'marketing-33', message: 'hi' })).toBe(
      'Messaging marketing-33',
    );
    expect(formatToolStatus('SendMessage', {})).toBe('Messaging');
  });
});
