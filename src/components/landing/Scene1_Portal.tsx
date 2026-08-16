'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Stars, Float, Text, Html } from '@react-three/drei';
import * as THREE from 'three';

function PortalRing({ radius, tube, color, speed, offset = 0 }: { radius: number; tube: number; color: string; speed: number; offset?: number }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.x = Math.sin(clock.getElapsedTime() * speed * 0.3 + offset) * 0.3;
      ref.current.rotation.z = Math.cos(clock.getElapsedTime() * speed * 0.2 + offset) * 0.2;
    }
  });

  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, tube, 32, 64]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.4}
        transparent
        opacity={0.7}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function DataStreams() {
  const count = 80;
  const ref = useRef<THREE.Points>(null);

  const [positions, speeds] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 2.5 + Math.random() * 1.5;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      spd[i] = 0.2 + Math.random() * 0.5;
    }
    return [pos, spd];
  }, [count]);

  useFrame(({ clock }) => {
    if (ref.current) {
      const elapsed = clock.getElapsedTime();
      const pos = ref.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const theta = Math.atan2(pos[i * 3 + 1], pos[i * 3]) + speeds[i] * 0.01;
        const phi = Math.acos(pos[i * 3 + 2] / 3.5);
        const r = 2.5 + Math.sin(elapsed * speeds[i] + i) * 1.5;
        pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        pos[i * 3 + 2] = r * Math.cos(phi);
      }
      ref.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.08} color="#3B82F6" transparent opacity={0.6} sizeAttenuation />
    </points>
  );
}

export default function Scene1_Portal() {
  const portalRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (portalRef.current) {
      portalRef.current.rotation.y = clock.getElapsedTime() * 0.05;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      <Stars radius={100} depth={60} count={3000} factor={4} saturation={0.5} fade speed={0.5} />

      <Float speed={0.5} rotationIntensity={0.2} floatIntensity={0.5}>
        <group ref={portalRef} position={[0, 0, -3]}>
          <PortalRing radius={2.2} tube={0.03} color="#3B82F6" speed={0.8} />
          <PortalRing radius={2.6} tube={0.02} color="#8B5CF6" speed={1.0} offset={0.5} />
          <PortalRing radius={3.0} tube={0.015} color="#06B6D4" speed={0.6} offset={1.0} />

          <DataStreams />

          <mesh>
            <sphereGeometry args={[0.8, 32, 32]} />
            <meshBasicMaterial color="#3B82F6" transparent opacity={0.15} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.4, 32, 32]} />
            <meshBasicMaterial color="#8B5CF6" transparent opacity={0.3} />
          </mesh>
        </group>
      </Float>

      <Text
        position={[0, 3.5, -3]}
        fontSize={0.5}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
      >
        TASAMI OS
      </Text>

      <Html position={[0, -4, -3]} center>
        <div className="text-center pointer-events-none">
          <p className="text-white/40 text-sm tracking-widest uppercase">Scroll to explore the universe</p>
          <div className="mt-2 flex justify-center gap-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-1.5 w-1.5 rounded-full bg-violet-400/50 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      </Html>
    </group>
  );
}
