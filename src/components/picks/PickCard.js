import React, { useRef, useState } from 'react';
import {
  View, Text, Image, Pressable, Animated,
  StyleSheet, TouchableOpacity, Linking,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../theme';
import { AFFILIATE_LINKS } from '../../config';
import TeamLogo from '../TeamLogo';
import { useTeamLogos } from '../../context/TeamLogosContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEAGUE_COLORS = {
  NBA: '#C9082A',
  MLB: '#002D72',
  NHL: '#003087',
  NFL: '#013369',
  Soccer: '#00A859',
};

const BOOK_LABELS = {
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  betmgm: 'BetMGM',
  bet365: 'bet365',
};

function formatProj(val) {
  if (val == null) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toFixed(1);
}

function formatLine(val) {
  if (val == null) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n % 1 === 0 ? n.toFixed(1) : String(n);
}

function formatEdge(val) {
  if (val == null) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(1);
}

function edgeColor(val) {
  if (val == null) return colors.grey;
  const n = parseFloat(val);
  if (isNaN(n)) return colors.grey;
  return n > 0 ? colors.green : colors.red;
}

function confColor(conf) {
  if (!conf) return colors.grey;
  if (conf >= 80) return colors.green;
  if (conf >= 70) return '#FFA500';
  return colors.grey;
}

// Player avatar — headshot or initials fallback
function PlayerAvatar({ name, headshotUrl }) {
  const [imgError, setImgError] = useState(false);

  if (headshotUrl && !imgError) {
    return (
      <Image
        source={{ uri: headshotUrl }}
        style={styles.avatar}
        onError={() => setImgError(true)}
      />
    );
  }

  const parts = (name || '').split(' ');
  const initials = parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : (parts[0] || '?')[0];
  const hue = (name || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <View style={[styles.avatar, styles.avatarFallback, {
      backgroundColor: `hsl(${hue}, 55%, 22%)`,
      borderColor: `hsl(${hue}, 55%, 38%)`,
    }]}>
      <Text style={styles.avatarInitial}>{initials.toUpperCase()}</Text>
    </View>
  );
}

// ── Result badge ──────────────────────────────────────────────────────────────

