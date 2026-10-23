import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { REPOSITORY_URL } from '@/lib/release.ts';

export const metadata: Metadata = {
    title: 'Privacy: Ruimte',
    description: 'What Ruimte sends when it crashes, what it counts, and what it never sends.'
};

export default function Privacy() {
    return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-16 text-[17px] leading-relaxed text-text-muted">
            <a href="/" className="hover:text-text">
                Ruimte
            </a>
            <h1 className="font-display text-4xl font-semibold text-text">Privacy</h1>
            <p>
                Ruimte sends two things. When it crashes or runs into an error, it sends a report to Observatory, my own error tracker on a server at TransIP in
                the Netherlands, so I can fix what broke. And once a day, the machine sends a handful of totals about how you used Ruimte to Observatory as
                well. This page lists what each one holds and what Ruimte keeps out of both.
            </p>

            <Section title="What a report holds">
                <ul className="flex list-disc flex-col gap-2 pl-5">
                    <li>The place in Ruimte&apos;s code where the error happened, and the first line of its message.</li>
                    <li>The Ruimte version, the operating system and its version, and the processor type.</li>
                    <li>
                        For a connection problem, whether it was this computer or another one, how they were connected, and the type of request. Never what the
                        request carried.
                    </li>
                </ul>
                <p>
                    Before a report leaves your computer, Ruimte strips paths, names, addresses and anything that looks like a secret from every line of text in
                    it. The same error goes out at most once a day.
                </p>
            </Section>

            <Section title="What Ruimte never collects">
                <p>
                    Ruimte does not collect your prompts and chats, the contents of your files, terminal output, database queries, passwords, tokens and keys,
                    the names and folders of your projects, your home folder, your username, the name of your computer, or IP addresses. Observatory does not
                    store the IP address a report arrives from.
                </p>
                <p>There are no breadcrumbs of what you clicked, no session recordings, no performance tracing and no log forwarding.</p>
            </Section>

            <Section title="Crash reports are always on">
                <p>
                    Crash reports are on in every release of the desktop app, of the machine it runs your terminals and agents on, and of the web app at
                    station.ruimte.app. There is no switch. A build from the source code on your own computer sends nothing.
                </p>
            </Section>

            <Section title="Usage statistics">
                <p>
                    The machine that runs your terminals and agents counts how often you used a few features each day. Once a day is over, it sends that
                    day&apos;s totals, once. They tell me which parts of Ruimte people actually use, which is where my time should go. A day holds:
                </p>
                <ul className="flex list-disc flex-col gap-2 pl-5">
                    <li>
                        The date, the Ruimte version, the operating system, the processor type, and whether the machine runs as a background service, beside the
                        desktop app or on its own.
                    </li>
                    <li>Whether the machine is on an account, whether the day is its first of the week or the month, and the week it first ran Ruimte.</li>
                    <li>
                        How many projects you opened and which kinds of views, how many terminals, chats and agent turns started per AI provider, and how many
                        launches, worktree merges and connections from other apps there were.
                    </li>
                    <li>How often agents used each group of Ruimte&apos;s commands, and how long the desktop app took to start.</li>
                </ul>
                <p>
                    A day carries no identifier. There is no account, no install id and no key of the machine in it, and no names, paths, prompts, file contents
                    or anything you typed. Observatory does not store the address a day comes from. Versions before 0.22 send their days through Ruimte&apos;s
                    own server on Cloudflare first, which does not log the address and does not pass it on.
                </p>
                <p>
                    Usage statistics are on by default. To turn them off, open Settings in the desktop app on the computer that runs the machine, go to Account,
                    pick the machine and switch off Usage statistics. Ruimte then deletes the days it has not sent yet. A build from the source code on your own
                    computer sends nothing.
                </p>
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
