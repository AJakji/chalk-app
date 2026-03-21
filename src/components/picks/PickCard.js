import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, typography, spacing, radius } from '../../theme';

const LEAGUE_COLORS = {
  NBA: '#C9082A',
  NFL: '#013369',
  MLB: '#002D72',
  NHL: '#000000',
  Soccer: '#00A859',
};

function ConfidenceBar({ confidence }) {
  const barColor =
    confidence >= 80 ? colors.green : confidence >= 65 ? '#FFB800' : colors.red;

  return (
    <View style={styles.confidenceContainer}>
      <View style={styles.confidenceRow}>
        <Text style={styles.confidenceLabel}>Confidence</Text>
        <Text style={[styles.confidenceValue, { color: barColor }]}>
          {confidence}%
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={[styles.barFill, { width: `${confidence}%`, backgroundColor: barColor }]}
        />
      </View>
    </View>
  );
}

export default function PickCard({ pick, onPress, isTopPick }) {
  const leagueColor = LEAGUE_COLORS[pick.league] || colors.grey;

  return (
    <TouchableOpacity
      style={[styles.card, isTopPick && styles.topPickCard]}
      onPress={() => onPress(pick)}
      activeOpacity={0.85}
    >
      {/* Header row */}
      <View style={styles.header}>
        <View style={[styles.leagueBadge, { backgroundColor: leagueColor }]}>
          <Text style={styles.leagueText}>{pick.league}</Text>
        </View>
        <Text style={styles.pickType}>{pick.pickType}</Text>
        <Text style={styles.gameTime}>{pick.gameTime}</Text>
      </View>

      {/* Matchup */}
      <Text style={styles.matchup}>
        {pick.awayTeam} @ {pick.homeTeam}
      </Text>

      {/* The pick */}
      <View style={styles.pickRow}>
        <Text style={styles.pickValue}>{pick.pick}</Text>
        {pick.result === 'win' && (
          <View style={[styles.resultBadge, { backgroundColor: colors.green }]}>
            <Text style={styles.resultText}>WIN</Text>
          </View>
        )}
        {pick.result === 'loss' && (
          <View style={[styles.resultBadge, { backgroundColor: colors.red }]}>
            <Text style={styles.resultText}>LOSS</Text>
          </View>
        )}
      </View>

      {/* Short reason */}
      <Text style={styles.reason}>{pick.shortReason}</Text>

      {/* Confidence bar */}
      <ConfidenceBar confidence={pick.confidence} />

      {/* Tap hint */}
      <View style={styles.tapHint}>
        <Text style={styles.tapHintText}>Tap for full analysis →</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  topPickCard: {
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  leagueBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  leagueText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: 0.5,
  },
  pickType: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  gameTime: {
    fontSize: 11,
    color: colors.grey,
  },
  matchup: {
    ...typography.body,
    color: colors.greyLight,
    marginBottom: spacing.xs,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  pickValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.offWhite,
    flex: 1,
  },
  resultBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  resultText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: 0.5,
  },
  reason: {
    fontSize: 13,
    color: colors.grey,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  confidenceContainer: {
    marginBottom: spacing.sm,
  },
  confidenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  confidenceLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  confidenceValue: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  barTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radius.full,
  },
  tapHint: {
    marginTop: spacing.sm,
    alignItems: 'flex-end',
  },
  tapHintText: {
    fontSize: 11,
    color: colors.grey,
    fontStyle: 'italic',
  },
});
