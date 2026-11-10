import React, { lazy, Suspense, type ComponentType } from 'react';

/**
 * Load a named-export component on demand. The returned component brings its own
 * Suspense boundary, so call sites stay as they were (<Foo ... />).
 */
export function lazyView<P extends object>(
  loader: () => Promise<Record<string, any>>,
  name: string,
): ComponentType<P> {
  const Inner = lazy(() => loader().then((m) => ({ default: m[name] as ComponentType<any> })));
  return function LazyView(props: P) {
    return (
      <Suspense fallback={<div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400">Loading...</div>}>
        <Inner {...props} />
      </Suspense>
    );
  };
}
