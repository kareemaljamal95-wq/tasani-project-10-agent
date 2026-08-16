'use client';

import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Float, Html } from '@react-three/drei';
import * as THREE from 'three';

interface AgentBotProps {
  position: [number, number, number];
  color: string;
  label: string;
  index: number;
  total: number;
}

export default function AgentBot({ position, color, label, index, total }: AgentBotProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const floatRef = useRef(0);

  useFrame(({ clock }) => {
    if (groupRef.current && !hovered) {
      floatRef.current += 0.01;
      groupRef.current.position.y += Math.sin(floatRef.current + index) * 0.001;
    }
  });

  const botColor = new THREE.Color(color);

  return (
    <group
      ref={groupRef}
      position={position}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      <Float speed={hovered ? 0 : 1} rotationIntensity={hovered ? 0 : 0.3} floatIntensity={hovered ? 0 : 0.3}>
        <group scale={hovered ? 1.15 : 1}>
          {/* Body */}
          <mesh position={[0, 0, 0]}>
            <capsuleGeometry args={[0.2, 0.35, 8, 16]} />
            <meshStandardMaterial color="white" roughness={0.2} metalness={0.6} />
          </mesh>

          {/* Head */}
          <mesh position={[0, 0.4, 0]}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial color="white" roughness={0.1} metalness={0.8} />
          </mesh>

          {/* Visor */}
          <mesh position={[0, 0.42, 0.12]}>
            <boxGeometry args={[0.2, 0.06, 0.02]} />
            <meshStandardMaterial color={botColor} emissive={botColor} emissiveIntensity={hovered ? 1 : 0.3} />
          </mesh>

          {/* Eyes */}
          <mesh position={[0.06, 0.4, 0.14]}>
            <sphereGeometry args={[0.025, 8, 8]} />
            <meshBasicMaterial color="#3B82F6" />
          </mesh>
          <mesh position={[-0.06, 0.4, 0.14]}>
            <sphereGeometry args={[0.025, 8, 8]} />
            <meshBasicMaterial color="#3B82F6" />
          </mesh>

          {/* Antenna */}
          <mesh position={[0, 0.55, 0]}>
            <cylinderGeometry args={[0.005, 0.005, 0.08, 6]} />
            <meshStandardMaterial color="#8B5CF6" emissive="#8B5CF6" emissiveIntensity={0.5} />
          </mesh>
          <mesh position={[0, 0.6, 0]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshBasicMaterial color="#8B5CF6" />
          </mesh>
        </group>
      </Float>

      {hovered && (
        <Html position={[0, 0.8, 0]} center>
          <div className="glass-panel px-4 py-2 text-center min-w-[120px]">
            <p className="text-white text-sm font-semibold">{label}</p>
            <p className="text-violet-400 text-xs mt-1">$29/mo</p>
            <button className="mt-2 px-3 py-1 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-medium hover:shadow-lg hover:shadow-violet-500/25 transition-all">
              Select Agent
            </button>
          </div>
        </Html>
      )}
    </group>
  );
}
