/** Safety Learning Hub — short, practical lessons with a 3-question quiz each. */

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Eye,
  Flag,
  Lock,
  RotateCcw,
  Share2,
  ShieldCheck,
  Siren,
  Sparkles,
  Users,
  XCircle,
} from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Modal,
  Progress,
} from '@/components/ui/primitives';
import { PageHeader, SectionHeading } from '@/components/domain/blocks';
import { LESSONS_SEED } from '@/domain/seed';
import type { Lesson } from '@/domain/types';
import { store, useAppState } from '@/store/hooks';
import { cn } from '@/lib/cn';

const LESSON_ICONS: Record<string, typeof BookOpen> = {
  route: BookOpen,
  eye: Eye,
  users: Users,
  lock: Lock,
  siren: Siren,
  flag: Flag,
  share: Share2,
};

export function Learn() {
  const { learning } = useAppState();
  const [openLesson, setOpenLesson] = useState<Lesson | null>(null);

  const completed = learning.completed.length;
  const total = LESSONS_SEED.length;
  const percent = Math.round((completed / total) * 100);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Traveller · Learning"
        title="Safety learning"
        description="Seven short lessons. Each one ends with three questions — no scores sent anywhere, no streak pressure."
        actions={
          <Button variant="ghost" size="sm" icon={<RotateCcw size={15} />} onClick={() => store.resetLearning()}>
            Reset progress
          </Button>
        }
      />

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="sr-label">Your progress</p>
              <p className="mt-0.5 text-[19px] font-bold text-ink-900">
                {completed} / {total} completed
              </p>
            </div>
            <Chip tone={completed === total ? 'safe' : 'brand'}>
              <Sparkles size={12} />
              {percent}% done
            </Chip>
          </div>
          <Progress value={percent} tone={completed === total ? 'safe' : 'brand'} label="Lesson progress" />
        </CardBody>
      </Card>

      <SectionHeading title="Lessons" description="Roughly 3–5 minutes each." />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {LESSONS_SEED.map((lesson) => {
          const Icon = LESSON_ICONS[lesson.icon] ?? BookOpen;
          const done = learning.completed.includes(lesson.id);
          const score = learning.quizScores[lesson.id];
          return (
            <li key={lesson.id}>
              <button
                type="button"
                onClick={() => setOpenLesson(lesson)}
                className="h-full w-full text-left focus-visible:rounded-card"
              >
                <Card
                  className={cn(
                    'h-full transition-state hover:border-ink-300 hover:shadow-raised',
                    done && 'border-safe-200 bg-safe-50/50',
                  )}
                >
                  <CardBody className="flex h-full flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={cn(
                          'grid h-10 w-10 place-items-center rounded-xl',
                          done ? 'bg-safe-100 text-safe-700' : 'bg-ink-100 text-ink-600',
                        )}
                      >
                        <Icon size={18} />
                      </span>
                      {done ? (
                        <Chip tone="safe">
                          <CheckCircle2 size={12} /> {score !== undefined ? `${score}/3` : 'Done'}
                        </Chip>
                      ) : (
                        <Chip tone="neutral">{lesson.minutes} min</Chip>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-[14px] font-bold leading-snug text-ink-900">{lesson.title}</p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{lesson.summary}</p>
                    </div>
                    <span className="text-[12.5px] font-semibold text-brand-700">
                      {done ? 'Review lesson' : 'Start lesson'} →
                    </span>
                  </CardBody>
                </Card>
              </button>
            </li>
          );
        })}
      </ul>

      <Card tone="brand" className="bg-brand-50">
        <CardHeader title="Why learning sits inside a safety app" icon={<ShieldCheck size={16} />} />
        <CardBody className="text-[12.5px] leading-relaxed text-brand-900/85">
          Monitoring only helps when the person travelling decides what to do with the signals. These lessons are about
          judgement, not fear: planning, noticing early, agreeing thresholds with your circle, and handling your own
          privacy.
        </CardBody>
      </Card>

      <LessonDialog lesson={openLesson} onClose={() => setOpenLesson(null)} />
    </div>
  );
}

