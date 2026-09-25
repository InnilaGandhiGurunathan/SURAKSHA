import { useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { Button, Modal } from '@/components/ui/primitives';

/** Kept separate from call state: opening help never unmounts or stops audio. */
export function FakeCallHelp() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-label="Fake call help" onClick={() => setOpen(true)}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink-400/20">
      <CircleHelp size={20} />
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title="How to use Fake Call" layer="call"
      footer={<Button onClick={() => setOpen(false)}>Got it</Button>}>
      <ol className="list-decimal space-y-3 pl-5 text-[13px] leading-relaxed text-ink-700">
        <li>Choose a caller and delay in Exit Mode, then start the simulated call. You can cancel the countdown or use Ring now to connect immediately.</li>
        <li>When the incoming screen appears, press Accept. Listen to the scripted caller and respond naturally; a transcript is also shown. Decline dismisses the incoming call.</li>
        <li>Mute toggles only the simulated microphone state, not the caller’s voice. This prototype never opens your microphone, transmits your voice, or records audio. Speaker changes the playback volume for subsequent lines.</li>
        <li>Press the red End simulated call button to finish. Opening or dismissing this help does not pause or end your call.</li>
      </ol>
      <p className="mt-3 text-[12px] text-ink-500">This is an escape aid, not a real call or an emergency service. It does not notify your circle. Use Quick SOS if you need to escalate.</p>
    </Modal>
  </>;
}
