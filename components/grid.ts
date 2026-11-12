import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * Quartz, redrawn as one of the product's own surfaces: white, a hairline around it, the surface radius, a tinted
 * head with muted labels and a tinted row under the pointer. Every colour, the faces and the radius are the role
 * tokens in app/globals.css, so the grid follows the page when they change.
 */
export const gridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--color-surface)',
  foregroundColor: 'var(--color-text)',
  accentColor: 'var(--color-action)',
  borderColor: 'var(--color-border)',
  chromeBackgroundColor: 'var(--color-surface)',
  headerBackgroundColor: 'var(--color-bg-subtle)',
  headerTextColor: 'var(--color-text-muted)',
  headerFontWeight: 500,
  headerFontSize: 14,
  headerRowBorder: { color: 'var(--color-border)' },
  headerColumnBorder: false,
  fontFamily: 'var(--font-body)',
  fontSize: 15,
  rowHoverColor: 'var(--color-bg-subtle)',
  columnBorder: false,
  wrapperBorder: { color: 'var(--color-border)' },
  wrapperBorderRadius: 'var(--radius-surface)',
  borderRadius: 'var(--radius-inset)',
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
