import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { colors, spacing, radius } from '../../theme';

const TABS = ['Box Score', 'Play-by-Play'];

function QuarterHeaders({ sport }) {
  const q = sport === 'NFL' ? ['Q1', 'Q2', 'Q3', 'Q4', 'F'] : ['Q1', 'Q2', 'Q3', 'Q4', 'F'];
  return (
    <View style={styles.qRow}>
      <Text style={[styles.qCell, styles.qTeamCell]} />
      {q.map((qtr) => (
        <Text key={qtr} style={styles.qCell}>{qtr}</Text>
      ))}
    </View>
  );
}

function QuarterRow({ label, scores }) {
  const total = scores.filter((s) => s !== null).reduce((a, b) => a + b, 0);
  return (
    <View style={styles.qRow}>
      <Text style={[styles.qCell, styles.qTeamCell]}>{label}</Text>
      {scores.map((s, i) => (
        <Text key={i} style={[styles.qCell, s === null && styles.qCellEmpty]}>
          {s !== null ? s : '-'}
        </Text>
      ))}
      <Text style={[styles.qCell, styles.qTotalCell]}>{total}</Text>
    </View>
  );
}

function PlayerStatRow({ player, isHeader }) {
  if (isHeader) {
    return (
      <View style={styles.playerRow}>
        <Text style={[styles.playerName, styles.statHeader]}>Player</Text>
        <Text style={[styles.playerPos, styles.statHeader]}>POS</Text>
        <Text style={[styles.statCell, styles.statHeader]}>PTS</Text>
        <Text style={[styles.statCell, styles.statHeader]}>REB</Text>
        <Text style={[styles.statCell, styles.statHeader]}>AST</Text>
        <Text style={[styles.statCell, styles.statHeader]}>FG</Text>
        <Text style={[styles.statCell, styles.statHeader]}>+/-</Text>
      </View>
    );
  }
  const pmColor = player.pm > 0 ? colors.green : player.pm < 0 ? colors.red : colors.grey;
  return (
    <View style={styles.playerRow}>
      <Text style={styles.playerName} numberOfLines={1}>{player.name}</Text>
      <Text style={styles.playerPos}>{player.pos}</Text>
      <Text style={styles.statCell}>{player.pts}</Text>
      <Text style={styles.statCell}>{player.reb}</Text>
      <Text style={styles.statCell}>{player.ast}</Text>
      <Text style={[styles.statCell, styles.fgCell]}>{player.fg}</Text>
      <Text style={[styles.statCell, { color: pmColor }]}>
        {player.pm > 0 ? `+${player.pm}` : player.pm}
      </Text>
    </View>
  );
}

function BoxScoreTab({ game }) {
  const { boxScore, awayTeam, homeTeam } = game;

  if (!boxScore) {
    return (
      <View style={styles.noDataContainer}>
        <Text style={styles.noDataText}>
          {game.status === 'upcoming'
            ? 'Box score available at tip-off'
            : 'Box score not available for this sport yet'}
        </Text>
      </View>
    );
  }

  return (
    <View>
      {/* Quarter score */}
      <View style={styles.quarterBlock}>
        <Text style={styles.blockLabel}>Line Score</Text>
        <View style={styles.quarterTable}>
          <QuarterHeaders />
          <QuarterRow label={awayTeam.abbr} scores={boxScore.quarters.away} />
          <View style={styles.qDivider} />
          <QuarterRow label={homeTeam.abbr} scores={boxScore.quarters.home} />
        </View>
      </View>

      {/* Away stats */}
      <View style={styles.playerBlock}>
        <Text style={styles.blockLabel}>{awayTeam.name}</Text>
        <PlayerStatRow isHeader />
        {boxScore.away.players.map((p, i) => (
          <PlayerStatRow key={i} player={p} />
        ))}
        <View style={styles.totalsDivider} />
        <View style={styles.playerRow}>
          <Text style={[styles.playerName, styles.totalsLabel]}>Totals</Text>
          <Text style={styles.playerPos} />
          <Text style={styles.statCell} />
          <Text style={styles.statCell} />
          <Text style={styles.statCell} />
          <Text style={[styles.statCell, styles.fgCell]}>{boxScore.away.totals.fg}</Text>
          <Text style={styles.statCell} />
        </View>
      </View>

      {/* Home stats */}
      <View style={styles.playerBlock}>
        <Text style={styles.blockLabel}>{homeTeam.name}</Text>
        <PlayerStatRow isHeader />
        {boxScore.home.players.map((p, i) => (
          <PlayerStatRow key={i} player={p} />
        ))}
        <View style={styles.totalsDivider} />
        <View style={styles.playerRow}>
          <Text style={[styles.playerName, styles.totalsLabel]}>Totals</Text>
          <Text style={styles.playerPos} />
          <Text style={styles.statCell} />
          <Text style={styles.statCell} />
          <Text style={styles.statCell} />
          <Text style={[styles.statCell, styles.fgCell]}>{boxScore.home.totals.fg}</Text>
          <Text style={styles.statCell} />
        </View>
      </View>
    </View>
  );
}

