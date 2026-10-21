export const VOICE_DOUBLE_PRESS_MS = 450;
export const VOICE_MIN_RECORDING_MS = 2000;
export function createVoiceShortcut() {
  let previous: number | undefined;
  return (event: { code: string; repeat: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }, now: number, editing: boolean) => {
    if (editing || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.code !== "KeyM") { previous = undefined; return false; }
    if (event.repeat) return false;
    const matched = previous !== undefined && now - previous <= VOICE_DOUBLE_PRESS_MS;
    previous = matched ? undefined : now;
    return matched;
  };
}
export function voiceRecordingIsLongEnough(started: number, now: number) {
  return now - started >= VOICE_MIN_RECORDING_MS;
}
