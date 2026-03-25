import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';

const LEAGUE_COLORS = {
  NBA: '#C9082A',
  MLB: '#002D72',
  NHL: '#000000',
  Soccer: '#00A859',
};

export default function RecentPickRow({ pick }) {
  const { league, pick: pickValue, game, result, odds, postedAt } = pick;
  const isWin = result === 'win';
  const isLoss = result === 'loss';
  const isPending = result === null || result === undefined;
  const leagueColor = LEAGUE_COLORS[league] || colors.grey;

  return (
    <View style={[
      styles.row,
      isWin && styles.rowWin,
      isLoss && styles.rowLoss,
    ]}>
      {/* Result indicator bar */}
      <View style={[
        styles.resultBar,
        isWin && styles.resultBarWin,
        isLoss && styles.resultBarLoss,
        isPending && styles.resultBarPending,
      ]} />

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={[styles.leagueBadge, { backgroundColor: leagueColor }]}>
            <Text style={styles.leagueText}>{league}</Text>
          </View>
          <Text style={styles.game}>{game}</Text>
          <Text style={styles.timeAgo}>{postedAt}</Text>
        </View>
        <View style={styles.bottomRow}>
          <Text style={styles.pickValue}>{pickValue}</Text>
          <View style={styles.rightRow}>
            <View style={styles.oddsChip}>
              <Text style={styles.oddsText}>{odds}</Text>
            </View>
            {isWin && (
              <View style={[styles.resultBadge, styles.badgeWin]}>
                <Text style={styles.resultBadgeText}>W</Text>
              </View>
            )}
            {isLoss && (
              <View style={[styles.resultBadge, styles.badgeLoss]}>
                <Text style={styles.resultBadgeText}>L</Text>
              </View>
            )}
            {isPending && (
              <View style={[styles.resultBadge, styles.badgePending]}>
                <Text style={[styles.resultBadgeText, { color: colors.grey }]}>–</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  rowWin: {
    borderColor: colors.green + '44',
  },
  rowLoss: {
    borderColor: colors.red + '33',
  },
  resultBar: {
    width: 4,
    backgroundColor: colors.border,
  },
  resultBarWin: { backgroundColor: colors.green },
  resultBarLoss: { backgroundColor: colors.red },
  resultBarPending: { backgroundColor: colors.grey },
  content: {
    flex: 1,
    padding: spacing.sm,
    gap: 5,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  leagueBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  leagueText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.4,
  },
  game: {
    fontSize: 11,
    color: colors.grey,
    flex: 1,
  },
  timeAgo: {
    fontSize: 10,
    color: colors.grey,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.offWhite,
    flex: 1,
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  oddsChip: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  oddsText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.greyLight,
  },
  resultBadge: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeWin: { backgroundColor: colors.green },
  badgeLoss: { backgroundColor: colors.red },
  badgePending: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.background,
  },
});
