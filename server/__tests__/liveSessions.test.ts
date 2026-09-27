import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  enableLiveSessionCheck,
  setSessionScope,
  shouldShowSession,
  shouldShowSessionId,
} from '../src/liveSessions.js';

// A pid that is never running: above the default macOS and Linux pid limits.
const DEAD_PID = 99_999_999;

describe('liveSessions', () => {
  let registry: string;

  function register(file: string, entry: Record<string, unknown>): void {
    fs.writeFileSync(path.join(registry, file), JSON.stringify(entry));
  }

  beforeEach(() => {
    registry = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-sessions-'));
    enableLiveSessionCheck(registry);
    setSessionScope(null);
    register('self.json', {
      pid: process.pid,
      sessionId: 'live-in-team',
      cwd: '/work/shop/team/finance',
    });
    register('home.json', { pid: process.pid, sessionId: 'live-at-home', cwd: '/home/me' });
    register('dead.json', { pid: DEAD_PID, sessionId: 'ended', cwd: '/work/shop/team/finance' });
  });

  afterEach(() => {
    setSessionScope(null);
    fs.rmSync(registry, { recursive: true, force: true });
  });

  it('shows running sessions and hides ended or unknown ones', () => {
    expect(shouldShowSession('/p/live-in-team.jsonl')).toBe(true);
    expect(shouldShowSession('/p/ended.jsonl')).toBe(false);
    expect(shouldShowSessionId('never-registered')).toBe(false);
  });

  it('hides running sessions outside the --only folder', () => {
    setSessionScope('/work/shop');
    expect(shouldShowSessionId('live-in-team')).toBe(true);
    expect(shouldShowSessionId('live-at-home')).toBe(false);
  });

  it('keeps the old behavior when the registry is missing or has no live entries', () => {
    enableLiveSessionCheck(path.join(registry, 'missing'));
    expect(shouldShowSessionId('anything')).toBe(true);

    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-sessions-empty-'));
    fs.writeFileSync(
      path.join(empty, 'dead.json'),
      JSON.stringify({ pid: DEAD_PID, sessionId: 'x' }),
    );
    enableLiveSessionCheck(empty);
    expect(shouldShowSessionId('x')).toBe(true);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
