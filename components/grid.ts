import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

/** Quartz, redrawn in the page's own paper, ink and hairlines. Colours and faces come from the tokens in app/globals.css. */
export const gridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--color-paper)',
  foregroundColor: 'var(--color-ink)',
  accentColor: 'var(--color-accent)',
  borderColor: 'var(--color-rule)',
  chromeBackgroundColor: 'var(--color-paper)',
  headerBackgroundColor: 'var(--color-paper)',
  headerTextColor: 'var(--color-muted)',
  headerFontWeight: 500,
  headerFontSize: 14,
  headerRowBorder: { color: 'var(--color-rule-2)' },
  headerColumnBorder: false,
  fontFamily: 'var(--font-body)',
  fontSize: 15,
  rowHoverColor: 'var(--color-paper-2)',
  columnBorder: false,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  borderRadius: 0,
  cellHorizontalPadding: 12,
});

/**
 * Shared grid behaviour. The cells hold real controls (copy buttons, the refund button), so the grid's own
 * focus handling is switched off and Tab walks those controls in reading order: no cell or header focus,
 * tabIndex -1 takes the grid's tab guards out of the order (they would otherwise jump over the rows, and with
 * header focus on, Tab cycles the headers and never leaves), and every key pressed inside a cell is left to the
 * browser. Rows keep the order the server gives unless a grid turns sorting on.
 */
export const gridDefaults = {
  theme: gridTheme,
  suppressCellFocus: true,
  suppressHeaderFocus: true,
  tabIndex: -1,
  ensureDomOrder: true,
  enableCellTextSelection: true,
  suppressMovableColumns: true,
  defaultColDef: {
    sortable: false,
    resizable: false,
    suppressKeyboardEvent: () => true,
  },
} as const;
