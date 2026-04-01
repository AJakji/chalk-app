import React from 'react';
import ChalkyMascotSvg from '../../assets/chalky-mascot.svg';

/**
 * Chalky full mascot — use in large/hero slots:
 * onboarding hero, empty states, detail modals, research screen.
 *
 * Usage:
 *   <ChalkyMascot size={120} />
 *   <ChalkyMascot width={200} height={200} />
 */
export default function ChalkyMascot({ size, width, height, style }) {
  const w = width  ?? size ?? 120;
  const h = height ?? size ?? 120;
  return <ChalkyMascotSvg width={w} height={h} style={style} />;
}