function ResultBadge({ result }) {
  if (!result) return null;
  const r = String(result).toLowerCase();
  if (r === 'win' || r === 'correct')
    return <View style={[styles.resultBadge, { backgroundColor: colors.green }]}><Text style={styles.resultText}>✓ WON</Text></View>;
  if (r === 'loss' || r === 'wrong')
    return <View style={[styles.resultBadge, { backgroundColor: colors.red }]}><Text style={styles.resultText}>✗ LOST</Text></View>;
  if (r === 'push')
    return <View style={[styles.resultBadge, { backgroundColor: colors.grey }]}><Text style={styles.resultText}>— PUSH</Text></View>;
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PickCard({ pick, onPress, isTopPick, isLocked, onLockedPress }) {
  const getLogo = useTeamLogos();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () =>
    Animated.spring(scale, { toValue: 0.97, tension: 300, friction: 10, useNativeDriver: true }).start();
  const handlePressOut = () =>
    Animated.spring(scale, { toValue: 1,    tension: 300, friction: 10, useNativeDriver: true }).start();

  const leagueColor  = LEAGUE_COLORS[pick.league] || '#333';
  const isPlayerProp = pick.pickCategory === 'prop' || !!pick.playerName;

  const bestBook    = pick.bestOdds;
  const bestOddsStr = pick.odds?.[bestBook];
  const affiliateUrl = (pick.affiliateLinks || AFFILIATE_LINKS)?.[bestBook] || AFFILIATE_LINKS.draftkings;
  const bookLabel   = BOOK_LABELS[bestBook] || 'DraftKings';

  // ── Locked card ─────────────────────────────────────────────────────────────
  if (isLocked) {
    return (
      <TouchableOpacity onPress={onLockedPress} activeOpacity={0.9}>
        <Animated.View style={[styles.card, isTopPick && styles.topPickCard, styles.lockedCard, { transform: [{ scale }] }]}>
          <View style={styles.header}>
            {isPlayerProp ? (
              <PlayerAvatar name={pick.playerName} headshotUrl={pick.headshotUrl} />
            ) : (
              <View style={styles.gameLogos}>
                <TeamLogo uri={getLogo(pick.awayTeam, pick.league)} abbr={pick.awayTeam} size={28} />
              </View>
            )}
            <View style={styles.headerText}>
              <Text style={styles.primaryName} numberOfLines={1}>
                {isPlayerProp ? pick.playerName : `${pick.awayTeam} @ ${pick.homeTeam}`}
              </Text>
              <Text style={styles.secondaryText} numberOfLines={1}>
                {isPlayerProp
                  ? (pick.matchupText || [pick.playerTeam, pick.playerPosition].filter(Boolean).join(' · '))
                  : (pick.league || '')}
              </Text>
            </View>
            <View style={[styles.leagueBadge, { backgroundColor: leagueColor }]}>
              <Text style={styles.leagueText}>{pick.league}</Text>
            </View>
          </View>

          <BlurView intensity={22} tint="dark" style={styles.blurOverlay}>
            <View style={styles.lockContainer}>
              <View style={styles.lockCircle}>
                <Ionicons name="lock-closed" size={20} color="#FFD700" />
              </View>
              <Text style={styles.lockTitle}>Chalky Pro</Text>
              <Text style={styles.lockSub}>Tap to unlock all picks</Text>
            </View>
          </BlurView>
        </Animated.View>
      </TouchableOpacity>
    );
  }

  // ── Unlocked card ────────────────────────────────────────────────────────────
  return (
    <Pressable onPress={() => onPress(pick)} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View style={[styles.card, isTopPick && styles.topPickCard, { transform: [{ scale }] }]}>

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          {isPlayerProp ? (
            <PlayerAvatar name={pick.playerName} headshotUrl={pick.headshotUrl} />
          ) : (
            <View style={styles.gameLogos}>
              <TeamLogo uri={getLogo(pick.awayTeam, pick.league)} abbr={pick.awayTeam} size={24} />
              <Text style={styles.vsText}>@</Text>
              <TeamLogo uri={getLogo(pick.homeTeam, pick.league)} abbr={pick.homeTeam} size={24} />
            </View>
          )}

          <View style={styles.headerText}>
            <View style={styles.nameRow}>
              <Text style={styles.primaryName} numberOfLines={1}>
                {isPlayerProp ? pick.playerName : `${pick.awayTeam} @ ${pick.homeTeam}`}
              </Text>
              <ResultBadge result={pick.result} />
            </View>
            <Text style={styles.secondaryText} numberOfLines={1}>
              {isPlayerProp
                ? (pick.matchupText || [pick.playerTeam, pick.playerPosition].filter(Boolean).join(' · '))
                : (pick.gameTime || '')}
            </Text>
          </View>

          <View style={[styles.leagueBadge, { backgroundColor: leagueColor }]}>
            <Text style={styles.leagueText}>{pick.league}</Text>
          </View>
        </View>

        {/* ── The Pick ───────────────────────────────────────────────────────── */}
        <View style={styles.pickSection}>
          <Text style={styles.pickLabel}>{pick.pick}</Text>
        </View>

        {/* ── Stats row ──────────────────────────────────────────────────────── */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>PROJ</Text>
            <Text style={styles.statValue}>{formatProj(pick.proj_value)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>LINE</Text>
            <Text style={styles.statValue}>{formatLine(pick.prop_line)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>EDGE</Text>
            <Text style={[styles.statValue, { color: edgeColor(pick.chalk_edge) }]}>
              {formatEdge(pick.chalk_edge)}
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>CONF</Text>
            <Text style={[styles.statValue, { color: confColor(pick.confidence) }]}>
              {pick.confidence ? `${pick.confidence}%` : '—'}
            </Text>
          </View>
        </View>

        {/* ── Best Odds button ───────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.oddsBtn}
          onPress={() => affiliateUrl && Linking.openURL(affiliateUrl).catch(() => {})}
          activeOpacity={0.8}
        >
          <Text style={styles.oddsBtnLabel}>Best Odds</Text>
          <Text style={styles.oddsBtnBook}>
            {bookLabel}{bestOddsStr ? ` ${bestOddsStr}` : ''}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.green} />
        </TouchableOpacity>

      </Animated.View>
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  topPickCard: {
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  avatarInitial: {
    color: colors.offWhite,
    fontSize: 16,
    fontWeight: '800',
  },
  gameLogos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  vsText: {
    fontSize: 10,
    color: colors.grey,
    fontWeight: '600',
  },
  headerText: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  primaryName: {
    color: colors.offWhite,
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  secondaryText: {
    color: colors.grey,
    fontSize: 12,
    marginTop: 2,
  },
  leagueBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  leagueText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // Pick label
  pickSection: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  pickLabel: {
    color: colors.offWhite,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  statLabel: {
    color: colors.grey,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  statValue: {
    color: colors.offWhite,
    fontSize: 16,
    fontWeight: '800',
  },

  // Odds button
  oddsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  oddsBtnLabel: {
    color: colors.grey,
    fontSize: 13,
    fontWeight: '500',
  },
  oddsBtnBook: {
    flex: 1,
    color: colors.green,
    fontSize: 13,
    fontWeight: '700',
  },

  // Result badge
  resultBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  resultText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  // Locked state
  lockedCard: {
    minHeight: 150,
    overflow: 'hidden',
  },
  blurOverlay: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    bottom: 0,
  },
  lockContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  lockCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,215,0,0.12)',
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
  lockSub: {
    color: colors.grey,
    fontSize: 12,
  },
});
