import { useEffect, useRef } from 'react';
import type { TocItem, Target } from '../../../formats/types';
import { Panel } from './parts';

export function TocPanel({ toc, currentTitle, onClose, onGo }: { toc: TocItem[]; currentTitle: string; onClose: () => void; onGo: (t: Target) => void }) {
  const cur = useRef<HTMLButtonElement>(null);
  useEffect(() => { cur.current?.scrollIntoView({ block: 'center' }); }, []);
  let marked = false;
  const render = (items: TocItem[], depth: number): React.ReactNode => (
    <ul className="rb-toc" role={depth ? 'group' : 'tree'}>
      {items.map((it, i) => {
        const isCur = !marked && !!currentTitle && it.title === currentTitle;
        if (isCur) marked = true;
        return (
          <li key={i} role="treeitem" aria-expanded={it.children?.length ? true : undefined}>
            <button ref={isCur ? cur : undefined} type="button" className={`rb-toc-item${isCur ? ' is-current' : ''}`} style={{ paddingLeft: 12 + depth * 16 }} aria-current={isCur ? 'location' : undefined}
              onClick={() => onGo(it.target)}>{it.title || 'Untitled'}</button>
            {it.children?.length ? render(it.children, depth + 1) : null}
          </li>
        );
      })}
    </ul>
  );
  return (
    <Panel title="Contents" onClose={onClose}>
      {toc.length ? render(toc, 0) : <p className="rb-empty">This book has no table of contents.</p>}
    </Panel>
  );
}
