'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Float, Text, Html } from '@react-three/drei';
import * as THREE from 'three';

function SaturnRing({ innerRadius, outerRadius, color, opacity = 0.6 }: { innerRadius: number; outerRadius: number; color: string; opacity?: number }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = clock.getElapsedTime() * 0.02;
  });

  return (
    <mesh ref={ref} rotation={[Math.PI / 3, 0, 0]}>
      <ringGeometry args={[innerRadius, outerRadius, 128]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.1}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        roughness={0.7}
        metalness={0.3}
      />
    </mesh>
  );
}

function RingParticles() {
  const count = 4000;
  const ref = useRef<THREE.Points>(null);

  const [positions, sizes] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const siz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2.8 + Math.random() * 2.2;
      const yOffset = (Math.random() - 0.5) * 0.15;
      pos[i * 3] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = yOffset;
      pos[i * 3 + 2] = Math.sin(angle) * radius;
      siz[i] = 0.01 + Math.random() * 0.03;
    }
    return [pos, siz];
  }, [count]);

  useFrame(({ clock }) => {
    if (ref.current) {
      const elapsed = clock.getElapsedTime() * 0.05;
      const pos = ref.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const x = pos[i * 3];
        const z = pos[i * 3 + 2];
        const angle = Math.atan2(z, x) + 0.002;
        const radius = Math.sqrt(x * x + z * z);
        pos[i * 3] = Math.cos(angle) * radius;
        pos[i * 3 + 2] = Math.sin(angle) * radius;
      }
      ref.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <points ref={ref} rotation={[Math.PI / 3, 0, 0]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial size={0.04} color="#8B5CF6" transparent opacity={0.6} sizeAttenuation />
    </points>
  );
}

export default function Scene2_Saturn() {
  const saturnRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (saturnRef.current) {
      saturnRef.current.rotation.y = clock.getElapsedTime() * 0.05;
    }
  });

  return (
    <group position={[0, 0, -8]}>
      <Float speed={0.3} rotationIntensity={0.05} floatIntensity={0.3}>
        <mesh ref={saturnRef}>
          <sphereGeometry args={[1.8, 64, 64]} />
          <meshStandardMaterial
            color="#D4A574"
            emissive="#8B4513"
            emissiveIntensity={0.05}
            roughness={0.8}
            metalness={0.2}
          />
        </mesh>

        <SaturnRing innerRadius={2.2} outerRadius={3.0} color="#C084FC" opacity={0.5} />
        <SaturnRing innerRadius={3.1} outerRadius={4.0} color="#818CF8" opacity={0.3} />
        <SaturnRing innerRadius={4.1} outerRadius={4.8} color="#F472B6" opacity={0.2} />

        <RingParticles />
      </Float>

      <Text
        position={[0, 3.5, 0]}
        fontSize={0.5}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
      >
        EXPLORE THE RINGS
      </Text>

      <Html position={[0, -4.5, 0]} center>
        <div className="text-center pointer-events-none">
          <p className="text-white/30 text-xs tracking-widest uppercase">Your AI agents await on the ring</p>
        </div>
      </Html>
    </group>
  );
}
