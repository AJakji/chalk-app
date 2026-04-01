import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme';
import ChalkyFace from './ChalkyFace';

export default function ChalkyAvatar({ size = 40, showGlow = false }) {
  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size / 2 },
        showGlow && styles.glow,
      ]}
    >
      <ChalkyFace size={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  glow: {
    shadowColor: colors.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 8,
  },
});
