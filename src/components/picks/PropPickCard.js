import React, { useRef, useEffect, useState } from 'react';
import { View, Text, Image, Pressable, Animated, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../theme';
import { AFFILIATE_LINKS } from '../../config';
import ConfidenceInfoModal from './ConfidenceInfoModal';

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEAGUE_EMOJI = { NBA: '🏀', MLB: '⚾', NHL: '🏒', Soccer: '⚽', NFL: '🏈' };

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

function getConfidenceBadge(confidence) {
  if (confidence >= 90) return { label: "CHALKY'S BEST BET", color: '#FFB800', bg: '#2A1F00' };
  if (confidence >= 80) return { label: 'HIGH CONFIDENCE',   color: colors.green, bg: '#0D2A1A' };
  if (confidence >= 70) return null;
  return { label: 'LEAN', color: colors.grey, bg: colors.surface };
}

function getResultBadge(result) {
  if (!result) return null;
  const r = String(result).toLowerCase();
  if (r === 'win'  || r === 'correct') return { label: '✓ WON',  bg: colors.green, color: colors.background };
  if (r === 'loss' || r === 'wrong')   return { label: '✗ LOST', bg: colors.red,   color: '#fff' };
  if (r === 'push')                    return { label: '— PUSH', bg: colors.grey,  color: '#fff' };
  return null;
}

// Extract "Over 11.5" or "Under 26.5" from a pick string like "Over 11.5 Rebounds"
function extractPickLine(pickText) {
  const m = (pickText || '').match(/(Over|Under)\s+([\d.]+)/i);
  return m ? `${m[1]} ${m[2]}` : '';
}

// Player avatar — shows headshot image if available, falls back to initials
function PlayerAvatar({ name, headshotUrl, size = 52 }) {
  const [imgError, setImgError] = useState(false);

  if (headshotUrl && !imgError) {
    return (
      <Image
        source={{ uri: headshotUrl }}
        style={[styles.playerAvatarImg, { width: size, height: size, borderRadius: size / 2 }]}
        onError={() => setImgError(true)}
      />
    );
  }

  // Initials fallback
  const parts = (name || '').split(' ');
  const initials = parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : (parts[0] || '?')[0];
  const hue = (name || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <View style={[
      styles.avatar,
      { width: size, height: size, borderRadius: size / 2,
        backgroundColor: `hsl(${hue}, 55%, 28%)`,
        borderColor:      `hsl(${hue}, 55%, 45%)` }
    ]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.35 }]}>
        {initials.toUpperCase()}
      </Text>
    </View>
  );
}

// Animated confidence bar
function ConfidenceBar({ confidence }) {
  const barAnim = useRef(new Animated.Value(0)).current;
  const barColor = confidence >= 80 ? colors.green : confidence >= 65 ? '#FFB800' : colors.red;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(barAnim, {
        toValue: confidence, duration: 600, useNativeDriver: false,
      }).start();
    }, 250);
    return () => clearTimeout(t);
  }, [confidence]);

  const barWidth = barAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, { width: barWidth, backgroundColor: barColor }]} />
    </View>
  );
}

