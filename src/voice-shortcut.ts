import { voiceBinding, modifierCode } from "../server/voice-binding.js";
export const VOICE_DOUBLE_PRESS_MS = 450;
export const VOICE_MIN_RECORDING_MS = 2000;
export function createVoiceShortcut(codes: string[] = ["KeyM", "KeyN"], singleCodes: string[] = []) {
  let previous: number | undefined;
  let previousCode = "";
  return (event: { code: string; repeat: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }, now: number, editing = false) => {
    const binding = voiceBinding(event);
    if (editing && /^(Key[A-Z]|Digit[0-9]|Numpad[0-9])$/.test(binding)) { previous = undefined; previousCode = ""; return false; }
    if (event.isComposing || !codes.includes(binding)) { if (!modifierCode(event.code) || event.isComposing) previous = undefined; return false; }
    if (event.repeat) return false;
    if (singleCodes.includes(binding)) { previous = undefined; return true; }
    const matched = previousCode === binding && previous !== undefined && now - previous <= VOICE_DOUBLE_PRESS_MS;
    previous = matched ? undefined : now;
    previousCode = binding;
    return matched;
  };
}
export function voiceRecordingIsLongEnough(started: number, now: number) {
  return now - started >= VOICE_MIN_RECORDING_MS;
}

export function shortcutTextWasInserted(before: string, after: string, key: string, start: number, end: number) {
  return after === before.slice(0, start) + key + before.slice(end);
}
