'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useRef } from 'react';
import * as THREE from 'three';
import Scene1_Portal from './Scene1_Portal';
import Scene2_Saturn from './Scene2_Saturn';
import Scene3_Agents from './Scene3_Agents';

/**
 * The landing backdrop.
 *
 * Purely decorative: no text and no DOM live inside the canvas. They used to,
 * and that was the bug — drei's `Text` and `Html` anchor to a 3D point, so all
 * three scenes drew their headings at once, on top of each other and on top of
 * the real page. Copy now lives in ordinary DOM above this layer, which also
 * makes it selectable, translatable and reachable by a screen reader.
 *
 * `ScrollControls` is gone for the same reason it never worked: it builds its
 * own scroll container inside a fixed canvas, so the page's scroll never
 * reached it and the camera never moved. The page owns the scroll and hands
 * the progress down.
 */

const NEAR = 12;
const FAR = -13;

function Rig({ progress }: { progress: React.RefObject<number> }) {
  useFrame(({ camera }, delta) => {
    const target = THREE.MathUtils.lerp(NEAR, FAR, progress.current ?? 0);
    // Frame-rate independent easing, so the travel feels the same on a 60Hz
    // laptop and a 144Hz monitor.
    camera.position.z = THREE.MathUtils.damp(camera.position.z, target, 3, delta);
  });

  return null;
}

export default function ThreeCanvas({
  progress,
}: {
  progress: React.RefObject<number>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  return (
    <Canvas
      ref={ref}
      camera={{ position: [0, 0, NEAR], fov: 60 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      // Behind everything, and inert: the backdrop must never intercept a
      // click meant for a button in the layer above it.
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
      }}
    >
      <color attach="background" args={['#0A0B12']} />
      <fog attach="fog" args={['#0A0B12', 22, 55]} />
      <ambientLight intensity={0.2} />
      <directionalLight position={[5, 5, 5]} intensity={0.5} />
      <pointLight position={[-5, -5, -5]} intensity={0.3} color="#8B5CF6" />

      <Suspense fallback={null}>
        <Rig progress={progress} />
        <Scene1_Portal />
        <Scene2_Saturn />
        <Scene3_Agents />
      </Suspense>
    </Canvas>
  );
}
