import { memo, useLayoutEffect, useRef } from 'react';
import type { Chunk } from './chunks';
import { flowCss, type FlowStyle } from './ReflowEngine';
import { applyHighlights, type HlItem } from '../../highlights/apply';

export interface ReflowInfo { style: FlowStyle; key: string; padX: number; padY: number; pageW: number; pageH: number }

interface Props { chunk: Chunk; page: number; info: ReflowInfo; hl: HlItem[] }

/** One page = clipped viewport onto the chunk's multi-column layout, shifted by -page * pageWidth. */
export const ReflowPage = memo(function ReflowPage({ chunk, page, info, hl }: Props) {
  const flow = useRef<HTMLDivElement>(null);
  const { style, padX, padY } = info;
  useLayoutEffect(() => {
    if (flow.current) applyHighlights(flow.current, hl);
  }, [hl, chunk.html, info.key]);
  const css = flowCss(style) as React.CSSProperties;
  return (
    <div className="rb-reflow">
      <div className="rb-vp" style={{ left: padX, top: padY, width: style.cw, height: style.ch }}>
        <div
          ref={flow}
          className="rb-flow"
          lang={style.lang}
          data-chunk={chunk.index}
          data-base={chunk.textStart}
          style={{ ...css, transform: `translateX(${-page * style.cw}px)` }}
          dangerouslySetInnerHTML={{ __html: chunk.html }}
        />
      </div>
    </div>
  );
});
