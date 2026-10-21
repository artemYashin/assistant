import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceShortcut, voiceRecordingIsLongEnough, shortcutTextWasInserted } from "../src/voice-shortcut.js";
const m = { code: "KeyM", repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false };
test("MM needs two separate presses within the interval and resets after a match", () => {
  const press = createVoiceShortcut();
  assert.equal(press(m, 0, false), false);
  assert.equal(press({ ...m, repeat: true }, 100, false), false);
  assert.equal(press(m, 200, false), true);
  assert.equal(press(m, 300, false), false);
  assert.equal(press(m, 800, false), false);
  assert.equal(press(m, 1000, false), true);
});
test("modifiers, composition and other keys cannot trigger voice recording", () => {
  for (const interrupt of [{ ...m, metaKey: true }, { ...m, ctrlKey: true }, { ...m, altKey: true }, { ...m, shiftKey: true }, { ...m, isComposing: true }, { ...m, code: "KeyN" }]) {
    const press = createVoiceShortcut();
    press(m, 0, false);
    assert.equal(press(interrupt, 100, false), false);
    assert.equal(press(m, 200, false), false);
  }
  const press = createVoiceShortcut();
  assert.equal(press(m, 0, true), false);
  assert.equal(press(m, 100, true), true);
  assert.equal(press(m, 200, false), false);
});
test("recordings shorter than two seconds are discarded", () => {
  assert.equal(voiceRecordingIsLongEnough(100, 2099), false);
  assert.equal(voiceRecordingIsLongEnough(100, 2100), true);
  assert.equal(voiceRecordingIsLongEnough(100, 6000), true);
});

test("shortcut text rollback only removes its own first keystroke and restores selection", () => {
  assert.equal(shortcutTextWasInserted("hello", "hellom", "m", 5, 5), true);
  assert.equal(shortcutTextWasInserted("hello", "hmlo", "m", 1, 3), true);
  assert.equal(shortcutTextWasInserted("hello", "hello edited", "m", 5, 5), false);
  assert.equal(shortcutTextWasInserted("привет", "приветь", "ь", 6, 6), true);
});
