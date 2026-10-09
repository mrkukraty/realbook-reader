/**
 * DESIGN DECISION: the page-flip engine is a custom CSS-3D implementation (DOM, transform/opacity only),
 * NOT a canvas/bitmap library such as StPageFlip. Canvas flip libraries rasterise pages, which would
 * destroy text selection, links, PDF text layers, highlights and live reflow. Here every page face is
 * real DOM, so selection/links keep working and the leaf shows the actual neighbouring pages.
 */
export interface PageFlipEngine {
  /** Turn forward. Returns false when at the end. Input during a turn is queued (max 1). */
  next(): boolean;
  prev(): boolean;
  /** Jump to page index; animates only when asked and adjacent. */
  goTo(pageIndex: number, opts?: { animate?: boolean }): void;
  isTurning(): boolean;
}
