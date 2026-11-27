import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy - Hybrid AI Agent',
  description: 'How Hybrid AI Agent handles your data, including Google Drive access.',
  robots: { index: true, follow: true },
};

const H2 = 'mt-8 mb-2 text-lg font-semibold';
const P = 'mb-3 text-sm leading-relaxed text-[color:var(--muted)]';

export default function PrivacyPage() {
  return (
    <main className='mx-auto max-w-2xl px-5 py-10'>
      <a href='/' className='text-xs underline text-[color:var(--muted)]'>Back to Hybrid AI Agent</a>
      <h1 className='mt-4 text-2xl font-bold'>Privacy Policy</h1>
      <p className={P}>Last updated: 27 November 2026</p>

      <h2 className={H2}>What this app is</h2>
      <p className={P}>
        Hybrid AI Agent is a private, password-protected AI assistant built and operated by one person for their own use. It is not a public service and has no
        other users. This page explains what the app does with data, in particular when it is connected to a Google account.
      </p>

      <h2 className={H2}>Google user data we access</h2>
      <p className={P}>
        If the owner connects Google Drive, the app asks for one permission only: <code>https://www.googleapis.com/auth/drive.file</code>. This permission lets the app
        see and change only the files and folders that the app itself created. The app creates one folder (by default &quot;Hybrid AI Agent - App Data&quot;) and
        stores its own data there as small JSON files: chat history, settings, memory notes and profile. The app cannot read, list or change any other file in
        Google Drive.
      </p>

      <h2 className={H2}>How the data is used</h2>
      <p className={P}>
        Drive is used only to keep the app&apos;s own data backed up and in sync between the owner&apos;s devices. The data is not sold, not used for advertising, not
        shared with other people, and not used to build profiles. The use of information received from Google APIs adheres to the Google API Services User Data
        Policy, including the Limited Use requirements.
      </p>

      <h2 className={H2}>AI model providers</h2>
      <p className={P}>
        When the owner chats with the assistant, the text of the conversation (and any files the owner attaches) is sent to the AI model provider that answers it,
        for example Google AI Studio, Groq or OpenRouter, so that a reply can be generated. Files in Google Drive outside the app&apos;s own folder are never sent
        anywhere.
      </p>

      <h2 className={H2}>Where credentials are stored</h2>
      <p className={P}>
        The Google refresh token and other keys are stored as protected environment variables in the owner&apos;s own Vercel project. They are never placed in the
        browser, in chat messages or in the app&apos;s public code.
      </p>

      <h2 className={H2}>Retention and deletion</h2>
      <p className={P}>
        Data stays until the owner deletes it. To remove everything: delete the app&apos;s folder in Google Drive, revoke the app&apos;s access at
        myaccount.google.com/permissions, and delete the related environment variables in Vercel. Chats can also be deleted inside the app at any time.
      </p>

      <h2 className={H2}>Contact</h2>
      <p className={P}>
        Questions about this policy can be sent to the support email address shown on the Google consent screen for this app.
      </p>
    </main>
  );
}
