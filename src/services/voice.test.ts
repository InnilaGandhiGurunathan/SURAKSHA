/**
 * Exit Mode voice fallbacks.
 *
 * jsdom has no `speechSynthesis`, which is exactly what makes this a valid test
 * of the degraded path: Exit Mode must keep working — silently — on any platform
 * that cannot speak. Real audio cannot be asserted here and is checked by hand
 * in a browser.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isVoiceSupported, speakLine, stopVoice } from './voice';

type WithSpeech = { speechSynthesis?: unknown; SpeechSynthesisUtterance?: unknown };

function clearSpeechGlobals(): void {
  delete (window as WithSpeech).speechSynthesis;
  delete (window as WithSpeech).SpeechSynthesisUtterance;
}

describe('voice service', () => {
  beforeEach(() => {
    clearSpeechGlobals();
  });

  afterEach(() => {
    clearSpeechGlobals();
    vi.restoreAllMocks();
  });

  it('reports unsupported when the platform has no speech synthesis', () => {
    expect(isVoiceSupported()).toBe(false);
  });

  it('degrades to silence instead of throwing when unsupported', () => {
    const onEnd = vi.fn();
    let result: boolean | undefined;
    expect(() => {
      result = speakLine("Hey, where are you? I'm waiting outside.", { onEnd });
    }).not.toThrow();
    expect(result).toBe(false);
    // The caller still learns the line is over, so the UI is never left hanging.
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('treats empty text as nothing to say', () => {
    const onEnd = vi.fn();
    expect(speakLine('   ', { onEnd })).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('survives a speech implementation that throws', () => {
    const speak = vi.fn(() => {
      throw new Error('synthesis blocked');
    });
    (window as WithSpeech).speechSynthesis = { speak, cancel: vi.fn(), resume: vi.fn() };
    (window as WithSpeech).SpeechSynthesisUtterance = function Utterance(this: unknown) {
      return this;
    };

    const onEnd = vi.fn();
    expect(isVoiceSupported()).toBe(true);
    let result: boolean | undefined;
    expect(() => {
      result = speakLine('I can see the auto at the corner.', { onEnd });
    }).not.toThrow();
    expect(result).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('speaks through the platform API when it is available', () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    (window as WithSpeech).speechSynthesis = { speak, cancel, resume: vi.fn() };
    (window as WithSpeech).SpeechSynthesisUtterance = function Utterance(this: { text?: string }, text: string) {
      this.text = text;
    };

    expect(speakLine('Two minutes and the shop closes.', { rate: 0.9, volume: 0.5 })).toBe(true);
    expect(speak).toHaveBeenCalledTimes(1);
    // Anything already speaking is cancelled first so lines cannot overlap.
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('stopVoice is safe to call on an unsupported platform and when speaking', () => {
    expect(() => stopVoice()).not.toThrow();

    const cancel = vi.fn();
    (window as WithSpeech).speechSynthesis = { speak: vi.fn(), cancel, resume: vi.fn() };
    stopVoice();
    expect(cancel).toHaveBeenCalledTimes(1);

    (window as WithSpeech).speechSynthesis = {
      speak: vi.fn(),
      cancel: () => {
        throw new Error('cannot cancel');
      },
      resume: vi.fn(),
    };
    expect(() => stopVoice()).not.toThrow();
  });
});
