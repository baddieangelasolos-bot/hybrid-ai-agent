'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatActions } from './AppProviders';
import { Icon } from './Icons';

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  topic?: string;
}
export interface QuizData {
  title: string;
  questions: QuizQuestion[];
}
export interface DeckData {
  title: string;
  cards: { front: string; back: string }[];
}

const LABELS_EN = ['A', 'B', 'C', 'D', 'E'];
const LABELS_BN = ['\u0995', '\u0996', '\u0997', '\u0998', '\u0999']; // ক খ গ ঘ ঙ
const hasBangla = (t: string) => /[\u0980-\u09FF]/.test(t);
/** Options sometimes arrive already labelled ("A) ..." or "ক) ..."): strip it, the card adds its own label. */
const cleanOption = (o: string) => o.replace(/^\s*\(?[A-Ea-e\u0995-\u0999][).:]\s+/, '');

interface SavedQuiz {
  answers: Record<number, number>;
  submitted: boolean;
  subset: number[] | null;
}

export function QuizCard({ quiz, quizId }: { quiz: QuizData; quizId?: string }) {
  const actions = useChatActions();
  const storeKey = quizId ? 'hya:quiz:' + quizId : '';
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [subset, setSubset] = useState<number[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const labels = useMemo(() => (hasBangla(quiz.questions.map((q) => q.question + q.options.join('')).join('')) ? LABELS_BN : LABELS_EN), [quiz]);

  // Progress survives leaving the page and coming back.
  useEffect(() => {
    if (storeKey) {
      try {
        const raw = localStorage.getItem(storeKey);
        if (raw) {
          const v = JSON.parse(raw) as SavedQuiz;
          setAnswers(v.answers ?? {});
          setSubmitted(Boolean(v.submitted));
          setSubset(Array.isArray(v.subset) ? v.subset : null);
        }
      } catch {
        /* ignore */
      }
    }
    setLoaded(true);
  }, [storeKey]);
  useEffect(() => {
    if (!storeKey || !loaded) return;
    try {
      localStorage.setItem(storeKey, JSON.stringify({ answers, submitted, subset } satisfies SavedQuiz));
    } catch {
      /* ignore */
    }
  }, [answers, submitted, subset, storeKey, loaded]);

  const indices = useMemo(() => subset ?? quiz.questions.map((_, i) => i), [subset, quiz.questions]);
  const total = indices.length;
  const answered = indices.filter((i) => answers[i] !== undefined).length;

  const result = useMemo(() => {
    const missed = indices.filter((i) => answers[i] !== quiz.questions[i].answerIndex);
    const score = total - missed.length;
    const topics = new Map<string, { total: number; wrong: number }>();
    for (const i of indices) {
      const t = (quiz.questions[i].topic ?? '').trim() || 'General';
      const e = topics.get(t) ?? { total: 0, wrong: 0 };
      e.total += 1;
      if (answers[i] !== quiz.questions[i].answerIndex) e.wrong += 1;
      topics.set(t, e);
    }
    const weak = [...topics.entries()].filter(([, v]) => v.wrong > 0).sort((a, b) => b[1].wrong / b[1].total - a[1].wrong / a[1].total);
    return { missed, score, pct: total ? Math.round((score / total) * 100) : 0, topics: [...topics.entries()], weak };
  }, [answers, indices, quiz.questions, total]);

  const pick = (qi: number, oi: number) => {
    if (submitted) return;
    setAnswers((p) => {
      const n = { ...p };
      if (n[qi] === oi) delete n[qi];
      else n[qi] = oi;
      return n;
    });
  };

  const submit = () => {
    setSubmitted(true);
    window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };
  const clearAll = () => setAnswers({});
  const retakeFull = () => {
    setSubset(null);
    setAnswers({});
    setSubmitted(false);
  };
  const retryFailed = () => {
    setSubset(result.missed);
    setAnswers({});
    setSubmitted(false);
  };
  const more = () => void actions.send('Give me 10 more MCQ questions like the quiz "' + quiz.title + '", same exam style, with a topic tag on each. Do not repeat any earlier question.', [], { agent: 'study' });
  const practiceWeak = () =>
    void actions.send('Make a focused 10-question MCQ quiz only on my weak topics: ' + result.weak.map(([t]) => t).join(', ') + '. Same exam style, tag each question with its topic, and do not repeat earlier questions.', [], { agent: 'study' });

  const grade = result.pct >= 80 ? 'Excellent' : result.pct >= 60 ? 'Good work' : result.pct >= 40 ? 'Keep practising' : 'Needs more revision';

  return (
    <div className='card my-2 overflow-hidden'>
      <div className='flex items-center justify-between gap-2 px-4 py-3' style={{ borderBottom: '1px solid var(--line)' }}>
        <div className='flex min-w-0 items-center gap-2 text-sm font-semibold'>
          <Icon name='book' size={16} />
          <span className='truncate'>{quiz.title}</span>
        </div>
        <span className='chip flex-none'>{submitted ? 'Score ' + result.score + ' / ' + total : answered + ' / ' + total + ' Answered'}</span>
      </div>

      {subset && !submitted && <p className='px-4 pt-3 text-xs text-[color:var(--muted)]'>Retry round: only the {total} question{total === 1 ? '' : 's'} you missed.</p>}

      <ol className='flex flex-col gap-3 p-3'>
        {indices.map((qi, n) => {
          const q = quiz.questions[qi];
          return (
            <li key={qi} className='rounded-2xl p-3' style={{ background: 'var(--surface-2)' }}>
              <p className='mb-2.5 text-[15px] font-medium leading-snug'>
                <span className='mr-1.5 text-[color:var(--muted)]'>{n + 1}.</span>
                {q.question}
              </p>
              <div className='flex flex-col gap-1.5'>
                {q.options.map((o, oi) => {
                  const chosen = answers[qi] === oi;
                  const correct = submitted && oi === q.answerIndex;
                  const wrong = submitted && chosen && oi !== q.answerIndex;
                  const border = correct ? 'var(--good)' : wrong ? 'var(--bad)' : chosen ? 'var(--accent)' : 'var(--line)';
                  const bg = correct ? 'color-mix(in srgb, var(--good) 14%, transparent)' : wrong ? 'color-mix(in srgb, var(--bad) 14%, transparent)' : chosen ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'var(--surface)';
                  return (
                    <button
                      key={oi}
                      type='button'
                      aria-pressed={chosen}
                      disabled={submitted}
                      onClick={() => pick(qi, oi)}
                      className='flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition active:scale-[0.99]'
                      style={{ border: '1px solid ' + border, background: bg }}
                    >
                      <span className='mt-px grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-semibold' style={chosen || correct ? { background: correct ? 'var(--good)' : wrong ? 'var(--bad)' : 'var(--accent)', color: '#fff' } : { border: '1px solid var(--line-strong)', color: 'var(--muted)' }}>
                        {labels[oi] ?? oi + 1}
                      </span>
                      <span className='min-w-0 break-words'>{cleanOption(o)}</span>
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>

      {!submitted && (
        <div className='flex flex-col gap-2 px-3 pb-3'>
          <button className='neon-btn rounded-2xl py-3 text-[15px]' disabled={answered === 0} onClick={submit}>
            Submit Answers &amp; Check Score
          </button>
          <button className='ghost-btn rounded-2xl py-2.5 text-sm' disabled={answered === 0} onClick={clearAll}>
            Clear All Answers
          </button>
          {answered > 0 && answered < total && <p className='text-center text-xs text-[color:var(--muted)]'>{total - answered} unanswered will count as missed.</p>}
        </div>
      )}

      {submitted && (
        <div ref={resultRef} className='scroll-mt-4 border-t px-4 py-4' style={{ borderColor: 'var(--line)' }}>
          <div className='text-center'>
            <div className='text-4xl font-semibold tracking-tight'>{result.score} / {total}</div>
            <div className='mt-1 text-sm'>
              <b>{result.pct}%</b> <span className='text-[color:var(--muted)]'>· {grade}</span>
            </div>
          </div>

          <div className='mt-4'>
            <div className='mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted)]'>Answer key</div>
            <div className='flex flex-wrap gap-1.5'>
              {indices.map((qi, n) => {
                const ok = answers[qi] === quiz.questions[qi].answerIndex;
                const none = answers[qi] === undefined;
                return (
                  <span key={qi} className='chip' style={{ color: ok ? 'var(--good)' : none ? 'var(--muted)' : 'var(--bad)', borderColor: 'currentColor' }}>
                    {n + 1}-{labels[quiz.questions[qi].answerIndex] ?? '?'}
                  </span>
                );
              })}
            </div>
          </div>

          {result.missed.length > 0 && (
            <div className='mt-4'>
              <div className='mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted)]'>Missed questions ({result.missed.length})</div>
              <ul className='flex flex-col gap-2'>
                {result.missed.map((qi) => {
                  const q = quiz.questions[qi];
                  const mine = answers[qi];
                  return (
                    <li key={qi} className='rounded-2xl p-3 text-sm' style={{ background: 'var(--surface-2)' }}>
                      <p className='mb-2 font-medium leading-snug'>{indices.indexOf(qi) + 1}. {q.question}</p>
                      <p style={{ color: 'var(--bad)' }}>Your answer: {mine === undefined ? 'Not answered' : (labels[mine] ?? '') + ') ' + cleanOption(q.options[mine] ?? '')}</p>
                      <p style={{ color: 'var(--good)' }}>Correct answer: {(labels[q.answerIndex] ?? '') + ') ' + cleanOption(q.options[q.answerIndex] ?? '')}</p>
                      {q.explanation && <p className='mt-1.5 text-[color:var(--muted)]'>Explanation: {q.explanation}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {result.topics.length > 1 || result.weak.length > 0 ? (
            <div className='mt-4'>
              <div className='mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted)]'>{result.weak.length > 0 ? 'Weak topics' : 'Topics'}</div>
              <div className='flex flex-wrap gap-1.5'>
                {(result.weak.length > 0 ? result.weak : result.topics).map(([t, v]) => (
                  <span key={t} className='chip' style={{ color: v.wrong > 0 ? 'var(--warn)' : 'var(--good)' }}>
                    {t} · {v.total - v.wrong}/{v.total}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <p className='mt-4 rounded-xl p-3 text-sm' style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)' }}>
            {result.weak.length > 0 ? 'Suggested next test: 10 questions on ' + result.weak.slice(0, 3).map(([t]) => t).join(', ') + '.' : 'No weak topics this round. Try a harder or longer test next.'}
          </p>

          <div className='mt-3 flex flex-col gap-2'>
            {result.missed.length > 0 && <button className='neon-btn rounded-2xl py-3 text-[15px]' onClick={retryFailed}>Try again only with the failed questions</button>}
            {result.weak.length > 0 && <button className='ghost-btn rounded-2xl py-2.5 text-sm' onClick={practiceWeak}>Practice my weak topics</button>}
            <button className='ghost-btn rounded-2xl py-2.5 text-sm' onClick={more}>Give me more questions</button>
            <button className='ghost-btn rounded-2xl py-2.5 text-sm' onClick={retakeFull}>Retake full quiz</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FlashcardDeck({ deck }: { deck: DeckData }) {
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const c = deck.cards[i];
  const go = (d: number) => {
    setFlip(false);
    setI((x) => (x + d + deck.cards.length) % deck.cards.length);
  };
  return (
    <div className='card my-2 overflow-hidden'>
      <div className='flex items-center justify-between px-4 py-3' style={{ borderBottom: '1px solid var(--line)' }}>
        <div className='flex items-center gap-2 text-sm font-semibold'>
          <Icon name='book' size={16} />
          {deck.title}
        </div>
        <span className='chip'>{known.size}/{deck.cards.length} known</span>
      </div>
      <div className='p-4'>
        <button
          onClick={() => setFlip((f) => !f)}
          className='grid min-h-[150px] w-full place-items-center rounded-2xl p-5 text-center transition active:scale-[0.99]'
          style={{ background: flip ? 'color-mix(in srgb, var(--accent) 14%, var(--surface-2))' : 'var(--surface-2)', border: '1px solid var(--line)' }}
        >
          <div>
            <div className='mb-2 text-[11px] uppercase tracking-wide text-[color:var(--muted)]'>{flip ? 'Answer' : 'Tap to reveal'}</div>
            <div className='text-[17px] font-medium leading-snug'>{flip ? c.back : c.front}</div>
          </div>
        </button>
        <div className='mt-3 flex items-center justify-between gap-2'>
          <button className='ghost-btn rounded-lg px-3 py-2 text-sm' onClick={() => go(-1)}>Prev</button>
          <button
            className='ghost-btn rounded-lg px-3 py-2 text-sm'
            onClick={() => setKnown((k) => { const n = new Set(k); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
            style={known.has(i) ? { borderColor: 'var(--good)', color: 'var(--good)' } : undefined}
          >
            {known.has(i) ? 'Known' : 'Mark known'}
          </button>
          <span className='text-xs text-[color:var(--muted)]'>{i + 1}/{deck.cards.length}</span>
          <button className='neon-btn rounded-lg px-4 py-2 text-sm' onClick={() => go(1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
