import React, { useRef, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Pressable,
  Animated, StyleSheet, Modal, SafeAreaView, StatusBar,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { API_URL } from '../../config';
import PlayerAvatar from './PlayerAvatar';

// ── Helpers ────────────────────────────────────────────────────────────────────

function StatBubble({ label, value }) {
  return (
    <View style={styles.statBubble}>
      <Text style={styles.statBubbleValue}>{value ?? '—'}</Text>
      <Text style={styles.statBubbleLabel}>{label}</Text>
    </View>
  );
}

// ── Last 10 games table ────────────────────────────────────────────────────────

// Sport + subtype → column definitions
const SPORT_COLS = {
  NBA:         [{ h: 'PTS', k: 'pts' }, { h: 'REB', k: 'reb' }, { h: 'AST', k: 'ast' }, { h: '+/-', k: 'plusMinus' }],
  NHL:         [{ h: 'G',   k: 'goals' }, { h: 'A', k: 'assists' }, { h: 'PTS', k: 'points' }, { h: 'SOG', k: 'sog' }, { h: '+/-', k: 'plusMinus' }],
  MLB_batter:  [{ h: 'AB',  k: 'ab' }, { h: 'H', k: 'hits' }, { h: 'HR', k: 'hr' }, { h: 'RBI', k: 'rbi' }],
  MLB_pitcher: [{ h: 'IP',  k: 'ip' }, { h: 'H', k: 'hits' }, { h: 'ER', k: 'er' }, { h: 'K', k: 'k' }, { h: 'BB', k: 'bb' }],
};

function resultRowStyle(result) {
  if (!result) return null;
  const r = result.toUpperCase();
  if (r === 'W') return styles.rowWin;
  if (r === 'L') return styles.rowLoss;
  if (r === 'OT' || r === 'SO') return styles.rowOT;
  return null;
}

function resultColor(result) {
  if (!result) return colors.grey;
  if (result === 'W')  return colors.green;
  if (result === 'L')  return colors.red;
  if (result === 'OT') return '#FFB800';
  return colors.grey;
}

function Last10Table({ games, league, isPitcher }) {
  if (!games || games.length === 0) {
    return <Text style={styles.emptyNote}>No recent game data.</Text>;
  }

  let colKey = league;
  if (league === 'MLB') colKey = isPitcher ? 'MLB_pitcher' : 'MLB_batter';
  const cols = SPORT_COLS[colKey] || SPORT_COLS.NBA;

  return (
    <View style={styles.table}>
      {/* Header */}
      <View style={[styles.tableRow, styles.tableHeader]}>
        <Text style={[styles.tableCell, styles.tableHeaderText, { flex: 1.4 }]}>DATE</Text>
        <Text style={[styles.tableCell, styles.tableHeaderText, { flex: 0.9 }]}>OPP</Text>
        <Text style={[styles.tableCell, styles.tableHeaderText, { flex: 1.4 }]}>RES</Text>
        {cols.map(c => (
          <Text key={c.h} style={[styles.tableCell, styles.tableHeaderText]}>{c.h}</Text>
        ))}
      </View>
      {games.map((g, i) => {
        const rowTint   = resultRowStyle(g.result);
        const resColor  = resultColor(g.result);
        // Show "W 3-1" or "L 1-3" or "OT 3-4" if score is available, otherwise just result
        const resLabel  = g.score ? `${g.result || '—'} ${g.score}` : (g.result || '—');
        return (
          <View key={i} style={[styles.tableRow, rowTint]}>
            <Text style={[styles.tableCell, { flex: 1.4, fontSize: 11 }]}>{g.date}</Text>
            <Text style={[styles.tableCell, { flex: 0.9 }]}>{g.opp}</Text>
            <Text style={[styles.tableCell, { flex: 1.4, color: resColor, fontWeight: '700', fontSize: 11 }]}>
              {resLabel}
            </Text>
            {cols.map(c => (
              <Text key={c.k} style={styles.tableCell}>{g[c.k] ?? '—'}</Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

// ── Splits section ─────────────────────────────────────────────────────────────

function SplitsSection({ splits }) {
  if (!splits) return null;
  const { home, away, last5, last10, season } = splits;
  const statKeys = Object.keys(home || last5 || {}).slice(0, 3);

  return (
    <View>
      {home && away && (
        <View style={styles.splitsGrid}>
          <View style={[styles.splitCard, { borderColor: colors.green + '44' }]}>
            <Text style={[styles.splitLabel, { color: colors.green }]}>HOME</Text>
            {statKeys.map(k => (
              <View key={k} style={styles.splitRow}>
                <Text style={styles.splitKey}>{k}</Text>
                <Text style={styles.splitVal}>{home[k]}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.splitCard, { borderColor: colors.grey + '44' }]}>
            <Text style={[styles.splitLabel, { color: colors.grey }]}>AWAY</Text>
            {statKeys.map(k => (
              <View key={k} style={styles.splitRow}>
                <Text style={styles.splitKey}>{k}</Text>
                <Text style={styles.splitVal}>{away[k]}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      {last5 && last10 && season && (
        <View style={styles.avgTable}>
          <View style={styles.avgTableHeader}>
            <Text style={[styles.avgTableCell, styles.avgHeaderText, { flex: 1.4 }]}>STAT</Text>
            <Text style={[styles.avgTableCell, styles.avgHeaderText]}>L5</Text>
            <Text style={[styles.avgTableCell, styles.avgHeaderText]}>L10</Text>
            <Text style={[styles.avgTableCell, styles.avgHeaderText]}>SEASON</Text>
          </View>
          {statKeys.map(k => (
            <View key={k} style={styles.avgTableRow}>
              <Text style={[styles.avgTableCell, { flex: 1.4, color: colors.offWhite }]}>{k}</Text>
              <Text style={styles.avgTableCell}>{last5[k] ?? '—'}</Text>
              <Text style={styles.avgTableCell}>{last10[k] ?? '—'}</Text>
              <Text style={styles.avgTableCell}>{season[k] ?? '—'}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Career stats table ─────────────────────────────────────────────────────────

const CAREER_HEADERS = {
  NBA: ['SEASON', 'TM', 'GP', 'PTS', 'REB', 'AST'],
  NHL: ['SEASON', 'TM', 'GP', 'G',   'A',   'PTS'],
  MLB: ['SEASON', 'TM', 'GP', 'AVG', 'HR',  'RBI'],
};
const CAREER_KEYS = {
  NBA: ['season', 'team', 'gp', 'pts', 'reb', 'ast'],
  NHL: ['season', 'team', 'gp', 'g',   'a',   'pts'],
  MLB: ['season', 'team', 'gp', 'avg', 'hr',  'rbi'],
};

function CareerStatsTable({ stats, league = 'NBA' }) {
  if (!stats || stats.length === 0) return null;
  const headers = CAREER_HEADERS[league] || CAREER_HEADERS.NBA;
  const keys    = CAREER_KEYS[league]    || CAREER_KEYS.NBA;
  return (
    <View style={styles.table}>
      <View style={[styles.tableRow, styles.tableHeader]}>
        {headers.map(h => (
          <Text key={h} style={[styles.tableCell, styles.tableHeaderText]}>{h}</Text>
        ))}
      </View>
      {stats.map((s, i) => (
        <View key={i} style={styles.tableRow}>
          {keys.map(k => (
            <Text key={k} style={styles.tableCell}>{s[k] ?? '—'}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

// ── Collapsible section ────────────────────────────────────────────────────────

function Section({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <View style={styles.sectionWrap}>
      <TouchableOpacity style={styles.sectionHeader} onPress={() => setOpen(v => !v)} activeOpacity={0.7}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionChevron}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

export default function PlayerProfileModal({ playerId, playerLeague = 'NBA', playerName, visible, onClose, onAskChalky }) {
  const contentOpacity   = useRef(new Animated.Value(0)).current;
  const contentTranslateY = useRef(new Animated.Value(24)).current;
  const [player, setPlayer]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(false);

  useEffect(() => {
    if (visible && playerId) {
      setPlayer(null);
      setError(false);
      setLoading(true);
      fetch(`${API_URL}/api/players/${playerId}?league=${playerLeague}`)
        .then(r => r.json())
        .then(({ player: p }) => {
          setPlayer(p || null);
          setError(!p);
          setLoading(false);
        })
        .catch(() => { setError(true); setLoading(false); });
    }
  }, [visible, playerId, playerLeague]);

  useEffect(() => {
    if (visible) {
      contentOpacity.setValue(0);
      contentTranslateY.setValue(24);
      const t = setTimeout(() => {
        Animated.parallel([
          Animated.timing(contentOpacity,    { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.spring(contentTranslateY, { toValue: 0, tension: 65, friction: 9, useNativeDriver: true }),
        ]).start();
      }, 80);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const displayName = player?.name || playerName || 'Player';
  const isPitcher   = ['SP', 'RP', 'P'].includes(player?.position || '');
  const statKeys    = player ? Object.keys(player.seasonStats || {}) : [];

  const bio = [];
  if (player?.height)   bio.push(player.height);
  if (player?.weight)   bio.push(`${player.weight} lbs`);
  if (player?.country && playerLeague === 'NBA') bio.push(player.country);
  if (player?.college)  bio.push(player.college);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>

        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <View style={styles.playerHeaderRow}>
              <PlayerAvatar name={displayName} headshot={player?.headshot} size={52} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text style={styles.playerName} numberOfLines={1}>{displayName}</Text>
                {player && (
                  <Text style={styles.playerMeta}>
                    {player.team}{player.position ? ` · ${player.position}` : ''}
                    {player.jerseyNumber ? ` · #${player.jerseyNumber}` : ''}
                  </Text>
                )}
                {bio.length > 0 && (
                  <Text style={styles.playerBio}>{bio.join(' · ')}</Text>
                )}
              </View>
            </View>
            {player?.tonightGame && (
              <View style={styles.tonightRow}>
                <View style={styles.tonightDot} />
                <Text style={styles.tonightText}>{player.tonightGame}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Ask Chalky button */}
        <View style={styles.askChalkyRow}>
          <Pressable
            style={styles.askChalkyBtn}
            onPress={() => {
              onClose();
              onAskChalky?.(`Tell me about ${displayName}'s stats and any prop bets available for them tonight`);
            }}
          >
            <Text style={styles.askChalkyBtnText}>Ask Chalky about {displayName} →</Text>
          </Pressable>
        </View>

        {/* Body */}
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.green} size="large" />
            <Text style={styles.loadingText}>Loading stats…</Text>
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Text style={styles.emptyNote}>Could not load player data. Pull down to retry.</Text>
          </View>
        ) : (
          <Animated.View style={{ flex: 1, opacity: contentOpacity, transform: [{ translateY: contentTranslateY }] }}>
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

              {/* Season Stats grid */}
              {player?.seasonStats && statKeys.length > 0 && (
                <Section title="Season Stats">
                  <View style={styles.statGrid}>
                    {statKeys.map(k => (
                      <StatBubble key={k} label={k} value={player.seasonStats[k]} />
                    ))}
                  </View>
                </Section>
              )}

              {/* Last 10 Games */}
              {player?.last10Games && player.last10Games.length > 0 && (
                <Section title="Last 10 Games">
                  <Last10Table
                    games={player.last10Games}
                    league={playerLeague}
                    isPitcher={isPitcher}
                  />
                </Section>
              )}

              {/* Splits */}
              {player?.splits && (
                <Section title="Splits">
                  <SplitsSection splits={player.splits} />
                </Section>
              )}

              {/* Career Stats */}
              {player?.careerStats && player.careerStats.length > 0 && (
                <Section title="Career Stats">
                  <CareerStatsTable stats={player.careerStats} league={playerLeague} />
                </Section>
              )}

              {/* Injury */}
              {player?.injury && (
                <Section title="Injury Report">
                  <View style={styles.injuryCard}>
                    <Text style={styles.injuryStatus}>{player.injury.status}</Text>
                    <Text style={styles.injuryDesc}>{player.injury.description}</Text>
                    {player.injury.returnDate && (
                      <Text style={styles.injuryReturn}>Expected return: {player.injury.returnDate}</Text>
                    )}
                  </View>
                </Section>
              )}

              <View style={{ height: 48 }} />
            </ScrollView>
          </Animated.View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },

  // Header
  topBar: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm,
  },
  playerHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.xs },
  playerName:      { fontSize: 20, fontWeight: '800', color: colors.offWhite, marginBottom: 2 },
  playerMeta:      { fontSize: 13, color: colors.grey, marginBottom: 2 },
  playerBio:       { fontSize: 11, color: colors.grey + 'BB' },
  tonightRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  tonightDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  tonightText:     { fontSize: 12, color: colors.greyLight },
  closeBtn: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: '#1C1C1C', alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: colors.grey, fontSize: 14, fontWeight: '600' },

  // Ask Chalky
  askChalkyRow: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  askChalkyBtn: {
    backgroundColor: colors.green + '18', borderRadius: radius.md,
    padding: spacing.sm + 2, alignItems: 'center',
    borderWidth: 1, borderColor: colors.green + '44',
  },
  askChalkyBtnText: { fontSize: 13, fontWeight: '700', color: colors.green },

  // States
  centered:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  loadingText: { marginTop: spacing.sm, fontSize: 13, color: colors.grey },

  // Scroll
  scroll: { flex: 1, paddingHorizontal: spacing.md },

  // Sections
  sectionWrap: { marginTop: spacing.md, marginBottom: spacing.sm },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  sectionTitle:   { fontSize: 13, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionChevron: { fontSize: 10, color: colors.grey },
  sectionBody:    {},

  // Stat grid
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statBubble: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', minWidth: 68,
  },
  statBubbleValue: { fontSize: 16, fontWeight: '800', color: colors.offWhite },
  statBubbleLabel: { fontSize: 9, color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },

  // Last 10 table
  table: { borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  tableRow: {
    flexDirection: 'row', paddingVertical: 7, paddingHorizontal: spacing.xs,
    borderBottomWidth: 1, borderBottomColor: colors.border + '66',
  },
  tableHeader:     { backgroundColor: colors.surface },
  tableHeaderText: { fontSize: 9, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.5 },
  tableCell:       { flex: 1, fontSize: 12, color: colors.greyLight, textAlign: 'center' },
  rowWin:          { backgroundColor: colors.green + '10' },
  rowLoss:         { backgroundColor: colors.red + '10' },
  rowOT:           { backgroundColor: '#FFB80010' },

  // Splits
  splitsGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  splitCard: { flex: 1, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, backgroundColor: colors.surface },
  splitLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  splitRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  splitKey:   { fontSize: 12, color: colors.grey },
  splitVal:   { fontSize: 12, fontWeight: '700', color: colors.offWhite },
  avgTable: { borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  avgTableHeader: { flexDirection: 'row', backgroundColor: colors.surface, paddingVertical: 7, paddingHorizontal: spacing.sm },
  avgHeaderText:  { fontSize: 9, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.5 },
  avgTableRow:    { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border + '88' },
  avgTableCell:   { flex: 1, fontSize: 12, color: colors.greyLight, textAlign: 'center' },

  // Injury
  injuryCard: {
    backgroundColor: colors.red + '10', borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.red + '33',
  },
  injuryStatus: { fontSize: 15, fontWeight: '700', color: colors.red, marginBottom: 4 },
  injuryDesc:   { fontSize: 13, color: colors.greyLight, lineHeight: 20 },
  injuryReturn: { fontSize: 12, color: colors.grey, marginTop: spacing.xs },

  emptyNote: { fontSize: 13, color: colors.grey, textAlign: 'center', padding: spacing.md },
});
