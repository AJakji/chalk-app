import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Animated,
} from 'react-native';

import { colors, spacing, radius } from '../theme';
import ChalkyMascot from '../components/ChalkyMascot';
import ScoreCard from '../components/scores/ScoreCard';
import GameDetailModal from '../components/scores/GameDetailModal';
import ChalkyMenuButton from '../components/ChalkyMenuButton';
import ChalkyLogo from '../components/ChalkyLogo';
import { fetchTodaysScores } from '../services/api';

const LEAGUES = ['All', 'NBA', 'MLB', 'NHL', 'Soccer', 'WNBA'];

// Display-only labels — internal values stay the same so data filters still work
const LEAGUE_LABELS = { Soccer: 'World Cup' };

// ── Date helpers ──────────────────────────────────────────────────────────────
function toDateStr(date) {
  // 'YYYY-MM-DD' in local time
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildDateRange() {
  const today = new Date();
  const todayStr = toDateStr(today);
  const days = [];
  for (let offset = -1; offset <= 5; offset++) {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    const dateStr = toDateStr(d);
    let label;
    if (offset === -1)     label = 'Yesterday';
    else if (offset === 0) label = 'Today';
    else if (offset === 1) label = 'Tomorrow';
    else                   label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    days.push({ dateStr, label });
  }
  return { days, todayStr };
}

function StaggeredItem({ index, children }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start();
    }, index * 70);
    return () => clearTimeout(t);
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

