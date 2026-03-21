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

function LivePulse() {
  return (
    <View style={styles.liveBadge}>
      <View style={styles.liveDot} />
      <Text style={styles.liveText}>LIVE</Text>
    </View>
  );
}

function ChalkPickBanner({ pick }) {
  if (!pick) return null;
  const isWinning = pick.result === 'winning' || pick.result === 'win';
  const isLosing = pick.result === 'losing' || pick.result === 'loss';
  return (
    <View style={[
      styles.chalkBanner,
      isWinning && styles.chalkBannerWin,
      isLosing && styles.chalkBannerLoss,
    ]}>
      <Text style={[
        styles.chalkBannerText,
        isWinning && { color: colors.green },
        isLosing && { color: colors.red },
      ]}>
        🎯 Chalk: {pick.pick}
        {isWinning ? ' · Winning' : isLosing ? ' · Losing' : ''}
      </Text>
    </View>
  );
}

export default function ScoreCard({ game, onPress }) {
  const { awayTeam, homeTeam, status, clock, league, chalkPick } = game;
  const isLive = status === 'live';
  const isFinal = status === 'final';
  const isUpcoming = status === 'upcoming';
  const leagueColor = LEAGUE_COLORS[league] || colors.grey;

  const awayWinning = isLive && awayTeam.score > homeTeam.score;
  const homeWinning = isLive && homeTeam.score > awayTeam.score;
  const awayWon = isFinal && awayTeam.score > homeTeam.score;
  const homeWon = isFinal && homeTeam.score > awayTeam.score;

  return (
    <TouchableOpacity
      style={[styles.card, isLive && styles.cardLive]}
      onPress={() => onPress(game)}
      activeOpacity={0.85}
    >
      {/* Top: league + status */}
      <View style={styles.topRow}>
        <View style={[styles.leagueBadge, { backgroundColor: leagueColor }]}>
          <Text style={styles.leagueText}>{league}</Text>
        </View>
        {isLive ? (
          <LivePulse />
        ) : (
          <Text style={[styles.clockText, isFinal && styles.finalText]}>
            {clock}
          </Text>
        )}
      </View>

      {/* Score row */}
      <View style={styles.scoreBlock}>
        {/* Away team */}
        <View style={styles.teamRow}>
          <Text style={[
            styles.teamName,
            (awayWon || awayWinning) && styles.teamNameWinning,
            (isFinal && !awayWon) && styles.teamNameLost,
          ]}>
            {awayTeam.abbr}
          </Text>
          <Text style={styles.teamFullName} numberOfLines={1}>{awayTeam.name}</Text>
          {!isUpcoming && (
            <Text style={[
              styles.score,
              (awayWon || awayWinning) && styles.scoreWinning,
            ]}>
              {awayTeam.score}
            </Text>
          )}
        </View>

        {/* Divider / AT */}
        <View style={styles.atRow}>
          {isUpcoming ? (
            <Text style={styles.atText}>@</Text>
          ) : (
            <View style={styles.scoreDivider} />
          )}
        </View>

        {/* Home team */}
        <View style={styles.teamRow}>
          <Text style={[
            styles.teamName,
            (homeWon || homeWinning) && styles.teamNameWinning,
            (isFinal && !homeWon) && styles.teamNameLost,
          ]}>
            {homeTeam.abbr}
          </Text>
          <Text style={styles.teamFullName} numberOfLines={1}>{homeTeam.name}</Text>
          {!isUpcoming && (
            <Text style={[
              styles.score,
              (homeWon || homeWinning) && styles.scoreWinning,
            ]}>
              {homeTeam.score}
            </Text>
          )}
        </View>
      </View>

      {/* Clock for live games */}
      {isLive && (
        <Text style={styles.liveClockText}>{clock}</Text>
      )}

      {/* Chalk pick banner */}
      <ChalkPickBanner pick={chalkPick} />

      {/* Tap hint */}
      {(game.boxScore || isLive) && (
        <Text style={styles.tapHint}>Box score & stats →</Text>
      )}
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
  },
  cardLive: {
    borderColor: colors.red + '55',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  leagueBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  leagueText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  liveBadge: {
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
    letterSpacing: 0.5,
  },
  clockText: {
    fontSize: 12,
    color: colors.grey,
  },
  finalText: {
    color: colors.grey,
    fontWeight: '600',
  },
  scoreBlock: {
    gap: 6,
    marginBottom: spacing.xs,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  teamName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.grey,
    width: 48,
  },
  teamNameWinning: {
    color: colors.offWhite,
  },
  teamNameLost: {
    color: colors.grey,
  },
  teamFullName: {
    flex: 1,
    fontSize: 13,
    color: colors.grey,
    marginLeft: 4,
  },
  score: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.grey,
    minWidth: 44,
    textAlign: 'right',
  },
  scoreWinning: {
    color: colors.offWhite,
  },
  atRow: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  atText: {
    fontSize: 13,
    color: colors.grey,
    textAlign: 'center',
  },
  scoreDivider: {
    height: 1,
    backgroundColor: colors.border,
    width: '100%',
  },
  liveClockText: {
    fontSize: 12,
    color: colors.red,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: spacing.xs,
  },
  chalkBanner: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  chalkBannerWin: {
    backgroundColor: colors.green + '18',
  },
  chalkBannerLoss: {
    backgroundColor: colors.red + '18',
  },
  chalkBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.grey,
  },
  tapHint: {
    fontSize: 11,
    color: colors.grey,
    fontStyle: 'italic',
    textAlign: 'right',
    marginTop: spacing.sm,
  },
});
