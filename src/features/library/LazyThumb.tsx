import { useEffect, useRef, useState } from 'react';
import { assetUrl, peekAssetUrl } from '../../db/assets';

// One shared observer: thumbnails only load when they scroll near the viewport.
const callbacks = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | null = null;

function getObserver() {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const cb = callbacks.get(e.target);
          if (cb) {
            callbacks.delete(e.target);
            observer!.unobserve(e.target);
            cb();
          }
        }
      },
      { rootMargin: '300px' },
    );
  }
  return observer;
}

export function LazyThumb({ assetId, alt, className = '' }: { assetId?: string; alt: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | undefined>(() => peekAssetUrl(assetId));
  useEffect(() => {
    if (!assetId) return;
    const known = peekAssetUrl(assetId);
    if (known) {
      setSrc(known);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let alive = true;
    callbacks.set(el, () => {
      void assetUrl(assetId).then((u) => alive && u && setSrc(u));
    });
    getObserver().observe(el);
    return () => {
      alive = false;
      callbacks.delete(el);
      getObserver().unobserve(el);
    };
  }, [assetId]);
  return (
    <div ref={ref} className={`thumb ${className}`}>
      {src ? <img src={src} alt={alt} draggable={false} decoding="async" /> : <span className="thumb-loading" aria-hidden="true" />}
    </div>
  );
}
