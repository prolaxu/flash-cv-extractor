import type { TextItem, TextItems } from "../types";

/**
 * Step 1b: Put a page's text items into reading order.
 *
 * The rest of the parser assumes a single column of text that arrives top to
 * bottom, which is how most pdf generators emit it. Two common layouts break
 * that assumption:
 *
 *  - Design oriented templates emit text items in an arbitrary order, so a
 *    heading can arrive after the paragraph that sits below it.
 *  - Two column resumes interleave the sidebar and the main column, so joining
 *    text by vertical position alone mixes the two together.
 *
 * This step detects a two column body (optionally under a full width header)
 * and re-emits the items as header, then left column, then right column, which
 * is the order a human reads them in. Pages that are already a single column
 * are returned untouched.
 */

// A column has to hold a meaningful amount of text before we believe in it,
// otherwise a sparse page (e.g. a trailing page with a few lines) looks like
// two columns by coincidence.
const MIN_COLUMN_ITEMS = 8;
// Items that straddle the gutter are the full width header. Allow only a few,
// since in a single column resume nearly every line straddles the middle.
const MAX_CROSSING_RATIO = 0.12;
// Only look for a gutter in the middle of the page
const GUTTER_SEARCH_START_RATIO = 0.25;
const GUTTER_SEARCH_END_RATIO = 0.75;
const GUTTER_SEARCH_STEP = 2;

const getXEnd = (item: TextItem) => item.x + item.width;

interface Gutter {
  x: number;
  /** The y below which the page splits into two columns */
  ySplit: number;
}

/**
 * Find the x position of the gap between two columns, or undefined if the page
 * isn't laid out in two columns.
 */
const findColumnGutter = (
  textItems: TextItems,
  pageWidth: number
): Gutter | undefined => {
  if (textItems.length < MIN_COLUMN_ITEMS * 2) return undefined;

  let best: { x: number; crossing: number } | undefined;
  for (
    let x = pageWidth * GUTTER_SEARCH_START_RATIO;
    x <= pageWidth * GUTTER_SEARCH_END_RATIO;
    x += GUTTER_SEARCH_STEP
  ) {
    let left = 0;
    let right = 0;
    let crossing = 0;
    for (const item of textItems) {
      if (getXEnd(item) <= x) left++;
      else if (item.x >= x) right++;
      else crossing++;
    }

    if (left < MIN_COLUMN_ITEMS || right < MIN_COLUMN_ITEMS) continue;
    if (crossing > textItems.length * MAX_CROSSING_RATIO) continue;
    if (!best || crossing < best.crossing) best = { x, crossing };
  }

  if (!best) return undefined;

  // Everything that straddles the gutter has to sit above the two columns for
  // this to be a header-plus-columns layout. If the straddling items are spread
  // through the page it is a single column of text that merely has a ragged
  // right edge, and reordering it would do harm.
  const crossingItems = textItems.filter(
    (item) => item.x < best!.x && getXEnd(item) > best!.x
  );
  const ySplit =
    crossingItems.length === 0
      ? Infinity
      : Math.min(...crossingItems.map((item) => item.y));

  const below = textItems.filter((item) => item.y < ySplit);
  const leftBelow = below.filter((item) => getXEnd(item) <= best!.x).length;
  const rightBelow = below.filter((item) => item.x >= best!.x).length;
  if (leftBelow < MIN_COLUMN_ITEMS || rightBelow < MIN_COLUMN_ITEMS) {
    return undefined;
  }

  return { x: best.x, ySplit };
};

/** Sort into reading order: top to bottom, then left to right. */
const byReadingOrder = (a: TextItem, b: TextItem) =>
  Math.round(b.y) - Math.round(a.y) || a.x - b.x;

/**
 * Recompute hasEOL, which the next step uses to group items into lines. The
 * original flags describe the pdf's own emission order, so once items have been
 * moved they no longer mark the end of a visual line.
 */
const setEndOfLineFlags = (textItems: TextItems): TextItems => {
  return textItems.map((item, i) => {
    const next = textItems[i + 1];
    // Tolerate sub-pixel baseline jitter within a single rendered line
    const tolerance = Math.max(2, item.height * 0.3);
    const isLastOnLine = !next || Math.abs(next.y - item.y) > tolerance;
    return { ...item, hasEOL: isLastOnLine };
  });
};

/**
 * Reorder a single page's text items into reading order. Returns the input
 * unchanged when the page is a single column.
 */
export const toReadingOrder = (
  textItems: TextItems,
  pageWidth: number
): TextItems => {
  const gutter = findColumnGutter(textItems, pageWidth);
  if (!gutter) {
    return textItems;
  }

  const header: TextItems = [];
  const leftColumn: TextItems = [];
  const rightColumn: TextItems = [];
  for (const item of textItems) {
    if (item.y >= gutter.ySplit) {
      header.push(item);
      continue;
    }
    // Place an item that straddles the gutter by its midpoint
    const midpoint = item.x + item.width / 2;
    if (midpoint < gutter.x) leftColumn.push(item);
    else rightColumn.push(item);
  }

  header.sort(byReadingOrder);
  leftColumn.sort(byReadingOrder);
  rightColumn.sort(byReadingOrder);

  return setEndOfLineFlags([...header, ...leftColumn, ...rightColumn]);
};
