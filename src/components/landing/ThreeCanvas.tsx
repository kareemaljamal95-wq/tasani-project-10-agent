'use client';

import { Canvas } from '@react-three/fiber';
import { ScrollControls, Scroll } from '@react-three/drei';
import { Suspense } from 'react';
import Scene1_Portal from './Scene1_Portal';
import Scene2_Saturn from './Scene2_Saturn';
import Scene3_Agents from './Scene3_Agents';

export default function ThreeCanvas() {
  return (
    <Canvas
      camera={{ position: [0, 0, 12], fov: 60 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0 }}
    >
      <color attach="background" args={['#0A0B12']} />
      <fog attach="fog" args={['#0A0B12', 20, 50]} />
      <ambientLight intensity={0.2} />
      <directionalLight position={[5, 5, 5]} intensity={0.5} />
      <pointLight position={[-5, -5, -5]} intensity={0.3} color="#8B5CF6" />

      <Suspense fallback={null}>
        <ScrollControls pages={3} damping={0.3}>
          <Scroll>
            <Scene1_Portal />
            <Scene2_Saturn />
            <Scene3_Agents />
          </Scroll>
        </ScrollControls>
      </Suspense>
    </Canvas>
  );
}