// Single bet button (sportsbook name + line + odds)
function BetButton({ book, label, odds, line, affiliateUrl }) {
  if (!affiliateUrl) return null;
  return (
    <Pressable
      style={styles.betBtn}
      onPress={() => Linking.openURL(affiliateUrl).catch(() => {})}
      android_ripple={{ color: colors.green + '44' }}
    >
      <Text style={styles.betBtnBook}>{label}</Text>
      {(line || odds) ? (
        <Text style={styles.betBtnOdds} numberOfLines={1}>
          {line}{line && odds ? ' · ' : ''}{odds || ''}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PropPickCard({ pick, onPress, isTopPick, isLocked, onLockedPress }) {
  const scale = useRef(new Animated.Value(1)).current;
  const [showInfo, setShowInfo] = useState(false);

  const handlePressIn = () =>
    Animated.spring(scale, { toValue: 0.97, tension: 300, friction: 10, useNativeDriver: true }).start();
  const handlePressOut = () =>
    Animated.spring(scale, { toValue: 1,    tension: 300, friction: 10, useNativeDriver: true }).start();

  // Data extraction
  const badge       = getConfidenceBadge(pick.confidence);
  const resultBadge = getResultBadge(pick.result);
  const emoji       = LEAGUE_EMOJI[pick.league] || '🏆';
  const links       = pick.affiliateLinks || AFFILIATE_LINKS;
  const pickLine    = extractPickLine(pick.pick);

  const analysis   = pick.analysis;
  const keyFactors = (analysis?.key_factors || analysis?.trends || []).slice(0, 3);

  // Stats row data — prefer direct pick fields, fall back to analysis.keyStats
  const projStat = analysis?.keyStats?.find(k => k.label === 'Model Projection');
  const edgeStat = analysis?.keyStats?.find(k => k.label === 'Edge');
  const projValue = pick.proj_value ?? (projStat ? parseFloat(projStat.value) : null);
  const propLine  = pick.prop_line  ?? null;
  const chalkEdge = pick.chalk_edge ?? (edgeStat ? parseFloat(edgeStat.value) : null);

  // Bar color
  const barColor = pick.confidence >= 80 ? colors.green : pick.confidence >= 65 ? '#FFB800' : colors.red;

  // Derive a readable prop category for the FOMO header
  const propCategory = pick.pickType
    ? pick.pickType.charAt(0).toUpperCase() + pick.pickType.slice(1) + ' Prop'
    : 'Player Prop';

  if (isLocked) {
    return (
      <TouchableOpacity onPress={onLockedPress} activeOpacity={0.9}>
        <Animated.View style={[styles.card, isTopPick && styles.topPickCard, styles.lockedCard, { transform: [{ scale }] }]}>
          {/* Visible header — player name + prop type creates FOMO */}
          <View style={styles.lockedHeader}>
            <Text style={styles.lockedPlayerName} numberOfLines={1}>{pick.playerName}</Text>
            <View style={styles.lockedMeta}>
              <Text style={styles.lockedPropType}>{propCategory}</Text>
              <View style={styles.lockedLeagueBadge}>
                <Text style={styles.lockedLeagueText}>{emoji} {pick.league}</Text>
              </View>
            </View>
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
    <Pressable onPress={() => onPress(pick)} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View style={[
        styles.card,
        isTopPick && styles.topPickCard,
        { transform: [{ scale }] },
      ]}>

        {/* ── Header: league · PLAYER PROP · confidence% ─────────────────── */}
        <View style={styles.header}>
          <Text style={styles.leagueEmoji}>{emoji}</Text>
          <Text style={styles.leagueLabel}>{pick.league} · PLAYER PROP</Text>
          <View style={{ flex: 1 }} />
          {badge && (
            <View style={[styles.confBadge, { backgroundColor: badge.bg, borderColor: badge.color + '55' }]}>
              <Text style={[styles.confBadgeText, { color: badge.color }]}>{badge.label}</Text>
            </View>
          )}
          <Pressable
            onPress={(e) => { e?.stopPropagation?.(); setShowInfo(true); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.confPctRow}
          >
            <Text style={[styles.confPct, { color: barColor }]}>{pick.confidence}%</Text>
            <Ionicons name="information-circle-outline" size={16} color={colors.grey} />
          </Pressable>
          {resultBadge && (
            <View style={[styles.resultBadge, { backgroundColor: resultBadge.bg }]}>
              <Text style={[styles.resultText, { color: resultBadge.color }]}>{resultBadge.label}</Text>
            </View>
          )}
        </View>

        {/* Confidence bar (full width) */}
        <ConfidenceBar confidence={pick.confidence} />

        {/* ── Player row ──────────────────────────────────────────────────── */}
        <View style={styles.playerRow}>
          <PlayerAvatar name={pick.playerName} headshotUrl={pick.headshotUrl} size={52} />
          <View style={styles.playerInfo}>
            <Text style={styles.playerName}>{pick.playerName}</Text>
            <Text style={styles.playerMeta}>
              {pick.matchupText
                ? pick.matchupText
                : [pick.playerTeam, pick.playerPosition].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        {/* ── Pick line (big) ─────────────────────────────────────────────── */}
        <Text style={styles.statLine}>{pick.pick}</Text>

        {/* ── Chalky's Analysis (new 3-field format) ──────────────────────── */}
        {analysis?.chalky_headline ? (
          <View style={styles.analysisBlock}>
            <Text style={styles.chalkyHeadline}>"{analysis.chalky_headline}"</Text>
            <Text style={styles.chalkyProjection}>{analysis.chalky_projection}</Text>
            {analysis.chalky_research ? (
              <Text style={styles.chalkyResearch}>{analysis.chalky_research}</Text>
            ) : null}
          </View>
        ) : pick.shortReason ? (
          <Text style={styles.reason}>"{pick.shortReason}"</Text>
        ) : null}

        {/* ── Stats row: PROJECTION | LINE | EDGE | CONFIDENCE ────────────── */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>PROJECTION</Text>
            <Text style={styles.statValue}>
              {projValue != null ? formatProjection(projValue, pick.pickType) : 'N/A'}
            </Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>LINE</Text>
            <Text style={styles.statValue}>
              {propLine != null ? String(propLine) : 'N/A'}
            </Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>EDGE</Text>
            <Text style={[styles.statValue, styles.edgeValue,
              chalkEdge > 0 ? styles.positiveEdge : chalkEdge < 0 ? styles.negativeEdge : null]}>
              {chalkEdge != null
                ? (chalkEdge > 0 ? `+${Number(chalkEdge).toFixed(1)}` : Number(chalkEdge).toFixed(1))
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

        {/* ── Key factors ─────────────────────────────────────────────────── */}
        {keyFactors.length > 0 ? (
          <View style={styles.factorsSection}>
            <Text style={styles.factorsHeader}>Key factors</Text>
            {keyFactors.map((f, i) => (
              <View key={i} style={styles.factorRow}>
                <Text style={styles.factorBullet}>·</Text>
                <Text style={styles.factorText}>{f}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── Bet buttons: DraftKings + FanDuel side by side ──────────────── */}
        <View style={styles.betRow}>
          <BetButton
            label="BET DRAFTKINGS"
            odds={pick.odds?.draftkings && pick.odds.draftkings !== 'N/A' ? pick.odds.draftkings : null}
            line={pickLine}
            affiliateUrl={links.draftkings}
          />
          <BetButton
            label="BET FANDUEL"
            odds={pick.odds?.fanduel && pick.odds.fanduel !== 'N/A' ? pick.odds.fanduel : null}
            line={pickLine}
            affiliateUrl={links.fanduel}
          />
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

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: 5,
    flexWrap: 'wrap',
  },
  leagueEmoji: {
    fontSize: 14,
  },
  leagueLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  confBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  confBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  confPctRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  confPct: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  infoIcon: {
    fontSize: 13,
    color: colors.grey,
    lineHeight: 16,
  },
  resultBadge: {
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  resultText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  // Confidence bar
  barTrack: {
    height: 3,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  barFill: {
    height: '100%',
    borderRadius: radius.full,
  },

  // Player row
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  avatarText: {
    fontWeight: '800',
    color: colors.offWhite,
  },
  playerInfo: { flex: 1 },
  playerName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.offWhite,
  },
  playerMeta: {
    fontSize: 12,
    color: colors.grey,
    marginTop: 1,
  },

  // Pick line
  statLine: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.offWhite,
    marginBottom: spacing.sm,
  },

  // Player headshot image
  playerAvatarImg: {
    borderWidth: 2,
    borderColor: colors.green,
  },

  // Chalky's 3-field analysis block
  analysisBlock: {
    marginBottom: spacing.sm,
  },
  chalkyHeadline: {
    fontSize: 13,
    color: colors.offWhite,
    fontStyle: 'italic',
    lineHeight: 18,
    marginBottom: 4,
  },
  chalkyProjection: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.green,
    marginBottom: 4,
  },
  chalkyResearch: {
    fontSize: 12,
    color: colors.grey,
    lineHeight: 17,
  },

  // Legacy short reason
  reason: {
    fontSize: 13,
    color: colors.grey,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
    lineHeight: 18,
  },

  // Stats row (replaces old model projection + edge)
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1e1e1e', marginBottom: spacing.sm },
  statBox: { alignItems: 'center', flex: 1 },
  statLabel: { fontSize: 9, color: '#888888', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  statValue: { fontSize: 15, fontWeight: '700', color: '#F5F5F0' },
  positiveEdge: { color: '#00E87A' },
  negativeEdge: { color: '#FF4444' },
  highConf: { color: '#00E87A' },
  medConf: { color: '#FFA500' },
  lowConf: { color: '#888888' },
  edgeValue: { fontSize: 15, fontWeight: '800' },
  // Legacy model row styles kept for compatibility
  modelRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  modelItem: { flex: 1 },
  edgeItem: { alignItems: 'flex-end' },
  modelLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  modelValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.offWhite,
  },

  // Key factors
  factorsSection: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  factorsHeader: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 5,
  },
  factorRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 3,
  },
  factorBullet: {
    fontSize: 13,
    color: colors.green,
    lineHeight: 18,
  },
  factorText: {
    fontSize: 12,
    color: colors.greyLight || colors.grey,
    lineHeight: 18,
    flex: 1,
  },

  // Bet buttons
  betRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  betBtn: {
    flex: 1,
    backgroundColor: colors.green,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  betBtnBook: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.background,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  betBtnOdds: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.background + 'CC',
    marginTop: 2,
  },

  // Tap hint
  tapHint: {
    marginTop: 4,
    alignItems: 'flex-end',
  },
  tapHintText: {
    fontSize: 11,
    color: colors.grey,
    fontStyle: 'italic',
  },
  // Locked FOMO state
  lockedCard: {
    minHeight: 160,
    overflow: 'hidden',
  },
  lockedHeader: {
    gap: 4,
    paddingBottom: 4,
  },
  lockedPlayerName: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.offWhite,
    letterSpacing: -0.3,
  },
  lockedMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lockedPropType: {
    fontSize: 12,
    color: colors.grey,
    fontWeight: '600',
  },
  lockedLeagueBadge: {
    backgroundColor: colors.surface,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lockedLeagueText: {
    fontSize: 11,
    color: colors.grey,
    fontWeight: '600',
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
