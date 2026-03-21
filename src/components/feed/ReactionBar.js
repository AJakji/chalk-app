import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../../theme';

const REACTIONS = [
  { key: 'lock',  label: '🔒', name: 'Lock' },
  { key: 'fire',  label: '🔥', name: 'Fire' },
  { key: 'cap',   label: '🧢', name: 'Cap'  },
  { key: 'fade',  label: '👻', name: 'Fade' },
  { key: 'hit',   label: '✅', name: 'Hit'  },
];

export default function ReactionBar({ reactions, userReaction, onReact }) {
  return (
    <View style={styles.row}>
      {REACTIONS.map((r) => {
        const isActive = userReaction === r.key;
        const count = reactions[r.key] ?? 0;
        return (
          <TouchableOpacity
            key={r.key}
            style={[styles.btn, isActive && styles.btnActive]}
            onPress={() => onReact(r.key)}
            activeOpacity={0.7}
          >
            <Text style={styles.emoji}>{r.label}</Text>
            {count > 0 && (
              <Text style={[styles.count, isActive && styles.countActive]}>
                {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  btnActive: {
    backgroundColor: colors.green + '22',
    borderColor: colors.green + '66',
  },
  emoji: { fontSize: 14 },
  count: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.grey,
  },
  countActive: {
    color: colors.green,
  },
});
