'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';
import AgentBot from './AgentBot';

const AGENTS = [
  { label: 'CEO', color: '#8B5CF6' },
  { label: 'SALES', color: '#10B981' },
  { label: 'MARKETING', color: '#3B82F6' },
  { label: 'RESEARCH', color: '#F59E0B' },
  { label: 'FINANCE', color: '#059669' },
  { label: 'OPERATIONS', color: '#EC4899' },
  { label: 'SUPPORT', color: '#6366F1' },
  { label: 'FASHION', color: '#D946EF' },
];

function CarouselRing() {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = clock.getElapsedTime() * 0.01;
  });

  return (
    <mesh ref={ref} rotation={[Math.PI / 2.5, 0, 0]}>
      <ringGeometry args={[4.2, 5.0, 128]} />
      <meshStandardMaterial
        color="#8B5CF6"
        emissive="#8B5CF6"
        emissiveIntensity={0.15}
        transparent
        opacity={0.25}
        side={THREE.DoubleSide}
        roughness={0.3}
        metalness={0.7}
      />
    </mesh>
  );
}

function GlowRing() {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.z = clock.getElapsedTime() * 0.015;
      (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.1 + Math.sin(clock.getElapsedTime() * 0.5) * 0.05;
    }
  });

  return (
    <mesh ref={ref} rotation={[Math.PI / 2.5, 0, 0]}>
      <ringGeometry args={[4.6, 4.8, 64]} />
      <meshBasicMaterial color="#3B82F6" transparent opacity={0.1} side={THREE.DoubleSide} />
    </mesh>
  );
}

export default function Scene3_Agents() {
  const agentPositions = useMemo(() => {
    return AGENTS.map((_, i) => {
      const angle = (i / AGENTS.length) * Math.PI * 2 - Math.PI / 2;
      const radius = 4.6;
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * 0.3,
        z: Math.sin(angle) * radius,
        angle,
      };
    });
  }, []);

  return (
    <group position={[0, 0, -16]}>
      <CarouselRing />
      <GlowRing />

      {AGENTS.map((agent, i) => (
        <AgentBot
          key={agent.label}
          position={[agentPositions[i].x, agentPositions[i].y, agentPositions[i].z]}
          color={agent.color}
          label={agent.label}
          index={i}
          total={AGENTS.length}
        />
      ))}

    </group>
  );
}
