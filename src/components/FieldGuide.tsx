import { useEffect, useMemo, useRef, useState } from 'react';
import { SPECIES, SPECIES_BY_ID, SPECIES_GROUPS, SIZE_EXP } from '../sim/species';
import type { Creature } from '../sim/types';

interface Props {
  open: boolean;
  onClose: () => void;
  creatures: Creature[];
}

/** A real <dialog>, so Escape and focus handling come from the platform. */
export function FieldGuide({ open, onClose, creatures }: Props) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setClosing(false);
    } else if (!open && el.open) {
      setClosing(true);
      const t = window.setTimeout(() => {
        setClosing(false);
        el.close();
      }, 180);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const live = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of creatures) counts.set(c.species.id, (counts.get(c.species.id) ?? 0) + 1);
    return counts;
  }, [creatures]);

  const total = creatures.length;

  return (
    <dialog
      ref={ref}
      className="guide"
      style={closing ? { opacity: 0, transform: 'translateY(8px)', transition: 'opacity 180ms, transform 180ms' } : { transition: 'opacity 220ms, transform 220ms' }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="guide-title"
    >
      <div className="guide__head">
        <div>
          <h2 className="guide__title" id="guide-title">
            Field guide
          </h2>
          <p className="guide__count">
            {total} animals in the tank · {SPECIES.length} species known · sized from real adult
            lengths, compressed {SIZE_EXP.toFixed(2)}:1
          </p>
        </div>
        <button type="button" className="guide__close" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
      <div className="guide__body">
        {SPECIES_GROUPS.map((group) => (
          <section className="guide__group" key={group.title}>
            <h3 className="guide__group-title">{group.title}</h3>
            <ul className="guide__list">
              {group.ids.map((id) => {
                const s = SPECIES_BY_ID[id];
                if (!s) return null;
                const count = live.get(id) ?? 0;
                return (
                  <li className="guide__item" key={id}>
                    <span>
                      <span className="guide__name">
                        {s.label}
                        <span className="guide__size">{s.realCm} cm</span>
                      </span>
                      <span className="guide__note">{s.note}</span>
                    </span>
                    <span className="guide__badge">{count > 0 ? `×${count}` : '—'}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </dialog>
  );
}
