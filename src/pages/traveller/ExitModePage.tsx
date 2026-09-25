import { FakeCallHelp } from '@/components/domain/FakeCallHelp';
/**
 * Exit Mode — hero feature.
 * "Need a believable reason to leave? We can help."
 */

import { Info, ListChecks, PhoneCall, ShieldAlert, Sparkles } from 'lucide-react';
import { Card, CardBody, CardHeader, Chip } from '@/components/ui/primitives';
import { PageHeader } from '@/components/domain/blocks';
import { ExitModeSetup } from '@/components/domain/ExitMode';
import { useAppState, store } from '@/store/hooks';
import { formatClock } from '@/lib/format';

export function ExitModePage() {
  const { exitMode, events, now } = useAppState();
  const history = events.filter((e) => e.type === 'exit_mode_started').slice(-3).reverse();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Traveller · Discreet exit"
        title="Exit Mode"
        description="Need a believable reason to leave? We can help. Exit Mode is an escape aid for uncomfortable situations — not an emergency action, and nothing about it is shared with your circle."
        actions={
          <>
            <Chip tone="brand">
              <Sparkles size={12} /> Simulated call
            </Chip>
            <Chip tone="neutral">No telephony used</Chip>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader action={<FakeCallHelp />} title="Set up your exit" subtitle="Pick how soon and who appears to be calling." icon={<PhoneCall size={16} />} />
          <CardBody>
            <ExitModeSetup />
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="How to use it well" subtitle="Small, early actions beat dramatic ones." icon={<ListChecks size={16} />} />
            <CardBody className="space-y-3">
              {[
                {
                  title: 'Choose the exit before you need it',
                  body: 'Decide where you will walk (a lit shop, the metro concourse, the campus desk) while the call is still counting down.',
                },
                {
                  title: 'Answer the call and keep it short',
                  body: '“Coming out now” is enough. You do not need to explain anything to anyone nearby.',
                },
                {
                  title: 'Escalate if the situation changes',
                  body: 'Exit Mode never notifies anyone. If you feel less safe, switch to Quick SOS — that is what it is for.',
                },
                {
                  title: 'It is fine to use it for non-emergencies',
                  body: 'An uncomfortable conversation, a persistent stranger, a lift you do not want. Proportionate tools for real moments.',
                },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-ink-200 px-3.5 py-3">
                  <p className="text-[13px] font-semibold text-ink-800">{item.title}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-500">{item.body}</p>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card tone="brand" className="bg-brand-50">
            <CardBody className="flex items-start gap-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-brand-700">
                <Info size={16} />
              </span>
              <div>
                <p className="text-[13px] font-bold text-brand-900">What Exit Mode does and does not do</p>
                <ul className="mt-1.5 space-y-1 text-[12.5px] leading-relaxed text-brand-900/80">
                  <li>✅ Shows a convincing incoming call and a scripted transcript.</li>
                  <li>✅ Logs <code className="rounded bg-white/70 px-1 font-semibold">exit_mode_started</code> so you can review it later.</li>
                  <li>🚫 Does not place or receive real calls, use your microphone, or record audio.</li>
                  <li>🚫 Does not notify your trusted circle — use Quick SOS or a check-in for that.</li>
                </ul>
              </div>
            </CardBody>
          </Card>

          {exitMode?.active ? (
            <Card tone="watch" className="bg-watch-50">
              <CardBody className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-bold text-watch-900">Exit Mode is active</p>
                  <p className="mt-0.5 text-[12px] text-watch-800">
                    {exitMode.answered
                      ? 'Simulated call in progress.'
                      : `Ringing at ${formatClock(exitMode.ringsAt)}.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => store.endExitMode()}
                  className="rounded-xl bg-white px-3 py-2 text-[12.5px] font-semibold text-watch-800 shadow-sm"
                >
                  Close Exit Mode
                </button>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Recent exits" subtitle="Recorded locally so you can review what you used." icon={<PhoneCall size={16} />} />
            <CardBody className="space-y-2">
              {history.length ? (
                history.map((event) => (
                  <div key={event.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-ink-800">
                        {String(event.metadata.contact ?? 'Simulated call')}
                      </p>
                      <p className="text-[11.5px] text-ink-500">
                        {String(event.metadata.delaySeconds ?? 10)}s delay · simulated
                      </p>
                    </div>
                    <span className="text-[12px] font-medium text-ink-500 tabular">{formatClock(event.timestamp)}</span>
                  </div>
                ))
              ) : (
                <p className="rounded-xl border border-dashed border-ink-300 px-4 py-6 text-center text-[13px] text-ink-500">
                  No Exit Mode sessions yet.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Prefer to escalate instead?" icon={<ShieldAlert size={16} />} />
            <CardBody>
              <button
                type="button"
                onClick={() => store.toggleUi('sosPanelOpen', true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-critical-600 py-3 text-sm font-bold text-white transition-state hover:bg-critical-700"
              >
                <ShieldAlert size={17} />
                Open Quick SOS
              </button>
              <p className="mt-2 text-center text-[11.5px] text-ink-500">
                Current time in the simulation: {formatClock(now)}
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
