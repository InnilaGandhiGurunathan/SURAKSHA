/**
 * Voice output for Exit Mode's simulated call.
 *
 * Exit Mode renders a pretend phone call so the traveller has a believable
 * reason to leave. The screen used to claim "simulated audio" while the device
 * produced no sound at all — the most obviously fake part of the fakest screen.
 * This wraps the Web Speech API so the caller actually speaks.
 *
 * Rules this module follows:
 *  - **Every failure path degrades to silence.** Exit Mode must never break, so
 *    nothing here throws and nothing rejects. If the platform has no speech
 *    synthesis we simply return without speaking.
 *  - **Speech starts from a user gesture.** The caller speaks only after the
 *    traveller presses Accept. A ringtone was deliberately not added: it would
 *    have to start from the store's timer, which is not a user gesture, and
 *    browsers would silently block it.
 */

export interface SpeakOptions {
  /** 0.1–10. Default 1. */
  rate?: number;
  /** 0–2. Default 1. */
  pitch?: number;
  /** 0–1. Default 1. */
  volume?: number;
  /** Called when the utterance finishes, is cancelled, or errors. */
  onEnd?: () => void;
}

/** True when the platform can actually speak. */
export function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const synth = (window as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  return Boolean(synth && typeof synth.speak === 'function');
}

/**
 * Speak one line. Never throws: an unsupported platform, a missing voice or a
 * failed utterance all resolve to silence.
 */
export function speakLine(text: string, options: SpeakOptions = {}): boolean {
  const { rate = 1, pitch = 1, volume = 1, onEnd } = options;
  if (!text.trim()) {
    onEnd?.();
    return false;
  }

  const finish = (() => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      onEnd?.();
    };
  })();

  try {
    if (!isVoiceSupported()) {
      finish();
      return false;
    }
    const synth = (window as unknown as { speechSynthesis: SpeechSynthesis }).speechSynthesis;
    const Utterance = (window as unknown as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
      .SpeechSynthesisUtterance;
    if (typeof Utterance !== 'function') {
      finish();
      return false;
    }

    // Cancel anything already speaking so lines cannot overlap.
    synth.cancel();

    const utterance = new Utterance(text);
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;
    utterance.onend = finish;
    utterance.onerror = finish;

    if (typeof synth.resume === 'function') synth.resume();
    synth.speak(utterance);
    return true;
  } catch {
    // Unsupported platform, blocked synthesis, or a broken implementation.
    finish();
    return false;
  }
}

/** Stop any speech immediately. Safe to call when nothing is speaking. */
export function stopVoice(): void {
  try {
    if (!isVoiceSupported()) return;
    const synth = (window as unknown as { speechSynthesis: SpeechSynthesis }).speechSynthesis;
    synth.cancel();
  } catch {
    // Nothing to do — silence is the correct failure state here.
  }
}
