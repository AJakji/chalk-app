import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radius } from '../../theme';

// Renders 10 small squares — green = win, red = loss, grey = pending
export default function Last10Bar({ record }) {
  const picks = record?.last10 ?? [];
  return (
    <View style={styles.row}>
      {picks.map((r, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            r === 1 && styles.win,
            r === 0 && styles.loss,
            r === null && styles.pending,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 3,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  win: { backgroundColor: colors.green },
  loss: { backgroundColor: colors.red },
  pending: { backgroundColor: colors.border },
});
