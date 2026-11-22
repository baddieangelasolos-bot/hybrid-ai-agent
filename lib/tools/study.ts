import { tool } from 'ai';
import { z } from 'zod';

export const makeQuiz = tool({
  description: 'Show an interactive multiple-choice quiz to the learner. Use 5-10 varied questions with one correct option each and a short explanation.',
  inputSchema: z.object({
    title: z.string().min(2).max(100),
    questions: z
      .array(
        z.object({
          question: z.string().min(5).max(400),
          options: z.array(z.string().min(1).max(200)).min(2).max(5),
          answerIndex: z.number().int().min(0).max(4),
          explanation: z.string().max(500).default(''),
        }),
      )
      .min(3)
      .max(12),
  }),
  execute: async (quiz) => ({ kind: 'quiz' as const, ...quiz }),
  toModelOutput: ({ output }) => ({ type: 'text', value: 'The quiz "' + (output as { title: string }).title + '" is now shown to the user. Do not repeat the questions.' }),
});

export const makeFlashcards = tool({
  description: 'Show flip-style flashcards for memorising key facts, terms or formulas.',
  inputSchema: z.object({
    title: z.string().min(2).max(100),
    cards: z.array(z.object({ front: z.string().min(1).max(300), back: z.string().min(1).max(500) })).min(4).max(30),
  }),
  execute: async (deck) => ({ kind: 'flashcards' as const, ...deck }),
  toModelOutput: ({ output }) => ({ type: 'text', value: 'The flashcard deck "' + (output as { title: string }).title + '" is now shown to the user. Do not repeat the cards.' }),
});
