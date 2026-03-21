import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';

const LEAGUE_COLORS = {
  NBA: '#C9082A',
  NFL: '#013369',
  MLB: '#002D72',
  NHL: '#000000',
  Soccer: '#00A859',
};

export default function RoomCard({ room, onPress }) {
  const { league, title, status, clock, awayTeam, homeTeam, chalkPick, activeUsers } = room;
  const isLive = status === 'live';
  const leagueColor = LEAGUE_COLORS[league] || colors.grey;

  return (
    <TouchableOpacity
      style={[styles.card, isLive && styles.cardLive]}
      onPress={() => onPress(room)}
      activeOpacity={0.85}
    >
      {/* Top row */}
      <View style={styles.topRow}>
        <View style={[styles.leagueBadge, { backgroundColor: leagueColor }]}>
          <Text style={styles.leagueText}>{league}</Text>
        </View>
        {isLive ? (
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE · {clock}</Text>
          </View>
        ) : (
          <Text style={styles.upcomingTime}>{clock}</Text>
        )}
      </View>

      {/* Score / matchup */}
      {isLive ? (
        <View style={styles.scoreRow}>
          <Text style={styles.teamAbbr}>{awayTeam.abbr}</Text>
          <Text style={styles.scoreNum}>{awayTeam.score}</Text>
          <Text style={styles.scoreDash}>—</Text>
          <Text style={styles.scoreNum}>{homeTeam.score}</Text>
          <Text style={styles.teamAbbr}>{homeTeam.abbr}</Text>
        </View>
      ) : (
        <Text style={styles.matchupText}>
          {awayTeam.abbr} @ {homeTeam.abbr}
        </Text>
      )}

      <Text style={styles.title} numberOfLines={1}>{title}</Text>

      {/* Bottom row: chalk pick + active users */}
      <View style={styles.bottomRow}>
        {chalkPick ? (
          <View style={styles.chalkChip}>
            <Text style={styles.chalkText}>🎯 {chalkPick}</Text>
          </View>
        ) : <View />}
        <View style={styles.usersChip}>
          <Text style={styles.usersText}>
            👥 {activeUsers >= 1000
              ? `${(activeUsers / 1000).toFixed(1)}k`
              : activeUsers}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  cardLive: {
    borderColor: colors.red + '55',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leagueBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  leagueText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.red + '22',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.red + '55',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.red,
  },
  liveText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.red,
    letterSpacing: 0.3,
  },
  upcomingTime: {
    fontSize: 12,
    color: colors.grey,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  teamAbbr: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.offWhite,
    flex: 1,
  },
  scoreNum: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.offWhite,
  },
  scoreDash: {
    fontSize: 18,
    color: colors.grey,
  },
  matchupText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.offWhite,
  },
  title: {
    fontSize: 13,
    color: colors.grey,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chalkChip: {
    backgroundColor: colors.green + '18',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.green + '33',
  },
  chalkText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.green,
  },
  usersChip: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  usersText: {
    fontSize: 11,
    color: colors.grey,
    fontWeight: '500',
  },
});
