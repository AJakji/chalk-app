import React from 'react';
import { Image, View, Text, StyleSheet } from 'react-native';
import { colors, radius } from '../theme';

// Displays an ESPN team logo. Falls back to a text abbreviation if no URL.
export default function TeamLogo({ uri, abbr, size = 32, style }) {
  if (!uri) {
    return (
      <View style={[styles.fallback, { width: size, height: size, borderRadius: size * 0.2 }, style]}>
        <Text style={[styles.abbrText, { fontSize: size * 0.32 }]} numberOfLines={1}>
          {abbr?.slice(0, 3) ?? '?'}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  abbrText: {
    fontWeight: '800',
    color: colors.grey,
    letterSpacing: -0.5,
  },
});
