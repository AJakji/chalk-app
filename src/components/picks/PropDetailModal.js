import React, { useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Pressable,
  Animated, StyleSheet, Linking, Modal, SafeAreaView, StatusBar,
} from 'react-native';
import { colors, spacing, radius } from '../../theme';
import ChalkyFace from '../ChalkyFace';

const SPORTSBOOK_NAMES = {
  draftkings: 'DraftKings',
  fanduel:    'FanDuel',
  betmgm:     'BetMGM',
  bet365:     'bet365',
};

// Player initials avatar
function InitialsAvatar({ name, size = 48 }) {
  const parts = (name || '').split(' ');
  const initials = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?')[0];
  const hue = (name || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${hue},55%,28%)`, borderColor: `hsl(${hue},55%,45%)` }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.35 }]}>{initials.toUpperCase()}</Text>
    </View>
  );
}

// Last 10 games bar chart with the prop line marked
function Last10Chart({ games, propLine, statLabel }) {
  if (!games || games.length === 0) return null;

  const maxStat = Math.max(...games.map(g => g.stat), propLine * 1.5);

  return (
    <View style={styles.chartContainer}>
      <Text style={styles.chartTitle}>Last 10 Games — {statLabel}</Text>
      <View style={styles.chartBars}>
        {[...games].reverse().map((game, i) => {
          const barPct = game.stat / maxStat;
          const hitLine = game.stat > propLine;
          return (
            <View key={i} style={styles.chartBarCol}>
              <Text style={[styles.chartStatVal, { color: hitLine ? colors.green : colors.red }]}>
                {game.stat}
              </Text>
              <View style={styles.chartBarTrack}>
                <View
                  style={[
                    styles.chartBarFill,
                    { height: `${Math.round(barPct * 100)}%`, backgroundColor: hitLine ? colors.green : colors.red },
                  ]}
                />
              </View>
              <Text style={styles.chartOpp}>{game.opp}</Text>
            </View>
          );
        })}
      </View>
      {/* Line marker */}
      <View style={styles.lineMarkerRow}>
        <View style={styles.lineMarkerDash} />
        <Text style={styles.lineMarkerLabel}>Line: {propLine}</Text>
      </View>
    </View>
  );
}

// Season avg vs line comparison
function StatComparison({ seasonAvg, propLine, homeAvg, awayAvg, vsOppHistory }) {
  const rows = [
    { label: 'Season Average', value: seasonAvg },
    { label: 'Home Average',   value: homeAvg   },
    { label: 'Away Average',   value: awayAvg   },
    { label: 'vs This Opp',    value: vsOppHistory },
  ].filter(r => r.value != null);

  return (
    <View style={styles.compContainer}>
      <Text style={styles.sectionLabel}>Season Splits vs Line ({propLine})</Text>
      {rows.map((row, i) => {
        const over = row.value > propLine;
        return (
          <View key={i} style={styles.compRow}>
            <Text style={styles.compLabel}>{row.label}</Text>
            <View style={styles.compRight}>
              <Text style={[styles.compValue, { color: over ? colors.green : colors.red }]}>
                {row.value}
              </Text>
              <Text style={[styles.compDelta, { color: over ? colors.green : colors.red }]}>
                {over ? `+${(row.value - propLine).toFixed(1)} over` : `${(row.value - propLine).toFixed(1)} under`}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Stat bar (same as PickDetailModal)
function StatBar({ label, value, pct, shouldAnimate }) {
  const barAnim = useRef(new Animated.Value(0)).current;
  const barColor = pct >= 70 ? colors.green : pct >= 45 ? '#FFB800' : colors.red;
  useEffect(() => {
    if (shouldAnimate) {
      const t = setTimeout(() => {
        Animated.timing(barAnim, { toValue: pct, duration: 700, useNativeDriver: false }).start();
      }, 200);
      return () => clearTimeout(t);
    }
  }, [shouldAnimate]);
  const barWidth = barAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  return (
    <View style={styles.statBarRow}>
      <View style={styles.statBarHeader}>
        <Text style={styles.statBarLabel}>{label}</Text>
        <Text style={[styles.statBarValue, { color: barColor }]}>{value}</Text>
      </View>
      <View style={styles.statTrack}>
        <Animated.View style={[styles.statFill, { width: barWidth, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

// Affiliate bet button
function AffiliateButton({ bookKey, odds, link, isBest }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPress={() => Linking.openURL(link)}
      onPressIn={() => Animated.spring(scale, { toValue: 0.97, tension: 300, friction: 10, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }).start()}
    >
      <Animated.View style={[styles.affiliateBtn, { borderColor: isBest ? colors.green : colors.border }, isBest && styles.affiliateBtnBest, { transform: [{ scale }] }]}>
        <View style={styles.affiliateBtnInner}>
          <View>
            <Text style={[styles.affiliateName, { color: isBest ? colors.green : colors.offWhite }]}>
              {SPORTSBOOK_NAMES[bookKey]}
            </Text>
            {isBest && <Text style={styles.bestOddsTag}>Best odds</Text>}
          </View>
          <View style={styles.affiliateRight}>
            <Text style={[styles.affiliateOdds, { color: isBest ? colors.green : colors.offWhite }]}>{odds}</Text>
            <Text style={styles.affiliateBet}>Bet Now →</Text>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

export default function PropDetailModal({ pick, visible, onClose }) {
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslateY = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    if (visible) {
      contentOpacity.setValue(0);
      contentTranslateY.setValue(24);
      const t = setTimeout(() => {
        Animated.parallel([
          Animated.timing(contentOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.spring(contentTranslateY, { toValue: 0, tension: 65, friction: 9, useNativeDriver: true }),
        ]).start();
      }, 80);
      return () => clearTimeout(t);
    }
  }, [visible]);

  if (!pick) return null;

  const { analysis, odds, bestOdds, affiliateLinks } = pick;
  const statLabel = (pick.pick || '').replace(/^(Over|Under)\s[\d.]+\s/i, '').trim() || 'Stat';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <View style={styles.propBadge}>
              <Text style={styles.propBadgeText}>PLAYER PROP</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 }}>
              <InitialsAvatar name={pick.playerName} size={32} />
              <View>
                <Text style={styles.modalPlayerName}>{pick.playerName}</Text>
                <Text style={styles.modalPlayerMeta}>{pick.playerTeam} · {pick.playerPosition}</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <Animated.View style={{ flex: 1, opacity: contentOpacity, transform: [{ translateY: contentTranslateY }] }}>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

            {/* Pick hero */}
            <View style={styles.pickHero}>
              <Text style={styles.pickHeroValue}>{pick.pick}</Text>
              <View style={styles.confidencePill}>
                <Text style={styles.confidencePillText}>Chalky: {pick.confidence}% confident</Text>
              </View>
            </View>

            {/* Matchup + injury */}
            {pick.matchupText ? (
              <Text style={styles.matchupHero}>{pick.matchupText}</Text>
            ) : null}
            {analysis.injuryStatus && analysis.injuryStatus !== 'Active' && (
              <View style={styles.injuryBadge}>
                <Text style={styles.injuryBadgeText}>⚠️  {analysis.injuryStatus}</Text>
              </View>
            )}

            {/* Chalky's take */}
            <View style={styles.section}>
              <View style={styles.chalkyTakeHeader}>
                <ChalkyFace size={22} style={styles.chalkyTakeIcon} />
                <Text style={styles.sectionLabel}>Chalky's Take</Text>
              </View>
              <Text style={styles.summaryText}>{analysis.summary}</Text>
            </View>

            {/* Analysis sections */}
            {(analysis.sections || []).map((s, i) => (
              <View key={i} style={styles.analysisCard}>
                <Text style={styles.analysisSectionTitle}>{s.icon}  {s.title}</Text>
                <Text style={styles.analysisSectionContent}>{s.content}</Text>
              </View>
            ))}

            {/* Last 10 bar chart */}
            <Last10Chart
              games={analysis.last10Games}
              propLine={analysis.propLine}
              statLabel={statLabel}
            />

            {/* Season avg vs line */}
            <StatComparison
              seasonAvg={analysis.seasonAvg}
              propLine={analysis.propLine}
              homeAvg={analysis.homeAvg}
              awayAvg={analysis.awayAvg}
              vsOppHistory={analysis.vsOppHistory}
            />

            {/* Key stats bars */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Key Stats</Text>
              {(analysis.keyStats || []).map((s, i) => (
                <StatBar key={i} label={s.label} value={s.value} pct={s.pct} shouldAnimate={visible} />
              ))}
            </View>

            {/* Trends */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Trends</Text>
              {(analysis.trends || []).map((t, i) => (
                <View key={i} style={styles.trendRow}>
                  <View style={styles.trendDot} />
                  <Text style={styles.trendText}>{t}</Text>
                </View>
              ))}
            </View>

            {/* Odds + bet buttons */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Compare Odds & Bet</Text>
              {Object.entries(odds || {}).map(([book, odd]) => (
                <AffiliateButton
                  key={book}
                  bookKey={book}
                  odds={odd}
                  link={(affiliateLinks || {})[book] || 'https://draftkings.com'}
                  isBest={bestOdds === book}
                />
              ))}
            </View>

            <Text style={styles.disclaimer}>
              Not Financial Advice, Bet Responsibly
            </Text>
            <View style={{ height: 40 }} />
          </ScrollView>
        </Animated.View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  topBarLeft: { flex: 1 },
  propBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#0D2B1A', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: colors.green + '44',
  },
  propBadgeText: {
    fontSize: 9, fontWeight: '700', color: colors.green, letterSpacing: 0.6,
  },
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  avatarText: { fontWeight: '800', color: colors.offWhite },
  modalPlayerName: { fontSize: 16, fontWeight: '700', color: colors.offWhite },
  modalPlayerMeta: { fontSize: 12, color: colors.grey, marginTop: 1 },
  closeBtn: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: '#1C1C1C', alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: colors.grey, fontSize: 14, fontWeight: '600' },
  scroll: { flex: 1, padding: spacing.md },
  pickHero: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  pickHeroValue: { fontSize: 26, fontWeight: '800', color: colors.offWhite, flex: 1 },
  confidencePill: {
    backgroundColor: colors.green + '22', borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderWidth: 1, borderColor: colors.green + '44',
  },
  confidencePillText: { fontSize: 12, fontWeight: '700', color: colors.green },
  matchupHero: { fontSize: 13, color: colors.grey, marginBottom: spacing.sm },
  injuryBadge: {
    backgroundColor: colors.red + '18', borderRadius: radius.sm, padding: spacing.sm,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.red + '33',
  },
  injuryBadgeText: { fontSize: 13, color: colors.red, fontWeight: '600' },
  section: { marginBottom: spacing.lg },
  chalkyTakeHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: spacing.sm },
  chalkyTakeIcon: { width: 22, height: 22, borderRadius: 11 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.grey,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm,
  },
  summaryText: { fontSize: 15, lineHeight: 24, color: colors.offWhite },
  analysisCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  analysisSectionTitle: { fontSize: 14, fontWeight: '700', color: colors.offWhite, marginBottom: spacing.xs },
  analysisSectionContent: { fontSize: 13, lineHeight: 20, color: colors.greyLight },
  // Chart
  chartContainer: { marginBottom: spacing.lg },
  chartTitle: {
    fontSize: 11, fontWeight: '700', color: colors.grey,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm,
  },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 4 },
  chartBarCol: { flex: 1, alignItems: 'center' },
  chartStatVal: { fontSize: 9, fontWeight: '700', marginBottom: 2 },
  chartBarTrack: {
    width: '100%', height: 72, justifyContent: 'flex-end',
    backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden',
  },
  chartBarFill: { width: '100%', borderRadius: 3 },
  chartOpp: { fontSize: 8, color: colors.grey, marginTop: 3, textAlign: 'center' },
  lineMarkerRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, gap: spacing.sm },
  lineMarkerDash: { flex: 1, height: 1, borderStyle: 'dashed', borderWidth: 1, borderColor: '#FFB800' },
  lineMarkerLabel: { fontSize: 10, color: '#FFB800', fontWeight: '600' },
  // Comparison
  compContainer: { marginBottom: spacing.lg },
  compRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  compLabel: { fontSize: 13, color: colors.greyLight },
  compRight: { alignItems: 'flex-end' },
  compValue: { fontSize: 15, fontWeight: '700' },
  compDelta: { fontSize: 10, marginTop: 1 },
  // Stat bars
  statBarRow: { marginBottom: spacing.md },
  statBarHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  statBarLabel: { fontSize: 13, color: colors.offWhite },
  statBarValue: { fontSize: 13, fontWeight: '700' },
  statTrack: { height: 6, backgroundColor: colors.border, borderRadius: radius.full, overflow: 'hidden' },
  statFill: { height: '100%', borderRadius: radius.full },
  // Trends
  trendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm },
  trendDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: colors.green },
  trendText: { fontSize: 13, color: colors.offWhite, flex: 1, lineHeight: 20 },
  // Affiliate
  affiliateBtn: {
    borderWidth: 1, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, backgroundColor: colors.surface,
  },
  affiliateBtnBest: { backgroundColor: colors.green + '11' },
  affiliateBtnInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  affiliateName: { fontSize: 15, fontWeight: '700' },
  bestOddsTag: { fontSize: 10, fontWeight: '600', color: colors.green, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  affiliateRight: { alignItems: 'flex-end' },
  affiliateOdds: { fontSize: 18, fontWeight: '800' },
  affiliateBet: { fontSize: 11, color: colors.grey, marginTop: 2 },
  disclaimer: { fontSize: 11, color: colors.grey, textAlign: 'center', marginBottom: spacing.md, marginTop: spacing.sm },
});
