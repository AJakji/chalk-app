import React, { useState } from 'react';
import { View, Text, Image } from 'react-native';

/**
 * PlayerAvatar — shows a real headshot photo when available,
 * gracefully falls back to a coloured initials circle if the image fails.
 *
 * Props:
 *   name      {string}  — player full name (used for initials + hue)
 *   headshot  {string}  — headshot URL (optional)
 *   size      {number}  — diameter in points (default 36)
 */
export default function PlayerAvatar({ name, headshot, size = 36 }) {
  const [error, setError] = useState(false);

  const parts    = (name || '').trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0]?.[0] || '?').toUpperCase();
  const hue = (name || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  const circle = {
    width: size, height: size, borderRadius: size / 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  };

  if (headshot && !error) {
    return (
      <Image
        source={{ uri: headshot }}
        style={[circle, { backgroundColor: `hsl(${hue},40%,18%)` }]}
        onError={() => setError(true)}
      />
    );
  }

  return (
    <View style={[
      circle,
      {
        backgroundColor: `hsl(${hue},55%,28%)`,
        borderWidth: 1,
        borderColor: `hsl(${hue},55%,45%)`,
      },
    ]}>
      <Text style={{ fontSize: size * 0.35, fontWeight: '700', color: '#fff', letterSpacing: 0.5 }}>
        {initials}
      </Text>
    </View>
  );
}
