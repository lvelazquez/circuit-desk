// Scenes: the 16 scenes with what each plays, the scene chain, and storing the current chains in a
// scene. Track order inside a scene is assumed (see core-service getScenes), so the view says so.
import { useState, type CSSProperties } from "react";
import type { TrackName } from "@circuit-desk/core-service";
import type { Scenes } from "./desk.ts";
import { TRACK_NAMES, trackStyle } from "./tracks.ts";
import { NumberField } from "./NumberField.tsx";

export interface ScenesProps {
  scenes: Scenes;
  onSceneChain: (first: number, last: number) => void;
  onScene: (scene: number, chains: Partial<Record<TrackName, { first: number; last: number }>>, label: string) => void;
  /** The scene the Play button is looping, if one is playing. */
  playing: number | null;
  onPlayScene: (scene: number) => void;
}

const chainText = (c: { first: number; last: number } | undefined): string => (!c ? "–" : c.first === c.last ? `${c.first}` : `${c.first}–${c.last}`);

export function ScenesView({ scenes, onSceneChain, onScene, playing, onPlayScene }: ScenesProps) {
  const [selected, setSelected] = useState(1);
  const scene = scenes.scenes[selected - 1];
  const inChain = (n: number): boolean => n >= scenes.sceneChain.first && n <= scenes.sceneChain.last;
  return (
    <section aria-label="Scenes" style={{ "--track": "var(--color-scene)" } as CSSProperties}>
      <div role="radiogroup" aria-label="Scene" className="grid">
        {scenes.scenes.map((s) => (
          <button key={s.scene} type="button" role="radio" aria-checked={s.scene === selected} tabIndex={s.scene === selected ? 0 : -1}
            className="pad scene" data-on={s.saved} data-selected={s.scene === selected} data-outside={!inChain(s.scene)} data-playing={s.scene === playing}
            aria-label={`Scene ${s.scene}: ${s.saved ? "saved" : "empty"}${inChain(s.scene) ? ", in the scene chain" : ""}${s.scene === playing ? ", playing" : ""}`}
            onClick={() => setSelected(s.scene)}
            onKeyDown={(e) => {
              const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 8 : e.key === "ArrowUp" ? -8 : 0;
              const n = s.scene + d;
              if (!d || n < 1 || n > 16) return;
              e.preventDefault(); setSelected(n);
              (e.currentTarget.parentElement?.children[n - 1] as HTMLElement | undefined)?.focus();
            }}>
            <span className="pad-num" aria-hidden="true">{s.scene}</span>
            <span aria-hidden="true">{s.saved ? "saved" : ""}</span>
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: "var(--space-md)" }}>
        <span className="hint">Scene chain (played in turn):</span>
        <NumberField label="From scene" value={scenes.sceneChain.first} min={1} max={16} onCommit={(v) => onSceneChain(v, Math.max(v, scenes.sceneChain.last))} />
        <NumberField label="To scene" value={scenes.sceneChain.last} min={1} max={16} onCommit={(v) => onSceneChain(Math.min(v, scenes.sceneChain.first), v)} />
      </div>

      {scene && (
        <fieldset className="scene-table">
          <legend>Scene {scene.scene}: {scene.saved ? "saved" : "empty"}</legend>
          <table>
            <thead><tr><th scope="col">Track</th><th scope="col">Plays patterns</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Now playing</th></tr></thead>
            <tbody>
              {TRACK_NAMES.map((t) => {
                const c = scene.chains[t];
                return (
                  <tr key={t} style={trackStyle(t)}>
                    <th scope="row"><span className="swatch" aria-hidden="true" />{t}</th>
                    <td>{chainText(c)}</td>
                    <td><NumberField hideLabel label={`${t} from pattern`} value={c?.first ?? 1} min={1} max={8} onCommit={(v) => onScene(scene.scene, { [t]: { first: v, last: Math.max(v, c?.last ?? v) } }, `scene ${scene.scene} ${t}`)} /></td>
                    <td><NumberField hideLabel label={`${t} to pattern`} value={c?.last ?? 1} min={1} max={8} onCommit={(v) => onScene(scene.scene, { [t]: { first: Math.min(v, c?.first ?? v), last: v } }, `scene ${scene.scene} ${t}`)} /></td>
                    <td>{chainText(scenes.currentChains[t])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="row">
            <button type="button" className="btn" onClick={() => onPlayScene(scene.scene)}>▶ Play scene {scene.scene}</button>
            <button type="button" className="btn" onClick={() => onScene(scene.scene, scenes.currentChains, `stored the current chains in scene ${scene.scene}`)}>Store current chains in scene {scene.scene}</button>
          </div>
          <p className="hint">{scenes.note}.</p>
        </fieldset>
      )}
    </section>
  );
}
