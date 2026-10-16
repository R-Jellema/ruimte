import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { REPOSITORY_URL } from '@/lib/release.ts';

export const metadata: Metadata = {
    title: 'Privacy: Ruimte',
    description: 'What Ruimte sends when it crashes, and what it never sends.'
};

export default function Privacy() {
    return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-16 text-[17px] leading-relaxed text-text-muted">
            <a href="/" className="hover:text-text">
                Ruimte
            </a>
            <h1 className="font-display text-4xl font-semibold text-text">Privacy</h1>
            <p>
                Ruimte sends one thing: a report when it crashes or runs into an error. It goes to Sentry, on servers in the EU, and it helps me fix what broke.
                This page lists what a report holds and what Ruimte keeps out of it.
            </p>

            <Section title="What a report holds">
                <ul className="flex list-disc flex-col gap-2 pl-5">
                    <li>The place in Ruimte&apos;s code where the error happened, and the first line of its message.</li>
                    <li>The Ruimte version, the operating system and its version, and the processor type.</li>
                    <li>
                        For a connection problem, whether it was this computer or another one, how they were connected, and the type of request. Never what the
                        request carried.
                    </li>
                    <li>
                        For a crash of the desktop app itself, a minidump, which is a snapshot of the threads of the process that crashed. It can contain
                        fragments of what that process held in memory at that moment. I use it only to find where the crash happened.
                    </li>
                </ul>
                <p>
                    Before a report leaves your computer, Ruimte strips paths, names, addresses and anything that looks like a secret from every line of text in
                    it. The same error goes out at most once a day.
                </p>
            </Section>

            <Section title="What Ruimte never puts in a report">
                <p>
                    Your prompts and chats, the contents of your files, terminal output, database queries, passwords, tokens and keys, the names and folders of
                    your projects, your home folder, your username, the name of your computer, and IP addresses. Ruimte also tells Sentry not to derive an IP
                    address from the connection a report arrives on.
                </p>
                <p>There are no breadcrumbs of what you clicked, no session recordings, no performance tracing and no log forwarding.</p>
            </Section>

            <Section title="Always on">
                <p>
                    Crash reports are on in every release of the desktop app, of the machine it runs your terminals and agents on, and of the web app at
                    station.ruimte.app. There is no switch. A build from the source code on your own computer sends nothing.
                </p>
            </Section>

            <Section title="Usage statistics">
                <p>Anonymous usage statistics will follow later, separately from crash reports. This page will describe them before any release sends them.</p>
            </Section>

            <p>
                Questions go to{' '}
                <a href={`${REPOSITORY_URL}/issues`} className="text-text underline underline-offset-4">
                    the issues on GitHub
                </a>
                .
            </p>
        </main>
    );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
    return (
        <section className="flex flex-col gap-4">
            <h2 className="font-display text-2xl font-semibold text-text">{title}</h2>
            {children}
        </section>
    );
}
