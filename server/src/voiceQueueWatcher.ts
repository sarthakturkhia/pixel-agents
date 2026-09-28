/**
 * Who has the voice channel, and who is waiting for it.
 *
 * VoiceMode lets one session speak or listen at a time (the "conch"). Its state
 * lives on disk: `~/.voicemode/conch` names the holder, and
 * `~/.voicemode/conch.queue.d/*.json` holds one file per waiting session. Both
 * carry the session's `project_path` (its working folder). A wake-word listener
 * can also drop `~/.pixel-agents/voice-wake.json` ({ project_path, at }) the
 * moment it hears a desk's name, before that desk has even asked for the mic.
 *
 * This module reads those files and maps each folder to an agent, so the office
 * can put the speaker in the Founder area and line the others up outside it.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { VoiceQueue } from '../../core/src/messages.js';

/** A wake-word ping counts as "waiting" for this long unless that agent gets the mic first. */
export const WAKE_WAIT_MS = 90_000;

export interface VoiceQueueFiles {
  /** Folder of the session holding the mic, or null. */
  speakingPath: string | null;
  /** Folders waiting for the mic, first in line first. */
  waitingPaths: string[];
  /** Latest wake-word ping, if any. */
  wake: { path: string; at: number } | null;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pidAlive(pid: unknown): boolean {
  if (typeof pid !== 'number') return true; // remote waiter: trust its own expiry
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function notExpired(expires: unknown, nowMs: number): boolean {
  if (typeof expires !== 'string') return true;
  const t = Date.parse(expires);
  return Number.isNaN(t) || t > nowMs;
}

/** Read VoiceMode's conch and queue, and the wake-word ping. Missing files mean "nobody". */
export function readVoiceQueueFiles(home = os.homedir(), nowMs = Date.now()): VoiceQueueFiles {
  const vm = path.join(home, '.voicemode');

  let speakingPath: string | null = null;
  const holder = readJson(path.join(vm, 'conch'));
  if (
    holder &&
    typeof holder.project_path === 'string' &&
    pidAlive(holder.pid) &&
    notExpired(holder.expires, nowMs)
  ) {
    speakingPath = holder.project_path;
  }

  const waiters: Array<{ seq: number; path: string }> = [];
  const queueDir = path.join(vm, 'conch.queue.d');
  let names: string[] = [];
  try {
    names = fs.readdirSync(queueDir).filter((n) => n.endsWith('.json'));
  } catch {
    // no queue yet
  }
  for (const name of names) {
    const w = readJson(path.join(queueDir, name));
    if (!w || typeof w.project_path !== 'string') continue;
    if (!pidAlive(w.pid) || !notExpired(w.expires, nowMs)) continue;
    waiters.push({ seq: Number(w.seq) || 0, path: w.project_path });
  }
  waiters.sort((a, b) => a.seq - b.seq);

  let wake: VoiceQueueFiles['wake'] = null;
  const ping = readJson(path.join(home, '.pixel-agents', 'voice-wake.json'));
  if (ping && typeof ping.project_path === 'string' && typeof ping.at === 'number') {
    wake = { path: ping.project_path, at: ping.at };
  }

  return { speakingPath, waitingPaths: waiters.map((w) => w.path), wake };
}

/** Claude Code names a session's project dir after its folder, with every non-alphanumeric as '-'. */
export function encodeProjectPath(folder: string): string {
  return folder.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Turn the files into agent ids. `agents` gives each agent's Claude project dir
 * (e.g. ~/.claude/projects/-Users-me-repo-team-finance). `consumedWakeAt` is the
 * `at` of a wake ping whose agent already got the mic, so it no longer counts.
 */
export function toVoiceQueue(
  files: VoiceQueueFiles,
  agents: Iterable<{ id: number; projectDir: string }>,
  nowMs: number,
  consumedWakeAt: number | null,
): VoiceQueue {
  const byDir = new Map<string, number>();
  for (const a of agents) {
    const key = path.basename(a.projectDir);
    if (!byDir.has(key)) byDir.set(key, a.id);
  }
  const idOf = (folder: string) => byDir.get(encodeProjectPath(folder));

  const speakingId = files.speakingPath ? (idOf(files.speakingPath) ?? null) : null;
  const order: number[] = [];
  for (const p of files.waitingPaths) {
    const id = idOf(p);
    if (id !== undefined && id !== speakingId && !order.includes(id)) order.push(id);
  }
  const w = files.wake;
  if (w && w.at !== consumedWakeAt && nowMs - w.at < WAKE_WAIT_MS) {
    const id = idOf(w.path);
    if (id !== undefined && id !== speakingId && !order.includes(id)) order.push(id);
  }
  return {
    type: 'voiceQueue',
    speakingId,
    waiting: order.map((id, i) => ({ id, position: i + 1 })),
  };
}
