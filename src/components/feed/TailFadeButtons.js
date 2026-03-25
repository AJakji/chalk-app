import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { colors, radius, spacing } from '../../theme';

export default function TailFadeButtons({ tails, fades, affiliateLinks, result, onTail, onFade }) {
  // After a result, tapping opens the sportsbook anyway (for future bets)
  const handleTail = () => {
    onTail?.();
    const url = affiliateLinks?.fanduel || affiliateLinks?.draftkings || 'https://fanduel.com';
    Linking.openURL(url);
  };

  const handleFade = () => {
    onFade?.();
    const url = affiliateLinks?.draftkings || affiliateLinks?.fanduel || 'https://draftkings.com';
    Linking.openURL(url);
  };

  const isSettled = !!result;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.btn, styles.tailBtn, isSettled && result === 'win' && styles.tailBtnWin]}
        onPress={handleTail}
        activeOpacity={0.8}
      >
        <Text style={styles.tailIcon}>
          {isSettled && result === 'win' ? '✅' : '👆'}
        </Text>
        <View>
          <Text style={styles.tailLabel}>
            {isSettled ? (result === 'win' ? 'Tailed — Win' : 'Tailed — Loss') : 'Tail'}
          </Text>
          <Text style={styles.tailCount}>{tails.toLocaleString()} tailing</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, styles.fadeBtn, isSettled && result === 'loss' && styles.fadeBtnWin]}
        onPress={handleFade}
        activeOpacity={0.8}
      >
        <Text style={styles.fadeIcon}>
          {isSettled && result === 'loss' ? '✅' : '👇'}
        </Text>
        <View>
          <Text style={styles.fadeLabel}>
            {isSettled ? (result === 'loss' ? 'Faded — Win' : 'Faded — Loss') : 'Fade'}
          </Text>
          <Text style={styles.fadeCount}>{fades.toLocaleString()} fading</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  tailBtn: {
    backgroundColor: colors.green + '14',
    borderColor: colors.green + '44',
  },
  tailBtnWin: {
    backgroundColor: colors.green + '28',
    borderColor: colors.green + '88',
  },
  fadeBtn: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
  },
  fadeBtnWin: {
    backgroundColor: colors.green + '14',
    borderColor: colors.green + '44',
  },
  tailIcon: { fontSize: 18 },
  fadeIcon: { fontSize: 18 },
  tailLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.green,
  },
  tailCount: {
    fontSize: 10,
    color: colors.green + 'AA',
    marginTop: 1,
  },
  fadeLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.grey,
  },
  fadeCount: {
    fontSize: 10,
    color: colors.grey,
    marginTop: 1,
  },
});
