import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceShortcut, voiceRecordingIsLongEnough, shortcutTextWasInserted } from "../src/features/voice-input/index.js";
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
  for (const interrupt of [{ ...m, metaKey: true }, { ...m, ctrlKey: true }, { ...m, altKey: true }, { ...m, shiftKey: true }, { ...m, isComposing: true }, { ...m, code: "KeyX" }]) {
    const press = createVoiceShortcut();
    press(m, 0, false);
    assert.equal(press(interrupt, 100, false), false);
    assert.equal(press(m, 200, false), false);
  }
  const press = createVoiceShortcut();
  assert.equal(press(m, 0, true), false);
  assert.equal(press(m, 100, true), false);
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

 test("NN starts a separate shortcut and mixed M/N presses do not match", () => {
  const press = createVoiceShortcut();
  const n = { ...m, code: "KeyN" };
  assert.equal(press(m, 0), false);
  assert.equal(press(n, 100), false);
  assert.equal(press(n, 200), true);
  assert.equal(press(n, 300), false);
  assert.equal(press(m, 400), false);
  assert.equal(press(m, 500), true);
});

test("custom bindings replace defaults and never match mixed keys", () => {
  const press = createVoiceShortcut(["KeyV", "KeyB"]);
  assert.equal(press(m, 0), false);
  assert.equal(press(m, 100), false);
  assert.equal(press({ ...m, code: "KeyV" }, 200), false);
  assert.equal(press({ ...m, code: "KeyB" }, 300), false);
  assert.equal(press({ ...m, code: "KeyB" }, 400), true);
  assert.equal(press({ ...m, code: "KeyV" }, 500), false);
  assert.equal(press({ ...m, code: "KeyV" }, 600), true);
});

test("single press fires immediately, ignores holding, and coexists with double press", () => {
  const press = createVoiceShortcut(["Digit1", "KeyN"], ["Digit1"]);
  const one = { ...m, code: "Digit1" };
  const n = { ...m, code: "KeyN" };
  assert.equal(press(one, 0), true);
  assert.equal(press({ ...one, repeat: true }, 50), false);
  assert.equal(press(n, 100), false);
  assert.equal(press(n, 200), true);
  assert.equal(press(n, 300), false);
  assert.equal(press(one, 350), true);
  assert.equal(press(n, 400), false);
});

test("space, standalone modifiers and modifier combinations can be bound", () => {
  for (const [binding, event] of [
    ["Space", { ...m, code: "Space" }],
    ["ControlLeft", { ...m, code: "ControlLeft", ctrlKey: true }],
    ["MetaLeft", { ...m, code: "MetaLeft", metaKey: true }],
    ["ShiftRight", { ...m, code: "ShiftRight", shiftKey: true }],
    ["AltLeft", { ...m, code: "AltLeft", altKey: true }],
    ["Ctrl+Shift+KeyM", { ...m, ctrlKey: true, shiftKey: true }],
  ] as const) {
    const press = createVoiceShortcut([binding]);
    assert.equal(press(event, 0), false);
    assert.equal(press(event, 100), true);
  }
});


test("typing suppresses plain alphanumeric shortcuts and resets double press", () => {
  for (const code of ["KeyM", "Digit1", "Numpad1"]) {
    const press = createVoiceShortcut([code]);
    const event = { ...m, code };
    assert.equal(press(event, 0), false);
    assert.equal(press(event, 100, true), false);
    assert.equal(press(event, 200), false);
    assert.equal(press(event, 300), true);
    assert.equal(createVoiceShortcut([code], [code])(event, 0, true), false);
  }
});
test("special keys and modifier combinations still work inside editors", () => {
  for (const [binding, event] of [
    ["Space", { ...m, code: "Space" }],
    ["ControlLeft", { ...m, code: "ControlLeft", ctrlKey: true }],
    ["Ctrl+KeyM", { ...m, ctrlKey: true }],
  ] as const) {
    const press = createVoiceShortcut([binding]);
    assert.equal(press(event, 0, true), false);
    assert.equal(press(event, 100, true), true);
    assert.equal(createVoiceShortcut([binding], [binding])(event, 0, true), true);
  }
});

test("disabled bindings never trigger a shortcut", () => {
  const press = createVoiceShortcut(["", ""], [""]);
  for (const code of ["KeyM", "KeyN", "KeyC", "KeyI", "Space", "ControlLeft"]) {
    assert.equal(press({ ...m, code }, 0), false);
    assert.equal(press({ ...m, code }, 100), false);
  }
});

test("field dictation default Ctrl+I fires once inside an editor", () => {
  const press = createVoiceShortcut(["Ctrl+KeyI"], ["Ctrl+KeyI"]);
  const i = { ...m, code: "KeyI" };
  assert.equal(press(i, 0, true), false);
  assert.equal(press({ ...i, ctrlKey: true }, 100, true), true);
  assert.equal(press({ ...i, ctrlKey: true, repeat: true }, 150, true), false);
});
