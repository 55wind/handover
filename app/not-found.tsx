import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container page">
      <div className="page-head">
        <h1>There is no page at this address</h1>
        <p>Check the address, or start again from one of these.</p>
        <div className="actions">
          <Link className="btn" href="/send">
            Send a treat
          </Link>
          <Link className="btn btn--quiet" href="/">
            Back to the start
          </Link>
        </div>
      </div>
    </div>
  );
}
