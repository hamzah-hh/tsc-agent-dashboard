import { toBlob } from 'html-to-image';

/**
 * A PNG of an element at its full width, with no scrollbars and nothing cut off.
 *
 * The element is copied into an off-screen holder as wide as its widest content, and every element in
 * that copy gets `overflow: visible`: scroll boxes (and the vertical scrollbar a horizontal scroll box
 * also gets) cannot appear, and rounded cards do not clip their tables. The page itself is not touched.
 */
export async function elementToPng(node: HTMLElement, options: { background: string; pixelRatio?: number }): Promise<Blob> {
  // The widest content inside, including what is only reachable by side scrolling on screen
  const width = Math.ceil(
    Math.max(node.scrollWidth, ...Array.from(node.querySelectorAll('table')).map((t) => t.scrollWidth + 16))
  );

  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = `position:fixed;left:-${width + 1000}px;top:0;width:${width}px;pointer-events:none;z-index:-1;`;
  const copy = node.cloneNode(true) as HTMLElement;
  copy.style.width = `${width}px`;
  copy.style.overflow = 'visible';
  copy.querySelectorAll<HTMLElement>('*').forEach((el) => {
    el.style.overflow = 'visible';
  });
  holder.appendChild(copy);
  document.body.appendChild(holder);

  try {
    if ((document as any).fonts?.ready) await (document as any).fonts.ready;
    const blob = await toBlob(copy, {
      pixelRatio: options.pixelRatio ?? 2,
      width,
      height: Math.ceil(copy.scrollHeight),
      backgroundColor: options.background,
    });
    if (!blob) throw new Error('The image could not be made.');
    return blob;
  } finally {
    holder.remove();
  }
}
