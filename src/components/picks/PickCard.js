import React, { useRef, useEffect, useState } from 'react';
import { View, Text, Pressable, Animated, StyleSheet, TouchableOpacity } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import ConfidenceInfoModal from './ConfidenceInfoModal';
import { colors, typography, spacing, radius } from '../../theme';
import TeamLogo from '../TeamLogo';
import { useTeamLogos } from '../../context/TeamLogosContext';
import { formatGameDateTime } from '../../utils/timeUtils';

import ChalkyFace from '../ChalkyFace';

// ── Stats row helpers ─────────────────────────────────────────────────────────

const formatProjection = (value, type) => {
  if (value == null) return 'N/A';
  switch (type) {
    case 'points': case 'rebounds': case 'assists': case 'threes':
      return value.toFixed(1);
    case 'spread': case 'run_line': case 'puck_line':
      return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
    case 'total': return value.toFixed(1);
    default: return typeof value === 'number' ? value.toFixed(1) : 'N/A';
  }
};

const getConfidenceStyle = (conf, styles) => {
  if (conf >= 80) return styles.highConf;
  if (conf >= 70) return styles.medConf;
  return styles.lowConf;
};

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
      <Ionicons name="information-circle-outline" size={16} color={colors.grey} />
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

export default function PickCard({ pick, onPress, isTopPick, isLocked, onLockedPress }) {
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

  if (isLocked) {
    return (
      <TouchableOpacity onPress={onLockedPress} activeOpacity={0.9}>
        <Animated.View style={[styles.card, isTopPick && styles.topPickCard, styles.lockedCard, { transform: [{ scale }] }]}>
          {/* Visible header — player/matchup info creates FOMO */}
          <View style={styles.header}>
            <View style={[styles.leagueBadge, { backgroundColor: leagueColor }]}>
              <Text style={styles.leagueText}>{pick.league}</Text>
            </View>
            <View style={styles.gamePickBadge}>
              <Text style={styles.gamePickBadgeText}>GAME PICK</Text>
            </View>
            <Text style={styles.gameTime}>{formatGameDateTime(pick.gameTime)}</Text>
          </View>
          <View style={styles.matchupRow}>
            <TeamLogo uri={getLogo(pick.awayTeam, pick.league)} abbr={pick.awayTeam} size={22} />
            <Text style={styles.matchupTeam} numberOfLines={1}>{pick.awayTeam}</Text>
            <Text style={styles.atSign}>@</Text>
            <TeamLogo uri={getLogo(pick.homeTeam, pick.league)} abbr={pick.homeTeam} size={22} />
            <Text style={styles.matchupTeam} numberOfLines={1}>{pick.homeTeam}</Text>
          </View>

          {/* Blur covers everything below the header */}
          <BlurView intensity={22} tint="dark" style={styles.blurOverlay}>
            <View style={styles.lockContainer}>
              <View style={styles.lockIconCircle}>
                <Ionicons name="lock-closed" size={20} color="#FFD700" />
              </View>
              <Text style={styles.lockTitle}>Chalky Pro</Text>
              <Text style={styles.lockSubtext}>Tap to unlock all picks</Text>
            </View>
          </BlurView>
        </Animated.View>
      </TouchableOpacity>
    );
  }

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
          <ChalkyFace size={16} style={styles.chalkyIcon} />
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

        {/* Stats row: PROJECTION | LINE | EDGE | CONFIDENCE */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>PROJECTION</Text>
            <Text style={styles.statValue}>
              {pick.proj_value != null ? formatProjection(pick.proj_value, pick.pickType) : 'N/A'}
            </Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>LINE</Text>
            <Text style={styles.statValue}>
              {pick.prop_line != null ? String(pick.prop_line) : 'N/A'}
            </Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>EDGE</Text>
            <Text style={[styles.statValue, styles.edgeValue,
              pick.chalk_edge > 0 ? styles.positiveEdge : pick.chalk_edge < 0 ? styles.negativeEdge : null]}>
              {pick.chalk_edge != null
                ? (pick.chalk_edge > 0 ? `+${Number(pick.chalk_edge).toFixed(1)}` : Number(pick.chalk_edge).toFixed(1))
                : 'N/A'}
            </Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>CONFIDENCE</Text>
            <Text style={[styles.statValue, getConfidenceStyle(pick.confidence, styles)]}>
              {pick.confidence != null ? `${pick.confidence}%` : 'N/A'}
            </Text>
          </View>
        </View>

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
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1e1e1e' },
  statBox: { alignItems: 'center', flex: 1 },
  statLabel: { fontSize: 9, color: '#888888', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  statValue: { fontSize: 15, fontWeight: '700', color: '#F5F5F0' },
  positiveEdge: { color: '#00E87A' },
  negativeEdge: { color: '#FF4444' },
  highConf: { color: '#00E87A' },
  medConf: { color: '#FFA500' },
  lowConf: { color: '#888888' },
  edgeValue: { fontSize: 15, fontWeight: '800' },
  // Locked FOMO state
  lockedCard: {
    minHeight: 160,
    overflow: 'hidden',
  },
  blurOverlay: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    bottom: 0,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
  },
  lockContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  lockIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,215,0,0.15)',
    borderWidth: 1,
    borderColor: '#FFD700',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  lockTitle: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  lockSubtext: {
    color: '#888888',
    fontSize: 12,
  },
});
