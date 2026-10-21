export const VOICE_DOUBLE_PRESS_MS = 450;
export const VOICE_MIN_RECORDING_MS = 2000;
export function createVoiceShortcut(codes: string[] = ["KeyM", "KeyN"], singleCodes: string[] = []) {
  let previous: number | undefined;
  let previousCode = "";
  return (event: { code: string; repeat: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }, now: number, _editing = false) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !codes.includes(event.code)) { previous = undefined; return false; }
    if (event.repeat) return false;
    if (singleCodes.includes(event.code)) { previous = undefined; return true; }
    const matched = previousCode === event.code && previous !== undefined && now - previous <= VOICE_DOUBLE_PRESS_MS;
    previous = matched ? undefined : now;
    previousCode = event.code;
    return matched;
  };
}
export function voiceRecordingIsLongEnough(started: number, now: number) {
  return now - started >= VOICE_MIN_RECORDING_MS;
}

export function shortcutTextWasInserted(before: string, after: string, key: string, start: number, end: number) {
  return after === before.slice(0, start) + key + before.slice(end);
}
