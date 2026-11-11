'use client';

import { useState, type FormEvent } from 'react';
import type { Case } from '@/lib/types';

/** The `notice` body of PATCH /api/cases/:id. */
export interface Notice {
  fullName: string;
  emails: string[];
  dateOfDeath: string;
  representative: Case['representative'];
  wishes: string;
  documentText: string;
  documentDataUrl?: string;
}

function fileProblem(f: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return 'That file is not a PNG, JPEG or WebP image.';
  if (f.size > 4 * 1024 * 1024) return 'That image is larger than 4 MB. Choose a smaller one.';
  return '';
}

const readDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

/** `onCancel` is given when the form was reopened from the plan, so there is a plan to go back to. */
export function NoticeForm(p: { c: Case; locked: boolean; error: string; onFile: (n: Notice) => void; onCancel?: () => void }) {
  const { c, locked } = p;
  const [fileError, setFileError] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    const file = f.get('documentFile');
    let documentDataUrl: string | undefined;
    if (file instanceof File && file.size > 0) {
      const problem = fileProblem(file);
      setFileError(problem);
      if (problem) return;
      documentDataUrl = await readDataUrl(file);
    }
    p.onFile({
      fullName: text('fullName'),
      emails: text('emails').split(',').map((s) => s.trim()).filter(Boolean),
      dateOfDeath: text('dateOfDeath'),
      representative: { name: text('repName'), relation: text('repRelation'), email: text('repEmail') },
      wishes: text('wishes'),
      documentText: text('documentText'),
      documentDataUrl,
    });
  }

  return (
    <section className="stack" aria-labelledby="notice-h">
      <div className="stack--tight">
        <h2 id="notice-h">The notice</h2>
        {p.onCancel ? (
          <p>Filing the notice again starts a new plan. Nothing has been carried out.</p>
        ) : (
          c.demo && <p>This demo case arrives filled in. Change anything, or file it as it is.</p>
        )}
      </div>

      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <fieldset>
            <legend>The person who died</legend>
            <label className="field">
              <span>Full name</span>
              <input name="fullName" defaultValue={c.deceased.fullName} autoComplete="off" maxLength={120} required />
            </label>
            <label className="field">
              <span>Email addresses they used</span>
              <input name="emails" type="email" multiple defaultValue={c.deceased.emails.join(', ')} autoComplete="off" required />
              <span className="help">Up to five, separated by commas. Merchants match their records on these exactly.</span>
            </label>
            <label className="field">
              <span>Date of death</span>
              <input
                name="dateOfDeath"
                type="date"
                defaultValue={c.deceased.dateOfDeath}
                max={new Date().toISOString().slice(0, 10)}
                required
              />
            </label>
          </fieldset>

          <fieldset>
            <legend>Your wishes</legend>
            <label className="field">
              <span>What should happen to the payments</span>
              <textarea name="wishes" defaultValue={c.wishes} maxLength={2000} />
              <span className="help">Plain words, in any language. The agent follows them where each merchant’s policy allows.</span>
            </label>
          </fieldset>

          <fieldset>
            <legend>Who is filing</legend>
            <div className="pair">
              <label className="field">
                <span>Your name</span>
                <input name="repName" defaultValue={c.representative.name} autoComplete="name" maxLength={120} required />
              </label>
              <label className="field">
                <span>Relation to the person</span>
                <input name="repRelation" defaultValue={c.representative.relation} maxLength={60} required />
              </label>
            </div>
            <label className="field">
              <span>Your email</span>
              <input name="repEmail" type="email" defaultValue={c.representative.email} autoComplete="email" required />
            </label>
          </fieldset>

          <fieldset>
            <legend>The document</legend>
            <label className="field">
              <span>The document, as text</span>
              <textarea name="documentText" defaultValue={c.document.text} maxLength={8000} />
            </label>
            <label className="field">
              <span>Or a photo of it</span>
              <input
                name="documentFile"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-describedby="file-help"
                onChange={(e) => setFileError(e.target.files?.[0] ? fileProblem(e.target.files[0]) : '')}
              />
              <span className="help" id="file-help">
                A death certificate or a funeral home’s notice. PNG, JPEG or WebP, up to 4 MB. The check is
                demo-grade: it compares the name and the date.
              </span>
              {fileError && (
                <span className="error" role="alert">
                  {fileError}
                </span>
              )}
            </label>
          </fieldset>
        </div>

        <div className="actions">
          <button className="btn" type="submit" disabled={locked}>
            File this notice
          </button>
          {p.onCancel && (
            <button className="btn btn--quiet" type="button" onClick={p.onCancel}>
              Back to the plan
            </button>
          )}
          {p.error && (
            <span className="error" role="alert">
              {p.error}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