function LessonDialog({ lesson, onClose }: { lesson: Lesson | null; onClose: () => void }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const reset = () => {
    setAnswers({});
    setSubmitted(false);
  };

  const correct = useMemo(
    () => (lesson ? lesson.quiz.filter((q) => answers[q.id] === q.answerIndex).length : 0),
    [answers, lesson],
  );

  if (!lesson) return null;

  const allAnswered = lesson.quiz.every((q) => answers[q.id] !== undefined);

  return (
    <Modal
      open={Boolean(lesson)}
      onClose={() => {
        reset();
        onClose();
      }}
      size="lg"
      title={lesson.title}
      description={`${lesson.minutes} minute lesson · ${lesson.quiz.length} questions`}
      footer={
        submitted ? (
          <>
            <Button
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Finish
            </Button>
            <Button variant="ghost" onClick={reset}>
              Try the quiz again
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={!allAnswered}
              onClick={() => {
                setSubmitted(true);
                store.completeLesson(lesson.id, { correct, total: lesson.quiz.length });
              }}
            >
              Check answers
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                reset();
                onClose();
              }}
              icon={<ArrowLeft size={15} />}
            >
              Back to lessons
            </Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        {lesson.sections.map((section) => (
          <section key={section.heading}>
            <h3 className="text-[14px] font-bold text-ink-900">{section.heading}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-600">{section.body}</p>
          </section>
        ))}

        <section className="rounded-xl border border-ink-200 bg-ink-50 p-4">
          <h3 className="flex items-center gap-2 text-[13.5px] font-bold text-ink-900">
            <Sparkles size={15} className="text-brand-600" />
            Quick check
          </h3>

          <ol className="mt-3 space-y-4">
            {lesson.quiz.map((question, index) => {
              const chosen = answers[question.id];
              return (
                <li key={question.id}>
                  <p className="text-[13px] font-semibold text-ink-800">
                    {index + 1}. {question.question}
                  </p>
                  {/*
                    These are single-answer choices, so they are a radiogroup,
                    not a pile of buttons. Three things were wrong before: the
                    selection indicator only rendered after submitting (so a
                    tap looked like it did nothing), there was no way to
                    unselect, and the control carried no role or state at all.
                  */}
                  <div role="radiogroup" aria-label={question.question} className="mt-2 space-y-1.5">
                    {question.options.map((option, optionIndex) => {
                      const selected = chosen === optionIndex;
                      const isCorrect = optionIndex === question.answerIndex;
                      const showState = submitted && (selected || isCorrect);
                      return (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={submitted}
                          onClick={() =>
                            setAnswers((current) => {
                              const next = { ...current };
                              // Tapping the chosen answer again clears it, so a
                              // mis-tap is not a dead end before submitting.
                              if (next[question.id] === optionIndex) delete next[question.id];
                              else next[question.id] = optionIndex;
                              return next;
                            })
                          }
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[12.5px] font-medium transition-state',
                            !showState && selected && 'border-brand-500 bg-white ring-1 ring-brand-500',
                            !showState && !selected && 'border-ink-200 bg-white hover:bg-ink-50',
                            showState && isCorrect && 'border-safe-300 bg-safe-50 text-safe-900',
                            showState && !isCorrect && selected && 'border-critical-300 bg-critical-50 text-critical-900',
                            showState && !isCorrect && !selected && 'border-ink-200 bg-white opacity-60',
                          )}
                        >
                          {showState && isCorrect ? (
                            <CheckCircle2 size={15} className="shrink-0 text-safe-600" />
                          ) : showState && selected ? (
                            <XCircle size={15} className="shrink-0 text-critical-600" />
                          ) : selected ? (
                            <CheckCircle2 size={15} className="shrink-0 text-brand-600" />
                          ) : (
                            <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-ink-300" />
                          )}
                          {option}
                        </button>
                      );
                    })}
                  </div>
                  {submitted ? (
                    <p className="mt-2 rounded-lg bg-white px-3 py-2 text-[12px] leading-relaxed text-ink-600">
                      {question.explanation}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {submitted ? (
            <p
              className={cn(
                'mt-4 rounded-xl px-3.5 py-3 text-[13px] font-semibold',
                correct === lesson.quiz.length
                  ? 'bg-safe-100 text-safe-900'
                  : correct >= 2
                    ? 'bg-watch-100 text-watch-900'
                    : 'bg-ink-100 text-ink-700',
              )}
            >
              {correct} / {lesson.quiz.length} correct —{' '}
              {correct === lesson.quiz.length
                ? 'nice work.'
                : 'worth a second read; no score is stored anywhere but here.'}
            </p>
          ) : (
            <p className="mt-3 text-[11.5px] text-ink-500">
              Answer all {lesson.quiz.length} questions to complete the lesson.
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
