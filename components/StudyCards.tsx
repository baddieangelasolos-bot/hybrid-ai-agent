'use client';

import { useMemo, useState } from 'react';
import { Icon } from './Icons';

export interface QuizData {
  title: string;
  questions: { question: string; options: string[]; answerIndex: number; explanation: string }[];
}
export interface DeckData {
  title: string;
  cards: { front: string; back: string }[];
}

export function QuizCard({ quiz }: { quiz: QuizData }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [step, setStep] = useState(0);
  const total = quiz.questions.length;
  const done = Object.keys(picked).length === total;
  const score = useMemo(() => quiz.questions.reduce((n, q, i) => n + (picked[i] === q.answerIndex ? 1 : 0), 0), [picked, quiz.questions]);
  const q = quiz.questions[Math.min(step, total - 1)];
  const answered = picked[step] !== undefined;

  return (
    <div className='card my-2 overflow-hidden'>
      <div className='flex items-center justify-between px-4 py-3' style={{ borderBottom: '1px solid var(--line)' }}>
        <div className='flex items-center gap-2 text-sm font-semibold'>
          <Icon name='book' size={16} />
          {quiz.title}
        </div>
        <span className='chip'>{done ? 'Score ' + score + '/' + total : 'Question ' + (step + 1) + '/' + total}</span>
      </div>
      <div className='p-4'>
        {done && step >= total ? null : (
          <>
            <p className='mb-3 text-[15px] font-medium leading-snug'>{q.question}</p>
            <div className='flex flex-col gap-2'>
              {q.options.map((o, i) => {
                const chosen = picked[step] === i;
                const correct = answered && i === q.answerIndex;
                const wrong = answered && chosen && i !== q.answerIndex;
                return (
                  <button
                    key={i}
                    disabled={answered}
                    onClick={() => setPicked((p) => ({ ...p, [step]: i }))}
                    className='rounded-xl px-3.5 py-2.5 text-left text-sm transition active:scale-[0.99]'
                    style={{
                      border: '1px solid ' + (correct ? 'var(--good)' : wrong ? 'var(--bad)' : 'var(--line)'),
                      background: correct ? 'color-mix(in srgb, var(--good) 14%, transparent)' : wrong ? 'color-mix(in srgb, var(--bad) 14%, transparent)' : 'var(--surface-2)',
                    }}
                  >
                    <span className='mr-2 font-mono text-xs text-[color:var(--muted)]'>{String.fromCharCode(65 + i)}</span>
                    {o}
                  </button>
                );
              })}
            </div>
            {answered && q.explanation && <p className='mt-3 rounded-xl p-3 text-sm text-[color:var(--muted)]' style={{ background: 'var(--surface-2)' }}>{q.explanation}</p>}
            <div className='mt-3 flex justify-between'>
              <button className='ghost-btn rounded-lg px-3 py-1.5 text-sm' disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</button>
              {step < total - 1 ? (
                <button className='neon-btn rounded-lg px-4 py-1.5 text-sm' disabled={!answered} onClick={() => setStep((s) => s + 1)}>Next</button>
              ) : (
                <button className='neon-btn rounded-lg px-4 py-1.5 text-sm' disabled={!answered} onClick={() => setStep(total)}>Finish</button>
              )}
            </div>
          </>
        )}
        {step >= total && (
          <div className='py-3 text-center'>
            <div className='text-3xl font-semibold'>{score} / {total}</div>
            <p className='mt-1 text-sm text-[color:var(--muted)]'>{score === total ? 'Perfect. You know this topic.' : score >= total / 2 ? 'Good progress. Review the ones you missed.' : 'Keep going. Ask the tutor to explain the tricky parts.'}</p>
            <button className='ghost-btn mt-3 rounded-lg px-4 py-2 text-sm' onClick={() => { setPicked({}); setStep(0); }}>Try again</button>
          </div>
        )}
      </div>
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
