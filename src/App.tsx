import { useCallback, useEffect, useRef, useState } from 'react';
import { FieldGuide } from './components/FieldGuide';
import { Hud } from './components/Hud';
import { useAquarium } from './hooks/useAquarium';
import type { Creature } from './sim/types';
import './styles/app.css';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideCreatures, setGuideCreatures] = useState<Creature[]>([]);
  const [fedOnce, setFedOnce] = useState(false);
  const [infoHidden, setInfoHidden] = useState(false);
  const noticeTimer = useRef(0);

  const onNotice = useCallback((text: string) => {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2400);
  }, []);

  const {
    stats, feed, addCreature, newReef, setMood, mood,
    setSound, sound, setNight, night, hovered, getCreatures,
  } = useAquarium(canvasRef, { onNotice });

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // Feeding happens on the canvas so the crumbs land exactly where you clicked;
  // these give the same action a keyboard and button path.
  const feedAtPointer = useCallback(() => {
    feed();
    setFedOnce(true);
  }, [feed]);

  const onCanvasKey = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (event.key === 'f' || event.key === 'F' || event.key === ' ') {
        event.preventDefault();
        feedAtPointer();
      }
    },
    [feedAtPointer],
  );

  const openGuide = useCallback(() => {
    setGuideCreatures(getCreatures());
    setGuideOpen(true);
  }, [getCreatures]);

  return (
    <div className="app" data-light={night ? 'night' : 'day'} data-chrome={infoHidden ? 'bare' : 'full'}>
      <canvas
        ref={canvasRef}
        className="tank"
        tabIndex={0}
        role="application"
        aria-label="Aquarium. Press F or Space to scatter food where the pointer is."
        onKeyDown={onCanvasKey}
      />

      <Hud
        meals={stats.meals}
        creatures={stats.creatures}
        fps={stats.fps}
        hovered={hovered}
        mood={mood}
        sound={sound}
        night={night}
        fed={fedOnce}
        infoHidden={infoHidden}
        onFeed={feedAtPointer}
        onAdd={() => addCreature()}
        onNewReef={newReef}
        onMood={setMood}
        onSound={setSound}
        onNight={setNight}
        onGuide={openGuide}
        onToggleInfo={() => setInfoHidden((v) => !v)}
      />

      {notice ? <div className="notice">{notice}</div> : null}

      <FieldGuide open={guideOpen} onClose={() => setGuideOpen(false)} creatures={guideCreatures} />
    </div>
  );
}