function PlayByPlayTab({ events }) {
  if (!events || events.length === 0) {
    return (
      <View style={styles.noDataContainer}>
        <Text style={styles.noDataText}>Play-by-play available once game starts</Text>
      </View>
    );
  }
  return (
    <View style={styles.pbpContainer}>
      {events.map((e, i) => (
        <View key={i} style={styles.pbpRow}>
          <Text style={styles.pbpTime}>{e.time}</Text>
          <Text style={styles.pbpEvent}>{e.event}</Text>
        </View>
      ))}
    </View>
  );
}

export default function GameDetailModal({ game, visible, onClose }) {
  const [activeTab, setActiveTab] = useState(0);
  if (!game) return null;

  const { awayTeam, homeTeam, status, clock, league, chalkPick } = game;
  const isLive = status === 'live';
  const isFinal = status === 'final';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerInfo}>
            <Text style={styles.headerLeague}>{league}</Text>
            {isLive && <Text style={styles.headerLiveClock}> · {clock}</Text>}
            {isFinal && <Text style={styles.headerFinal}> · Final</Text>}
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Scoreboard hero */}
        <View style={styles.scoreHero}>
          <View style={styles.heroTeam}>
            <Text style={styles.heroAbbr}>{awayTeam.abbr}</Text>
            <Text style={styles.heroName} numberOfLines={1}>{awayTeam.name}</Text>
            <Text style={styles.heroLabel}>Away</Text>
          </View>

          <View style={styles.heroCenter}>
            {status === 'upcoming' ? (
              <Text style={styles.heroUpcoming}>{clock}</Text>
            ) : (
              <View style={styles.heroScoreRow}>
                <Text style={[
                  styles.heroScore,
                  isFinal && awayTeam.score > homeTeam.score && styles.heroScoreWin,
                ]}>
                  {awayTeam.score}
                </Text>
                <Text style={styles.heroScoreDash}>-</Text>
                <Text style={[
                  styles.heroScore,
                  isFinal && homeTeam.score > awayTeam.score && styles.heroScoreWin,
                ]}>
                  {homeTeam.score}
                </Text>
              </View>
            )}
            {isLive && (
              <View style={styles.liveIndicator}>
                <View style={styles.liveDot} />
                <Text style={styles.liveIndicatorText}>LIVE · {clock}</Text>
              </View>
            )}
          </View>

          <View style={[styles.heroTeam, { alignItems: 'flex-end' }]}>
            <Text style={styles.heroAbbr}>{homeTeam.abbr}</Text>
            <Text style={styles.heroName} numberOfLines={1}>{homeTeam.name}</Text>
            <Text style={styles.heroLabel}>Home</Text>
          </View>
        </View>

        {/* Chalk pick banner */}
        {chalkPick && (
          <View style={[
            styles.chalkBanner,
            chalkPick.result === 'winning' || chalkPick.result === 'win'
              ? styles.chalkBannerWin
              : chalkPick.result === 'losing' || chalkPick.result === 'loss'
              ? styles.chalkBannerLoss
              : styles.chalkBannerNeutral,
          ]}>
            <Text style={[
              styles.chalkBannerText,
              (chalkPick.result === 'winning' || chalkPick.result === 'win') && { color: colors.green },
              (chalkPick.result === 'losing' || chalkPick.result === 'loss') && { color: colors.red },
            ]}>
              🎯 Chalk Pick: {chalkPick.pick}
              {chalkPick.result === 'winning' ? '  ·  Winning ✓' : ''}
              {chalkPick.result === 'win' ? '  ·  WIN ✓' : ''}
              {chalkPick.result === 'losing' ? '  ·  Losing' : ''}
              {chalkPick.result === 'loss' ? '  ·  LOSS' : ''}
            </Text>
          </View>
        )}

        {/* Tab bar */}
        <View style={styles.tabBar}>
          {TABS.map((tab, i) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === i && styles.tabActive]}
              onPress={() => setActiveTab(i)}
            >
              <Text style={[styles.tabText, activeTab === i && styles.tabTextActive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Content */}
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {activeTab === 0 ? (
            <BoxScoreTab game={game} />
          ) : (
            <PlayByPlayTab events={game.playByPlay} />
          )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLeague: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  headerLiveClock: {
    fontSize: 13,
    color: colors.red,
    fontWeight: '600',
  },
  headerFinal: {
    fontSize: 13,
    color: colors.grey,
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
  },
  scoreHero: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  heroTeam: {
    flex: 1,
    alignItems: 'flex-start',
  },
  heroAbbr: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.offWhite,
  },
  heroName: {
    fontSize: 11,
    color: colors.grey,
    marginTop: 2,
  },
  heroLabel: {
    fontSize: 10,
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  heroCenter: {
    alignItems: 'center',
    flex: 1,
  },
  heroScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroScore: {
    fontSize: 38,
    fontWeight: '800',
    color: colors.grey,
  },
  heroScoreWin: {
    color: colors.offWhite,
  },
  heroScoreDash: {
    fontSize: 24,
    color: colors.grey,
  },
  heroUpcoming: {
    fontSize: 14,
    color: colors.grey,
    fontWeight: '600',
    textAlign: 'center',
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.red,
  },
  liveIndicatorText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.red,
    letterSpacing: 0.3,
  },
  chalkBanner: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  chalkBannerWin: {
    backgroundColor: colors.green + '18',
    borderWidth: 1,
    borderColor: colors.green + '33',
  },
  chalkBannerLoss: {
    backgroundColor: colors.red + '18',
    borderWidth: 1,
    borderColor: colors.red + '33',
  },
  chalkBannerNeutral: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chalkBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginTop: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: colors.green,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey,
  },
  tabTextActive: {
    color: colors.green,
  },
  scroll: {
    flex: 1,
    padding: spacing.md,
  },
  // Quarter score
  quarterBlock: {
    marginBottom: spacing.lg,
  },
  blockLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  quarterTable: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  qCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: colors.offWhite,
  },
  qCellEmpty: {
    color: colors.grey,
  },
  qTeamCell: {
    flex: 1.5,
    textAlign: 'left',
    paddingLeft: spacing.xs,
    fontWeight: '700',
    color: colors.offWhite,
  },
  qTotalCell: {
    fontWeight: '800',
    color: colors.offWhite,
  },
  qDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  // Player stats
  playerBlock: {
    marginBottom: spacing.lg,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '66',
  },
  statHeader: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  playerName: {
    flex: 2.5,
    fontSize: 13,
    fontWeight: '500',
    color: colors.offWhite,
  },
  playerPos: {
    width: 28,
    fontSize: 11,
    color: colors.grey,
    textAlign: 'center',
  },
  statCell: {
    flex: 1,
    fontSize: 13,
    color: colors.offWhite,
    textAlign: 'center',
  },
  fgCell: {
    flex: 1.4,
    fontSize: 12,
    color: colors.greyLight,
  },
  totalsDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  totalsLabel: {
    fontWeight: '700',
    color: colors.grey,
  },
  // Play by play
  pbpContainer: {
    gap: 0,
  },
  pbpRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '66',
    gap: spacing.sm,
  },
  pbpTime: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.green,
    width: 72,
    paddingTop: 1,
  },
  pbpEvent: {
    flex: 1,
    fontSize: 13,
    color: colors.offWhite,
    lineHeight: 20,
  },
  noDataContainer: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  noDataText: {
    fontSize: 14,
    color: colors.grey,
    textAlign: 'center',
  },
});
