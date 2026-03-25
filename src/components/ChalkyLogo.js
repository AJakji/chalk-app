/**
 * ChalkyLogo — "chalky." wordmark in React Native Text.
 * White "chalky" + green dot. No SVG dependency needed.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { colors } from '../theme';

export default function ChalkyLogo({ size = 26 }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      <Text
        style={{
          fontSize: size,
          fontWeight: '700',
          color: colors.offWhite,
          letterSpacing: -0.5,
          includeFontPadding: false,
        }}
      >
        chalky
      </Text>
      <Text
        style={{
          fontSize: size,
          fontWeight: '700',
          color: colors.green,
          letterSpacing: -0.5,
          includeFontPadding: false,
        }}
      >
        .
      </Text>
    </View>
  );
}
