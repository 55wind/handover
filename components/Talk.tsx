'use client';

import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import type { ChatMessage } from '@/lib/types';

export interface TalkWords {
  person: string; // who the reader is in the log: "You"
  agent: string; // who answers: "Agent", "Host"
  writing: string; // said while the agent works
  box: string; // label of the text box
  send: string; // the button
  log: string; // accessible name of the conversation
}

/**
 * A conversation with an agent: what was said, and a box to say more. The page owns the text in the box, so it can
 * fill it (an example sentence). `sent` is the message on its way, shown until the server's copy arrives.
 * Enter sends, Shift+Enter starts a new line.
 */
export function Talk(p: {
  id: string;
  messages: ChatMessage[];
  busy: boolean;
  sent: string;
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  words: TalkWords;
  error?: string;
  placeholder?: string;
  children?: ReactNode; // sits between the log and the box: example sentences
  boxRef?: Ref<HTMLTextAreaElement>;
  closed?: boolean; // nothing more can be said: only what was said is shown
}) {
  const log = useRef<HTMLDivElement>(null);
  const shown = p.messages.length + (p.sent ? 1 : 0);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [shown, p.busy]);

  const ready = !p.busy && p.draft.trim() !== '';

  return (
    <div className="talk">
      {shown > 0 && (
        <div className="talk__log" ref={log} role="log" aria-live="polite" aria-label={p.words.log} tabIndex={0}>
          <ol className="chat">
            {p.messages.map((m, i) => (
              <li key={i} className={m.from === 'agent' ? 'is-agent' : undefined}>
                <span>{m.from === 'person' ? p.words.person : p.words.agent}</span>
                <p>{m.text}</p>
              </li>
            ))}
            {p.sent && (
              <li className="is-pending">
                <span>{p.words.person}</span>
                <p>{p.sent}</p>
              </li>
            )}
          </ol>
        </div>
      )}
      <div className="stack--tight" role="status">
        {p.busy && (
          <>
            <p className="small">{p.words.writing}</p>
            <div className="progress" />
          </>
        )}
      </div>
      {p.children}
      <form
        hidden={p.closed}
        className="talk__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) p.onSend();
        }}
      >
        <label className="field" htmlFor={`${p.id}-box`}>
          <span>{p.words.box}</span>
          <textarea
            id={`${p.id}-box`}
            ref={p.boxRef}
            value={p.draft}
            onChange={(e) => p.onDraft(e.target.value)}
            onKeyDown={(e) => {
              // A Korean or Japanese keyboard uses Enter to finish a syllable; that Enter is not a send.
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
              e.preventDefault();
              if (ready) p.onSend();
            }}
            maxLength={1000}
            rows={3}
            placeholder={p.placeholder}
          />
        </label>
        <button className="btn btn--quiet" type="submit" disabled={!ready}>
          {p.words.send}
        </button>
        {p.error && (
          <p className="error" role="alert">
            {p.error}
          </p>
        )}
      </form>
    </div>
  );
}
