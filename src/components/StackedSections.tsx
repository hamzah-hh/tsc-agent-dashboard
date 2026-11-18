import React, { useEffect, useRef, useState } from 'react';

export interface StackedSection {
  id: string;
  title: string;
  node: React.ReactNode;
}

/** Mounts its children when it first scrolls near the screen (or is asked to), and keeps them mounted after. */
function LazySection({ id, title, open, children }: { id: string; title: string; open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen || open) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: '700px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, open]);

  const mounted = seen || open;
  return (
    <section ref={ref} id={`section-${id}`} className="scroll-mt-4" aria-label={title}>
      <h2 className="text-[11px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400 font-mono mb-3 flex items-center gap-2">
        <span className="h-px flex-1 bg-slate-200 dark:bg-line" />
        {title}
        <span className="h-px flex-1 bg-slate-200 dark:bg-line" />
      </h2>
      {mounted ? children : <div className="h-60 rounded-2xl border border-dashed border-slate-200 dark:border-line flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">Loading {title}...</div>}
    </section>
  );
}

/**
 * Several views stacked into one page: a row of jump links on top, and each section loads as it comes near the
 * screen, so the page does not request every view's data at once. `jumpTo` ({ id, n }) scrolls to a section
 * from code (a button inside one section that points at another); change `n` to jump to the same one again.
 */
export function StackedSections({ sections, jumpTo }: { sections: StackedSection[]; jumpTo?: { id: string; n: number } | null }) {
  const [forced, setForced] = useState<Set<string>>(new Set());

  const goTo = (id: string) => {
    setForced((prev) => new Set(prev).add(id));
    // Wait a frame so the section has its content before scrolling to it
    requestAnimationFrame(() => document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  useEffect(() => {
    if (jumpTo) goTo(jumpTo.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo?.id, jumpTo?.n]);

  return (
    <div className="space-y-8">
      <nav aria-label="Sections" className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide font-bold text-slate-500 dark:text-slate-400 mr-1">Jump to</span>
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => goTo(s.id)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 dark:border-line text-slate-700 dark:text-fg-2 hover:bg-slate-50 dark:hover:bg-hover transition"
          >
            {s.title}
          </button>
        ))}
      </nav>
      {sections.map((s, i) => (
        <LazySection key={s.id} id={s.id} title={s.title} open={i === 0 || forced.has(s.id)}>
          {s.node}
        </LazySection>
      ))}
    </div>
  );
}