export default function ScoresScreen() {
  const { days, todayStr } = useMemo(() => buildDateRange(), []);

  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeLeague, setActiveLeague] = useState('All');
  const [selectedGame, setSelectedGame] = useState(null);
  const [activeDate, setActiveDate] = useState(todayStr);

  const load = useCallback(async (dateStr) => {
    setLoading(true);
    setError(false);
    setGames([]);
    try {
      const data = await fetchTodaysScores(dateStr);
      setGames(data);
    } catch (err) {
      console.warn('Scores API unavailable:', err.message);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(activeDate); }, [activeDate]);

  const handleDateSelect = useCallback((dateStr) => {
    setActiveDate(dateStr);
  }, []);

  const filtered = useMemo(() => {
    if (activeLeague === 'All') return games;
    return games.filter((g) => g.league === activeLeague);
  }, [activeLeague, games]);

  const liveCount = games.filter((g) => g.status === 'live').length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <ChalkyMenuButton />
        <View style={styles.headerCenter}>
          <ChalkyLogo size={26} />
        </View>
        {liveCount > 0 ? (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveCount}>{liveCount} Live</Text>
          </View>
        ) : (
          <View style={{ width: 50 }} />
        )}
      </View>

      {/* League filter */}
      <View style={styles.leagueBarWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.leagueBar}
        >
          {LEAGUES.map((item) => (
            <TouchableOpacity
              key={item}
              style={[styles.leagueChip, activeLeague === item && styles.leagueChipActive]}
              onPress={() => setActiveLeague(item)}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.leagueChipText,
                  activeLeague === item && styles.leagueChipTextActive,
                ]}
              >
                {LEAGUE_LABELS[item] || item}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Date selector */}
      <View style={styles.dateBarWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dateBar}
        >
          {days.map((day) => {
            const isActive = day.dateStr === activeDate;
            return (
              <TouchableOpacity
                key={day.dateStr}
                style={[styles.dateChip, isActive && styles.dateChipActive]}
                onPress={() => handleDateSelect(day.dateStr)}
                activeOpacity={0.75}
              >
                <Text style={[styles.dateChipText, isActive && styles.dateChipTextActive]}>
                  {day.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* WNBA coming soon placeholder */}
      {activeLeague === 'WNBA' && (
        <View style={styles.wnbaPlaceholder}>
          <ChalkyMascot size={100} style={styles.wnbaAvatar} />
          <Text style={styles.wnbaTitle}>WNBA Coming Soon</Text>
          <Text style={styles.wnbaText}>
            The WNBA season tips off in May. Chalky will have full coverage of picks, scores, and player stats when the season begins.
          </Text>
        </View>
      )}

      {/* Initial loading spinner */}
      {activeLeague !== 'WNBA' && loading && games.length === 0 && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.green} />
          <Text style={styles.loadingText}>Loading scores...</Text>
        </View>
      )}

      {/* Live section label */}
      {activeLeague !== 'WNBA' && filtered.some((g) => g.status === 'live') && (
        <View style={styles.sectionHeader}>
          <View style={styles.sectionLiveDot} />
          <Text style={styles.sectionLabel}>Live Now</Text>
        </View>
      )}

      {/* Games list */}
      {activeLeague === 'WNBA' ? null : <FlatList
        style={{ flex: 1 }}
        data={filtered}
        keyExtractor={(item) => item.id}
        onRefresh={() => load(activeDate)}
        refreshing={loading}
        renderItem={({ item, index }) => {
          // Insert section headers
          const prevGame = filtered[index - 1];
          const showUpcomingHeader =
            item.status === 'upcoming' &&
            (!prevGame || prevGame.status !== 'upcoming');
          const showFinalHeader =
            item.status === 'final' &&
            (!prevGame || prevGame.status !== 'final');

          return (
            <StaggeredItem index={index}>
              <>
                {showUpcomingHeader && (
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionLabel}>Upcoming</Text>
                  </View>
                )}
                {showFinalHeader && (
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionLabel}>Final</Text>
                  </View>
                )}
                <ScoreCard game={item} onPress={setSelectedGame} />
              </>
            </StaggeredItem>
          );
        }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !loading && (
            <View style={styles.emptyState}>
              {error ? (
                <>
                  <Text style={styles.emptyIcon}>📡</Text>
                  <Text style={styles.emptyText}>Can't reach the server.</Text>
                  <TouchableOpacity style={styles.retryBtn} onPress={() => load(activeDate)}>
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.emptyIcon}>📭</Text>
                  <Text style={styles.emptyText}>
                    No {activeLeague === 'All' ? '' : `${LEAGUE_LABELS[activeLeague] || activeLeague} `}games{activeDate === todayStr ? ' today' : ` on ${days.find(d => d.dateStr === activeDate)?.label || activeDate}`}
                  </Text>
                </>
              )}
            </View>
          )
        }
      />}

      <GameDetailModal
        game={selectedGame}
        visible={!!selectedGame}
        onClose={() => setSelectedGame(null)}
      />
    </SafeAreaView>
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.offWhite,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 12,
    color: colors.grey,
    marginTop: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.red + '18',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.red + '44',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.red,
  },
  liveCount: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.red,
  },
  dateBarWrap: {
    height: 60,
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dateBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    gap: spacing.xs,
    alignItems: 'center',
  },
  dateChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  dateChipActive: {
    backgroundColor: colors.green + '22',
  },
  dateChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey,
  },
  dateChipTextActive: {
    color: colors.green,
    fontWeight: '700',
  },
  leagueBarWrap: {
    height: 52,
    overflow: 'hidden',
  },
  leagueBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
    alignItems: 'center',
  },
  leagueChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  leagueChipActive: {
    backgroundColor: colors.offWhite,
    borderColor: colors.offWhite,
  },
  leagueChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey,
  },
  leagueChipTextActive: {
    color: colors.background,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
    gap: spacing.xs,
  },
  sectionLiveDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.red,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    gap: spacing.md,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyText: {
    fontSize: 15,
    color: colors.grey,
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.green,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.background,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: 80,
  },
  loadingText: {
    fontSize: 14,
    color: colors.grey,
  },
  wnbaPlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl, gap: spacing.md,
  },
  wnbaAvatar:  { width: 100, height: 100, opacity: 0.85, marginBottom: spacing.md },
  wnbaTitle:   { fontSize: 16, fontWeight: '700', color: colors.offWhite, textAlign: 'center' },
  wnbaText:    { fontSize: 13, color: colors.grey, textAlign: 'center', lineHeight: 20 },
});
