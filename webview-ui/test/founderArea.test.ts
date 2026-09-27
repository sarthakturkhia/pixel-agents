/**
 * Unit tests for the Founder and Helpers areas: a character on a voice call
 * walks to the Founder area, only one character talks at a time, a finished
 * call lets the character linger briefly and then leave, and wandering
 * characters stay out of Areas that aren't theirs.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { TALK_LINGER_SEC } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

const VOICE_TOOL = 'mcp__plugin_voicemode_voicemode__converse';
const COLS = 12;
const ROWS = 8;

/** All floor, no furniture. Cols 0-3 are "Finance", cols 8-11 "Founder", the middle is open. */
function areaLayout(): OfficeLayout {
  const areaTiles: Array<string | null> = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      areaTiles.push(c <= 3 ? 'Finance' : c >= 8 ? 'Founder' : null);
    }
  }
  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture: [],
    areas: [
      { label: 'Finance', color: '' },
      { label: 'Founder', color: '' },
    ],
    areaTiles,
  };
}

function areaAt(os: OfficeState, col: number, row: number): string | null {
  return os.layout.areaTiles?.[row * COLS + col] ?? null;
}

function run(os: OfficeState, seconds: number, onTick?: () => void): void {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    os.update(dt);
    onTick?.();
  }
}

test('a character on a voice call walks to the Founder area', () => {
  const os = new OfficeState(areaLayout());
  os.addAgent(1, 0, 0, undefined, true);
  os.setAgentTool(1, VOICE_TOOL, 'call-1');

  const ch = os.characters.get(1)!;
  assert.ok(ch.talkTarget, 'has a spot to talk from');
  assert.equal(areaAt(os, ch.talkTarget.col, ch.talkTarget.row), 'Founder');
  assert.equal(os.isTalking(1), true);

  run(os, 5);
  assert.deepEqual({ col: ch.tileCol, row: ch.tileRow }, ch.talkTarget, 'arrived');
});

test('only one character talks at a time', () => {
  const os = new OfficeState(areaLayout());
  os.addAgent(1, 0, 0, undefined, true);
  os.addAgent(2, 1, 0, undefined, true);
  os.setAgentTool(1, VOICE_TOOL, 'call-1');
  os.setAgentTool(2, VOICE_TOOL, 'call-2');

  assert.equal(os.characters.get(1)!.talkTarget, null, 'the first talker leaves');
  assert.equal(os.isTalking(1), false);
  assert.equal(os.isTalking(2), true);
});

test('a finished call lingers briefly, then the character leaves', () => {
  const os = new OfficeState(areaLayout());
  os.addAgent(1, 0, 0, undefined, true);
  os.setAgentTool(1, VOICE_TOOL, 'call-1');
  os.agentToolDone(1, 'call-1');

  const ch = os.characters.get(1)!;
  assert.equal(os.isTalking(1), false, 'no longer talking once the call ends');
  assert.ok(ch.talkTarget, 'still in the Founder area during the linger');

  // Speaking again during the linger keeps the same spot.
  const spot = ch.talkTarget;
  os.setAgentTool(1, VOICE_TOOL, 'call-2');
  assert.equal(ch.talkTarget, spot);

  os.agentToolDone(1, 'call-2');
  run(os, TALK_LINGER_SEC + 0.5);
  assert.equal(ch.talkTarget, null, 'left after the linger');
});

test('another tool sends the character straight back', () => {
  const os = new OfficeState(areaLayout());
  os.addAgent(1, 0, 0, undefined, true);
  os.setAgentTool(1, VOICE_TOOL, 'call-1');
  os.setAgentTool(1, 'Read', 'read-1');
  assert.equal(os.characters.get(1)!.talkTarget, null);
});

test('wandering characters stay out of Areas that are not theirs', () => {
  const os = new OfficeState(areaLayout());
  os.addAgent(1, 0, 0, undefined, true);
  const ch = os.characters.get(1)!;
  // Start in the open middle, then let it wander for a while.
  ch.tileCol = 6;
  ch.tileRow = 4;
  ch.x = 6 * 16 + 8;
  ch.y = 4 * 16 + 8;
  ch.path = [];
  os.setAgentActive(1, false);

  let strayed: string | null = null;
  run(os, 300, () => {
    const target = ch.path[ch.path.length - 1];
    if (target) strayed ??= areaAt(os, target.col, target.row);
  });
  assert.equal(strayed, null, 'never headed into Finance or Founder');
});
