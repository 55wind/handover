'use client'; // Error boundaries must be Client Components

import { useEffect } from 'react';
import Link from 'next/link';

// Shown when a page fails while drawing. No money moves on a page: a hold, a charge or a release is decided on the server.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container page">
      <div className="page-head" role="alert">
        <h1>This page could not be shown</h1>
        <p>Nothing was changed by this. A treat and its hold stay as they were.</p>
        <div className="actions">
          <button className="btn" type="button" onClick={() => retry()}>
            Try again
          </button>
          <Link className="btn btn--quiet" href="/">
            Back to the start
          </Link>
        </div>
      </div>
    </div>
  );
}
