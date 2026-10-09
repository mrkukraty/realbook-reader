import { Panel } from './parts';

const KEYS: [string, string][] = [
  ['← / PageUp / Shift+Space', 'Previous page'],
  ['→ / PageDown / Space', 'Next page'],
  ['Home / End', 'First / last page'],
  ['Esc', 'Show or hide the toolbars (closes open panels first)'],
  ['T', 'Contents'], ['/ or Ctrl+F', 'Search'], ['B', 'Bookmark this page'], ['N', 'Bookmarks and notes'],
  ['A', 'Appearance'], ['F', 'Fullscreen'], ['L', 'Toggle one / two page layout'], ['?', 'This help'],
];

export function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <Panel title="Keyboard shortcuts" onClose={onClose}>
      <dl className="rb-keys">{KEYS.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}</dl>
      <p className="rb-muted">Mouse: click a page edge to turn, drag a page corner to peel the page, or swipe on a touch screen. Click the middle of a page to show or hide the toolbars.</p>
    </Panel>
  );
}
