import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service - Hybrid AI Agent',
  description: 'Terms for using Hybrid AI Agent.',
  robots: { index: true, follow: true },
};

const H2 = 'mt-8 mb-2 text-lg font-semibold';
const P = 'mb-3 text-sm leading-relaxed text-[color:var(--muted)]';

export default function TermsPage() {
  return (
    <main className='mx-auto max-w-2xl px-5 py-10'>
      <a href='/' className='text-xs underline text-[color:var(--muted)]'>Back to Hybrid AI Agent</a>
      <h1 className='mt-4 text-2xl font-bold'>Terms of Service</h1>
      <p className={P}>Last updated: 27 November 2026</p>

      <h2 className={H2}>Personal-use software</h2>
      <p className={P}>
        Hybrid AI Agent is a private tool operated by one person for their own use. It is not offered to the public, and access is protected by a password.
      </p>

      <h2 className={H2}>No warranty</h2>
      <p className={P}>
        The app is provided as is, without warranties of any kind. AI-generated answers can be wrong or incomplete and should be checked before you rely on them,
        especially for study, legal, medical or financial matters.
      </p>

      <h2 className={H2}>Your accounts and keys</h2>
      <p className={P}>
        The owner is responsible for the third-party accounts, API keys and permissions connected to the app (for example Google, GitHub, Vercel, Groq) and for
        following the terms of those services. Connected permissions can be removed at any time from the provider&apos;s own settings.
      </p>

      <h2 className={H2}>Content</h2>
      <p className={P}>
        You are responsible for the content you type, upload or generate. Do not use the app for anything unlawful or harmful.
      </p>

      <h2 className={H2}>Changes</h2>
      <p className={P}>
        The app and these terms may change or stop at any time. See the <a href='/privacy' className='underline'>Privacy Policy</a> for how data is handled.
      </p>
    </main>
  );
}
