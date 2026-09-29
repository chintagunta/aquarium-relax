import type { Mood } from '../hooks/useAquarium';

export interface HudProps {
  meals: number;
  creatures: number;
  fps: number;
  hovered: string | null;
  mood: Mood;
  sound: boolean;
  night: boolean;
  fed: boolean;
  infoHidden: boolean;
  onFeed: () => void;
  onAdd: () => void;
  onNewReef: () => void;
  onMood: (m: Mood) => void;
  onSound: (on: boolean) => void;
  onNight: (on: boolean) => void;
  onGuide: () => void;
  onToggleInfo: () => void;
}

const MOODS: Array<{ id: Mood; label: string; title: string }> = [
  { id: 'calm', label: 'Calm', title: 'Fewer fish, slower water' },
  { id: 'lively', label: 'Lively', title: 'The full reef' },
  { id: 'wild', label: 'Wild', title: 'A feeding frenzy of fish' },
];

export function Hud(props: HudProps) {
  const { meals, creatures, fps, hovered, mood, sound, night, fed, infoHidden } = props;

  // Everything that is words on the glass — the name, the numbers, the how-to —
  // answers to one switch, so the tank can be looked at on its own. The controls
  // never hide: the button that undoes this lives in there.
  return (
    <div className="hud">
      <div className="hud__top">
        <div className={panelClass('panel brand', infoHidden)}>
          <h1 className="brand__title">Yohans&apos; Reef</h1>
          <p className="brand__sub">A living tank. Click the water to feed them.</p>
        </div>

        <div
          className={panelClass('panel stats', infoHidden)}
          role="status"
          aria-live="off"
          aria-hidden={infoHidden || undefined}
        >
          <div className="stat">
            <span className="stat__value">{meals}</span>
            <span className="stat__label">Meals</span>
          </div>
          <div className="stat">
            <span className="stat__value">{creatures}</span>
            <span className="stat__label">Animals</span>
          </div>
          <div className="stat">
            <span className="stat__value">{fps > 0 ? fps : '—'}</span>
            <span className="stat__label">FPS</span>
          </div>
        </div>
      </div>

      <div className="hud__bottom">
        <div className={panelClass('panel hint', infoHidden)} aria-hidden={infoHidden || undefined}>
          <span className="hint__mark" aria-hidden="true">
            ✳
          </span>
          <p className="hint__text">
            {fed ? (
              <>
                They are on their way. <strong>Click anywhere</strong> to scatter more food — the
                crab and the goby wait for it to reach the sand. <strong>Drag</strong> or scroll to
                swim along the reef.
              </>
            ) : (
              <>
                <strong>Click the water</strong> to scatter food. Fish will turn and come for it.{" "}
                <strong>Drag or scroll</strong> to swim along the reef — it never ends.
              </>
            )}
          </p>
        </div>

        <div className="panel controls" role="toolbar" aria-label="Tank controls">
          <button type="button" className="btn btn--primary" onClick={props.onFeed}>
            Feed the reef
          </button>
          <button type="button" className="btn" onClick={props.onAdd}>
            Add an animal
          </button>
          <button type="button" className="btn" onClick={props.onNewReef}>
            New reef
          </button>
          <div className="segmented" role="group" aria-label="How busy the tank is">
            {MOODS.map((m) => (
              <button
                key={m.id}
                type="button"
                className="segmented__btn"
                aria-pressed={mood === m.id}
                title={m.title}
                onClick={() => props.onMood(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="icon-toggle"
            aria-pressed={night}
            onClick={() => props.onNight(!night)}
            title={night ? 'Bring the sun back up' : 'Let the reef go dark'}
          >
            <span className="icon-toggle__glyph" aria-hidden="true">
              {night ? '☾' : '☀'}
            </span>
            {night ? 'Night' : 'Day'}
          </button>
          <button
            type="button"
            className="sound-toggle"
            aria-pressed={sound}
            onClick={() => props.onSound(!sound)}
            title={sound ? 'Mute the water' : 'Hear the water'}
          >
            <span className="sound-toggle__bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {sound ? 'Sound on' : 'Sound off'}
          </button>
          <button type="button" className="btn" onClick={props.onGuide}>
            Field guide
          </button>
          <button
            type="button"
            className="btn btn--quiet"
            aria-pressed={infoHidden}
            onClick={props.onToggleInfo}
            title={
              infoHidden
                ? 'Bring back the name, the numbers and the how-to'
                : 'Hide the words and just watch the tank'
            }
          >
            <span className="btn__glyph" aria-hidden="true">
              {infoHidden ? '☰' : '⤫'}
            </span>
            {infoHidden ? 'Show info' : 'Hide info'}
          </button>
          {hovered ? <span className="hover-chip">{hovered}</span> : null}
        </div>
      </div>
    </div>
  );
}

/** One class list for the panels the hide switch owns. */
function panelClass(base: string, hidden: boolean) {
  return hidden ? `${base} is-hidden` : base;
}
