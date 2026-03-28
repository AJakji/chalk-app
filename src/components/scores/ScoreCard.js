import React, { useRef, useEffect } from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import TeamLogo from '../TeamLogo';
import { useTeamLogos } from '../../context/TeamLogosContext';

const LEAGUE_COLORS = {
  NBA: '#C9082A',
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

// Flashing score — flashes green background when score changes during a live game
function FlashScore({ score, isLive, style }) {
  const flash = useRef(new Animated.Value(0)).current;
  const prevScore = useRef(score);

  useEffect(() => {
    if (isLive && score !== prevScore.current) {
      prevScore.current = score;
      flash.setValue(1);
      Animated.timing(flash, {
        toValue: 0,
        duration: 900,
        useNativeDriver: false,
      }).start();
    }
  }, [score, isLive]);

  const bg = flash.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', colors.green + '40'],
  });

  return (
    <Animated.View style={[{ borderRadius: 4, paddingHorizontal: 2 }, { backgroundColor: bg }]}>
      <Text style={[styles.score, style]}>{score}</Text>
    </Animated.View>
  );
}

export default function ScoreCard({ game, onPress }) {
  const { awayTeam, homeTeam, status, clock, league, chalkPick } = game;
  const getLogo = useTeamLogos();
  const isLive = status === 'live';
  const isFinal = status === 'final';
  const isUpcoming = status === 'upcoming';
  const leagueColor = LEAGUE_COLORS[league] || colors.grey;
  const scale = useRef(new Animated.Value(1)).current;

  const awayWinning = isLive && awayTeam.score > homeTeam.score;
  const homeWinning = isLive && homeTeam.score > awayTeam.score;
  const awayWon = isFinal && awayTeam.score > homeTeam.score;
  const homeWon = isFinal && homeTeam.score > awayTeam.score;

  const handlePressIn = () => {
    Animated.spring(scale, { toValue: 0.97, tension: 300, friction: 10, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }).start();
  };

  return (
    <Pressable
      onPress={() => onPress(game)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={[styles.card, isLive && styles.cardLive, { transform: [{ scale }] }]}
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

        {/* Score rows */}
        <View style={styles.scoreBlock}>
          {/* Away team */}
          <View style={styles.teamRow}>
            <TeamLogo uri={getLogo(awayTeam.abbr, league)} abbr={awayTeam.abbr} size={28} style={styles.logo} />
            <Text style={[
              styles.teamName,
              (awayWon || awayWinning) && styles.teamNameWinning,
              (isFinal && !awayWon) && styles.teamNameLost,
            ]}>
              {awayTeam.abbr}
            </Text>
            <Text style={styles.teamFullName} numberOfLines={1}>{awayTeam.name}</Text>
            {!isUpcoming && (
              <FlashScore
                score={awayTeam.score}
                isLive={isLive}
                style={(awayWon || awayWinning) && styles.scoreWinning}
              />
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
            <TeamLogo uri={getLogo(homeTeam.abbr, league)} abbr={homeTeam.abbr} size={28} style={styles.logo} />
            <Text style={[
              styles.teamName,
              (homeWon || homeWinning) && styles.teamNameWinning,
              (isFinal && !homeWon) && styles.teamNameLost,
            ]}>
              {homeTeam.abbr}
            </Text>
            <Text style={styles.teamFullName} numberOfLines={1}>{homeTeam.name}</Text>
            {!isUpcoming && (
              <FlashScore
                score={homeTeam.score}
                isLive={isLive}
                style={(homeWon || homeWinning) && styles.scoreWinning}
              />
            )}
          </View>
        </View>

        {/* Clock for live games */}
        {isLive && (
          <Text style={styles.liveClockText}>{clock}</Text>
        )}

        {/* Tap hint */}
        {(game.boxScore || isLive) && (
          <Text style={styles.tapHint}>Box score & stats →</Text>
        )}
      </Animated.View>
    </Pressable>
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
  logo: {
    marginRight: 8,
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
  tapHint: {
    fontSize: 11,
    color: colors.grey,
    fontStyle: 'italic',
    textAlign: 'right',
    marginTop: spacing.sm,
  },
});
