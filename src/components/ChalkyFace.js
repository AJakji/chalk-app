import React from 'react';
import ChalkyFaceSvg from '../../assets/chalky-face.svg';

/**
 * Chalky face logo — use in tight/small slots:
 * pick cards, chat bubbles, avatar rows, inline icons.
 *
 * Usage:
 *   <ChalkyFace size={24} />
 *   <ChalkyFace width={32} height={32} />
 */
export default function ChalkyFace({ size, width, height, style }) {
  const w = width  ?? size ?? 24;
  const h = height ?? size ?? 24;
  return <ChalkyFaceSvg width={w} height={h} style={style} />;
}
