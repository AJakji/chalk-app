import React, { useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Modal,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { colors, spacing, radius, typography } from '../../theme';

const SPORTSBOOK_NAMES = {
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  betmgm: 'BetMGM',
  bet365: 'bet365',
};

const SPORTSBOOK_COLORS = {
  draftkings: '#1B5E3B',
  fanduel: '#1C3E8E',
  betmgm: '#B29560',
  bet365: '#007A3D',
};

function StatBar({ label, value, pct }) {
  const barColor = pct >= 70 ? colors.green : pct >= 45 ? '#FFB800' : colors.red;
  return (
    <View style={styles.statBarRow}>
      <View style={styles.statBarHeader}>
        <Text style={styles.statBarLabel}>{label}</Text>
        <Text style={[styles.statBarValue, { color: barColor }]}>{value}</Text>
      </View>
      <View style={styles.statTrack}>
        <View style={[styles.statFill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

function AffiliateButton({ bookKey, odds, link, isBest }) {
  return (
    <TouchableOpacity
      style={[
        styles.affiliateBtn,
        { borderColor: isBest ? colors.green : colors.border },
        isBest && styles.affiliateBtnBest,
      ]}
      onPress={() => Linking.openURL(link)}
      activeOpacity={0.8}
    >
      <View style={styles.affiliateBtnInner}>
        <View>
          <Text style={[styles.affiliateName, { color: isBest ? colors.green : colors.offWhite }]}>
            {SPORTSBOOK_NAMES[bookKey]}
          </Text>
          {isBest && (
            <Text style={styles.bestOddsTag}>Best odds</Text>
          )}
        </View>
        <View style={styles.affiliateRight}>
          <Text style={[styles.affiliateOdds, { color: isBest ? colors.green : colors.offWhite }]}>
            {odds}
          </Text>
          <Text style={styles.affiliateBet}>Bet Now →</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function PickDetailModal({ pick, visible, onClose }) {
  if (!pick) return null;

  const { analysis, odds, bestOdds, affiliateLinks } = pick;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <View>
            <Text style={styles.modalLeague}>{pick.league} · {pick.pickType}</Text>
            <Text style={styles.modalMatchup}>
              {pick.awayTeam} @ {pick.homeTeam}
            </Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Pick hero */}
          <View style={styles.pickHero}>
            <Text style={styles.pickHeroValue}>{pick.pick}</Text>
            <View style={styles.confidencePill}>
              <Text style={styles.confidencePillText}>{pick.confidence}% confidence</Text>
            </View>
          </View>

          {/* AI Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>AI Analysis</Text>
            <Text style={styles.summaryText}>{analysis.summary}</Text>
          </View>

          {/* Analysis sections */}
          {analysis.sections.map((s, i) => (
            <View key={i} style={styles.analysisCard}>
              <Text style={styles.analysisSectionTitle}>
                {s.icon}  {s.title}
              </Text>
              <Text style={styles.analysisSectionContent}>{s.content}</Text>
            </View>
          ))}

          {/* Key Stats */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Key Stats</Text>
            {analysis.keyStats.map((s, i) => (
              <StatBar key={i} label={s.label} value={s.value} pct={s.pct} />
            ))}
          </View>

          {/* Trends */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Trends</Text>
            {analysis.trends.map((t, i) => (
              <View key={i} style={styles.trendRow}>
                <View style={styles.trendDot} />
                <Text style={styles.trendText}>{t}</Text>
              </View>
            ))}
          </View>

          {/* Odds Comparison + Bet Buttons */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Compare Odds & Bet</Text>
            {Object.entries(odds).map(([book, odd]) => (
              <AffiliateButton
                key={book}
                bookKey={book}
                odds={odd}
                link={affiliateLinks[book]}
                isBest={bestOdds === book}
              />
            ))}
          </View>

          {/* Disclaimer */}
          <Text style={styles.disclaimer}>
            Chalk is for entertainment only. Bet responsibly. 18+.
          </Text>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalLeague: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  modalMatchup: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.offWhite,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: colors.grey,
    fontSize: 14,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
    padding: spacing.md,
  },
  pickHero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.lg,
  },
  pickHeroValue: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.offWhite,
  },
  confidencePill: {
    backgroundColor: colors.green + '22',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.green + '44',
  },
  confidencePillText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.green,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  summaryText: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.offWhite,
  },
  analysisCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  analysisSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.offWhite,
    marginBottom: spacing.xs,
  },
  analysisSectionContent: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.greyLight,
  },
  statBarRow: {
    marginBottom: spacing.md,
  },
  statBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  statBarLabel: {
    fontSize: 13,
    color: colors.offWhite,
  },
  statBarValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  statTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  statFill: {
    height: '100%',
    borderRadius: radius.full,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  trendDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.green,
  },
  trendText: {
    fontSize: 13,
    color: colors.offWhite,
    flex: 1,
    lineHeight: 20,
  },
  affiliateBtn: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  affiliateBtnBest: {
    backgroundColor: colors.green + '11',
  },
  affiliateBtnInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  affiliateName: {
    fontSize: 15,
    fontWeight: '700',
  },
  bestOddsTag: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.green,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  affiliateRight: {
    alignItems: 'flex-end',
  },
  affiliateOdds: {
    fontSize: 18,
    fontWeight: '800',
  },
  affiliateBet: {
    fontSize: 11,
    color: colors.grey,
    marginTop: 2,
  },
  disclaimer: {
    fontSize: 11,
    color: colors.grey,
    textAlign: 'center',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
});
