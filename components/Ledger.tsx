'use client';

import { useEffect, useState } from 'react';
import type { ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import type { LedgerEntry, MerchantSlug } from '@/lib/types';
import { gridDefaults, gridTheme } from './grid';
import { CopyId, sentence, withoutMerchant } from './ui';

// Kept short enough to sit on one line in the Action column.
const TOOL: Record<string, string> = {
  find_customer_records: 'Look up records',
  get_policy: 'Read policy',
  show_subscription_details: 'Read subscription',
  get_invoice: 'Read invoice',
  get_order: 'Read order',
  get_refund: 'Read refund',
  suspend_subscription: 'Pause subscription',
  activate_subscription: 'Resume subscription',
  cancel_subscription: 'Close subscription',
  create_refund: 'Refund payment',
  cancel_invoice_auto_reminder: 'Stop reminders',
  cancel_sent_invoice: 'Cancel invoice',
  create_subscription: 'New subscription',
  generate_invoice_qr_code: 'Make payment code',
};

const STAMP = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const result = (e: LedgerEntry) => (e.denied ? 'Blocked by policy' : e.ok ? 'Done' : 'Failed');

const COLS: ColDef<LedgerEntry>[] = [
  { headerName: 'Time', field: 'ts', width: 146, valueFormatter: (p) => STAMP.format(new Date(p.value)) },
  { headerName: 'Case', field: 'caseId', width: 132, cellClass: 'mono' },
  { headerName: 'Action', field: 'tool', width: 180, valueFormatter: (p) => TOOL[p.value] ?? sentence(p.value) },
  {
    headerName: 'Target',
    field: 'target',
    width: 226,
    cellRenderer: (p: { value?: string }) => (p.value ? <CopyId value={p.value} /> : null),
  },
  {
    headerName: 'Result',
    width: 156,
    valueGetter: (p) => p.data && result(p.data),
    cellClass: (p) => (p.value === 'Done' ? '' : 'state--bad'),
  },
  {
    headerName: 'Summary',
    field: 'summary',
    flex: 1,
    minWidth: 280,
    wrapText: true,
    autoHeight: true,
    valueFormatter: (p) => withoutMerchant(p.value),
  },
];

// The ledger grows with its rows up to about twelve of them, then scrolls inside itself.
const theme = gridTheme.withParams({ autoHeightMaxBodyHeight: 520 });

interface Console {
  ledger: LedgerEntry[];
  sharedSlot: boolean;
}

export function Ledger({ slug }: { slug: MerchantSlug }) {
  const [data, setData] = useState<Console | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    async function load() {
      if (document.hidden) return;
      const next: Console | null = await fetch(`/api/merchants/${slug}`).then((r) => (r.ok ? r.json() : null), () => null);
      if (!live) return;
      setFailed(!next);
      // The ledger only ever grows, so an unchanged length means there is nothing new to draw.
      if (next) setData((old) => (old && old.ledger.length === next.ledger.length ? old : next));
    }
    load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [slug]);

  return (
    <section className="stack" aria-labelledby="ledger-h">
      <div className="stack--tight">
        <h2 id="ledger-h">Ledger</h2>
        <p>Every call made on this merchant’s PayPal account, newest first. It refreshes every five seconds.</p>
        {data?.sharedSlot && <p className="muted">In this demo the three merchants share one PayPal sandbox account.</p>}
      </div>
      <div role="status">
        {failed && <p className="error">The ledger could not be loaded. It will be tried again in five seconds.</p>}
        {!data && !failed && <p className="muted">Loading the ledger.</p>}
        {data?.ledger.length === 0 && (
          <p className="well">
            No actions yet. When a notice reaches this merchant, each call the agent makes is listed here, including the
            ones the merchant’s rules blocked.
          </p>
        )}
      </div>
      {data && data.ledger.length > 0 && (
        <div className="grid--lead ledger">
          <AgGridReact<LedgerEntry> {...gridDefaults} theme={theme} rowData={data.ledger} columnDefs={COLS} domLayout="autoHeight" />
        </div>
      )}
    </section>
  );
}
