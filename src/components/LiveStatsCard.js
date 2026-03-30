import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

// Pulsing dot — only pulses while the game is LIVE
function LiveDot({ isLive }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isLive) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.5, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [isLive]);

  return (
    <Animated.View
      style={[styles.liveDot, { transform: [{ scale: pulseAnim }] }]}
    />
  );
}

function getGameContext(liveStats, sport) {
  if (sport === 'NBA') {
    const opp = liveStats.isHome
      ? `vs ${liveStats.opponent}`
      : `@ ${liveStats.opponent}`;
    if (liveStats.isLive) return `Q${liveStats.period} ${liveStats.clock} · ${opp}`;
    return `Final · ${opp}`;
  }
  if (sport === 'NHL') {
    if (liveStats.isLive) return `P${liveStats.period} ${liveStats.clock}`;
    return 'Final';
  }
  if (sport === 'MLB') {
    return `${liveStats.inningHalf || ''} ${liveStats.inning || ''}`.trim();
  }
  return '';
}

function getStatBoxes(liveStats, sport) {
  if (sport === 'NBA') {
    return [
      { label: 'PTS', value: liveStats.points    ?? 0 },
      { label: 'REB', value: liveStats.rebounds  ?? 0 },
      { label: 'AST', value: liveStats.assists   ?? 0 },
      { label: 'STL', value: liveStats.steals    ?? 0 },
      { label: 'BLK', value: liveStats.blocks    ?? 0 },
      { label: 'FG',  value: liveStats.fg || '0/0' },
    ];
  }
  if (sport === 'NHL') {
    if (liveStats.isGoalie) {
      return [
        { label: 'SV',  value: liveStats.saves        ?? 0 },
        { label: 'SA',  value: liveStats.shotsAgainst ?? 0 },
        { label: 'GA',  value: liveStats.goalsAgainst ?? 0 },
        { label: 'SV%', value: liveStats.savePct != null
            ? (liveStats.savePct * 100).toFixed(1) + '%' : '.000' },
      ];
    }
    return [
      { label: 'G',   value: liveStats.goals     ?? 0 },
      { label: 'A',   value: liveStats.assists   ?? 0 },
      { label: 'PTS', value: liveStats.points    ?? 0 },
      { label: 'SOG', value: liveStats.shots     ?? 0 },
      { label: 'HIT', value: liveStats.hits      ?? 0 },
      { label: '+/-', value: liveStats.plusMinus ?? 0 },
    ];
  }
  if (sport === 'MLB') {
    if (liveStats.isPitcher) {
      return [
        { label: 'IP', value: liveStats.inningsPitched ?? 0 },
        { label: 'K',  value: liveStats.strikeouts     ?? 0 },
        { label: 'ER', value: liveStats.earnedRuns     ?? 0 },
        { label: 'H',  value: liveStats.hits           ?? 0 },
        { label: 'BB', value: liveStats.walks          ?? 0 },
        { label: 'PC', value: liveStats.pitchCount     ?? 0 },
      ];
    }
    return [
      { label: 'AB',  value: liveStats.atBats     ?? 0 },
      { label: 'H',   value: liveStats.hits       ?? 0 },
      { label: 'HR',  value: liveStats.homeRuns   ?? 0 },
      { label: 'RBI', value: liveStats.rbi        ?? 0 },
      { label: 'BB',  value: liveStats.walks      ?? 0 },
      { label: 'K',   value: liveStats.strikeouts ?? 0 },
    ];
  }
  return [];
}

export default function LiveStatsCard({ liveStats, sport }) {
  if (!liveStats) return null;

  const statBoxes = getStatBoxes(liveStats, sport);
  const context   = getGameContext(liveStats, sport);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.liveRow}>
          <LiveDot isLive={liveStats.isLive} />
          <Text style={styles.liveText}>
            {liveStats.isLive ? 'LIVE' : 'TODAY'}
          </Text>
        </View>
        {!!context && (
          <Text style={styles.context}>{context}</Text>
        )}
      </View>

      {/* Stats grid */}
      <View style={styles.statsGrid}>
        {statBoxes.map((stat, i) => (
          <View key={i} style={styles.statBox}>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.updateNote}>Updates every 60 seconds</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#00E87A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00E87A',
  },
  liveText: {
    color: '#00E87A',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  context: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '500',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statBox: {
    flex: 1,
    minWidth: '28%',
    backgroundColor: '#141414',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  statValue: {
    color: '#F5F5F0',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  statLabel: {
    color: '#888888',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  updateNote: {
    color: '#3a3a3a',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 12,
  },
});
