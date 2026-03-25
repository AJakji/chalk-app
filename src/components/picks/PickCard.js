import React, { useRef, useEffect, useState } from 'react';
import { View, Text, Image, Pressable, Animated, StyleSheet } from 'react-native';
import ConfidenceInfoModal from './ConfidenceInfoModal';
import { colors, typography, spacing, radius } from '../../theme';
import TeamLogo from '../TeamLogo';
import { useTeamLogos } from '../../context/TeamLogosContext';

const CHALKY_PNG = require('../../../assets/chalky.png');

const LEAGUE_COLORS = {
  NBA: '#C9082A',
  MLB: '#002D72',
  NHL: '#000000',
  Soccer: '#00A859',
};

// Small "i" info button
function InfoButton({ onPress }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={styles.infoBtn}
    >
      <Text style={styles.infoBtnText}>ⓘ</Text>
    </Pressable>
  );
}

// Confidence bar animates from 0 → actual% over 600ms
function ConfidenceBar({ confidence, onInfoPress }) {
  const barAnim = useRef(new Animated.Value(0)).current;
  const barColor =
    confidence >= 80 ? colors.green : confidence >= 65 ? '#FFB800' : colors.red;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(barAnim, {
        toValue: confidence,
        duration: 600,
        useNativeDriver: false, // width animation requires JS driver
      }).start();
    }, 250);
    return () => clearTimeout(t);
  }, [confidence]);

  const barWidth = barAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.confidenceContainer}>
      <View style={styles.confidenceRow}>
        <Text style={styles.confidenceLabel}>Confidence</Text>
        <View style={styles.confidenceRight}>
          <Text style={[styles.confidenceValue, { color: barColor }]}>
            {confidence}%
          </Text>
          <InfoButton onPress={onInfoPress} />
        </View>
      </View>
      <View style={styles.barTrack}>
        <Animated.View
          style={[styles.barFill, { width: barWidth, backgroundColor: barColor }]}
        />
      </View>
    </View>
  );
}

export default function PickCard({ pick, onPress, isTopPick }) {
  const leagueColor = LEAGUE_COLORS[pick.league] || colors.grey;
  const getLogo = useTeamLogos();
  const scale = useRef(new Animated.Value(1)).current;
  const [showInfo, setShowInfo] = useState(false);

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
      tension: 300,
      friction: 10,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      tension: 300,
      friction: 10,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={() => onPress(pick)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={[
          styles.card,
          isTopPick && styles.topPickCard,
          { transform: [{ scale }] },
        ]}
      >
        {/* Header row */}
        <View style={styles.header}>
          <View style={[styles.leagueBadge, { backgroundColor: leagueColor }]}>
            <Text style={styles.leagueText}>{pick.league}</Text>
          </View>
          <View style={styles.gamePickBadge}>
            <Text style={styles.gamePickBadgeText}>GAME PICK</Text>
          </View>
          <Text style={styles.gameTime}>{pick.gameTime}</Text>
        </View>

        {/* Matchup */}
        <View style={styles.matchupRow}>
          <TeamLogo uri={getLogo(pick.awayTeam, pick.league)} abbr={pick.awayTeam} size={22} />
          <Text style={styles.matchupTeam} numberOfLines={1}>{pick.awayTeam}</Text>
          <Text style={styles.atSign}>@</Text>
          <TeamLogo uri={getLogo(pick.homeTeam, pick.league)} abbr={pick.homeTeam} size={22} />
          <Text style={styles.matchupTeam} numberOfLines={1}>{pick.homeTeam}</Text>
        </View>

        {/* The pick */}
        <View style={styles.chalkyLikesRow}>
          <Image source={CHALKY_PNG} style={styles.chalkyIcon} resizeMode="contain" />
          <Text style={styles.chalkyLikes}>Chalky likes</Text>
          {pick.confidence >= 90 && (
            <View style={[styles.confBadge, { backgroundColor: '#2A1F00', borderColor: '#FFB80055' }]}>
              <Text style={[styles.confBadgeText, { color: '#FFB800' }]}>CHALKY'S BEST BET</Text>
            </View>
          )}
          {pick.confidence >= 80 && pick.confidence < 90 && (
            <View style={[styles.confBadge, { backgroundColor: '#0D2A1A', borderColor: colors.green + '55' }]}>
              <Text style={[styles.confBadgeText, { color: colors.green }]}>HIGH CONFIDENCE</Text>
            </View>
          )}
          {pick.confidence < 70 && (
            <View style={[styles.confBadge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.confBadgeText, { color: colors.grey }]}>LEAN</Text>
            </View>
          )}
        </View>
        <View style={styles.pickRow}>
          <Text style={styles.pickValue}>{pick.pick}</Text>
          {(pick.result === 'win' || pick.result === 'correct') && (
            <View style={[styles.resultBadge, { backgroundColor: colors.green }]}>
              <Text style={[styles.resultText, { color: colors.background }]}>✓ WON</Text>
            </View>
          )}
          {(pick.result === 'loss' || pick.result === 'wrong') && (
            <View style={[styles.resultBadge, { backgroundColor: colors.red }]}>
              <Text style={styles.resultText}>✗ LOST</Text>
            </View>
          )}
          {pick.result === 'push' && (
            <View style={[styles.resultBadge, { backgroundColor: colors.grey }]}>
              <Text style={styles.resultText}>— PUSH</Text>
            </View>
          )}
        </View>

        {/* Short reason */}
        <Text style={styles.reason}>{pick.shortReason}</Text>

        {/* Animated confidence bar */}
        <ConfidenceBar confidence={pick.confidence} onInfoPress={(e) => { e?.stopPropagation?.(); setShowInfo(true); }} />

        {/* Tap hint */}
        <View style={styles.tapHint}>
          <Text style={styles.tapHintText}>Chalky's full breakdown →</Text>
        </View>

        <ConfidenceInfoModal visible={showInfo} onClose={() => setShowInfo(false)} />
      </Animated.View>
    </Pressable>
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
  gamePickBadge: {
    backgroundColor: '#1E3A5F',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#2E5A9F44',
    flex: 1,
  },
  gamePickBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#6B9FD4',
    letterSpacing: 0.6,
  },
  gameTime: {
    fontSize: 11,
    color: colors.grey,
  },
  matchupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.xs,
    flexWrap: 'nowrap',
  },
  matchupTeam: {
    fontSize: 13,
    color: colors.greyLight,
    flex: 1,
    flexShrink: 1,
  },
  atSign: {
    fontSize: 11,
    color: colors.grey,
    flexShrink: 0,
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
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  confidenceRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  infoBtn: {
    padding: 2,
  },
  infoBtnText: {
    fontSize: 13,
    color: colors.grey,
    lineHeight: 16,
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
  chalkyLikesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
    flexWrap: 'wrap',
  },
  chalkyIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  chalkyLikes: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.green,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  confBadge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
  },
  confBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
