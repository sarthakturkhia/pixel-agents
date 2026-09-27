import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Which Claude Code sessions are still running, and which ones to show.
 *
 * Claude Code keeps one file per running session in `~/.claude/sessions/<pid>.json`
 * (`{ pid, sessionId, cwd, ... }`). A transcript whose session has no entry with a
 * live pid belongs to a session that has ended, even if its JSONL was written a
 * moment ago. The registry is a Claude Code implementation detail, so when it
 * can't be read every check here answers "unknown" and callers keep their
 * existing behavior.
 */

interface LiveSession {
  pid: number;
  cwd: string;
}

const DEFAULT_REGISTRY_DIR = path.join(os.homedir(), '.claude', 'sessions');

/** Null until the standalone CLI turns the check on, so the VS Code host and tests keep the old behavior. */
let registryDir: string | null = null;
let scopeDir: string | null = null;

/** Only show sessions whose working directory is inside `dir` (the `--only` flag). */
export function setSessionScope(dir: string | null): void {
  scopeDir = dir ? path.resolve(dir) : null;
}

/** Turn on the running-session check, reading the registry from `dir`. */
export function enableLiveSessionCheck(dir: string = DEFAULT_REGISTRY_DIR): void {
  registryDir = dir;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** sessionId -> live session, or null when the registry can't be read. */
function readLiveSessions(): Map<string, LiveSession> | null {
  if (!registryDir) return null;
  const dir = registryDir;
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }
  const live = new Map<string, LiveSession>();
  for (const file of files) {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as {
        pid?: unknown;
        sessionId?: unknown;
        cwd?: unknown;
      };
      if (typeof entry.pid !== 'number' || typeof entry.sessionId !== 'string') continue;
      if (!isPidAlive(entry.pid)) continue;
      live.set(entry.sessionId, {
        pid: entry.pid,
        cwd: typeof entry.cwd === 'string' ? entry.cwd : '',
      });
    } catch {
      /* unreadable or half-written entry: skip it */
    }
  }
  // No live entries at all means the registry format isn't what we expect
  // (this server is normally watching at least one running session).
  return live.size > 0 ? live : null;
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * False when we know the transcript's session should not be shown: it has
 * ended, or it runs outside the `--only` folder. True otherwise, including
 * whenever the registry is unavailable.
 */
export function shouldShowSession(jsonlFile: string): boolean {
  return shouldShowSessionId(path.basename(jsonlFile, '.jsonl'));
}

/** `shouldShowSession` for a session id rather than its transcript path. */
export function shouldShowSessionId(sessionId: string): boolean {
  const live = readLiveSessions();
  if (!live) return true;
  const session = live.get(sessionId);
  if (!session) return false;
  if (scopeDir && session.cwd && !isInside(session.cwd, scopeDir)) return false;
  return true;
}
