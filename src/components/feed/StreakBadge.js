import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius } from '../../theme';

export default function StreakBadge({ streak, type }) {
  if (!streak || streak < 2) return null;
  const isHot = type === 'hot';
  return (
    <View style={[styles.badge, isHot ? styles.hot : styles.cold]}>
      <Text style={styles.icon}>{isHot ? '🔥' : '🧊'}</Text>
      <Text style={[styles.text, { color: isHot ? colors.green : colors.red }]}>
        {streak}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.full,
    gap: 3,
  },
  hot: {
    backgroundColor: colors.green + '20',
    borderWidth: 1,
    borderColor: colors.green + '44',
  },
  cold: {
    backgroundColor: colors.red + '20',
    borderWidth: 1,
    borderColor: colors.red + '44',
  },
  icon: { fontSize: 11 },
  text: {
    fontSize: 11,
    fontWeight: '800',
  },
});
