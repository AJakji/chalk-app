import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { colors, spacing, radius } from '../theme';
import ScoreCard from '../components/scores/ScoreCard';
import GameDetailModal from '../components/scores/GameDetailModal';
import { mockGames, LEAGUES } from '../data/mockScores';

export default function ScoresScreen() {
  const [activeLeague, setActiveLeague] = useState('All');
  const [selectedGame, setSelectedGame] = useState(null);

  const filtered = useMemo(() => {
    if (activeLeague === 'All') return mockGames;
    return mockGames.filter((g) => g.league === activeLeague);
  }, [activeLeague]);

  const liveCount = mockGames.filter((g) => g.status === 'live').length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Scores</Text>
          <Text style={styles.subtitle}>
            {liveCount > 0 ? `${liveCount} games live now` : 'No games currently live'}
          </Text>
        </View>
        {liveCount > 0 && (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveCount}>{liveCount} Live</Text>
          </View>
        )}
      </View>

      {/* League filter */}
      <FlatList
        horizontal
        data={LEAGUES}
        keyExtractor={(item) => item}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.leagueBar}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.leagueChip,
              activeLeague === item && styles.leagueChipActive,
            ]}
            onPress={() => setActiveLeague(item)}
            activeOpacity={0.75}
          >
            <Text
              style={[
                styles.leagueChipText,
                activeLeague === item && styles.leagueChipTextActive,
              ]}
            >
              {item}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Live section label */}
      {filtered.some((g) => g.status === 'live') && (
        <View style={styles.sectionHeader}>
          <View style={styles.sectionLiveDot} />
          <Text style={styles.sectionLabel}>Live Now</Text>
        </View>
      )}

      {/* Games list */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
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
          );
        }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>No {activeLeague} games today</Text>
          </View>
        }
      />

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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
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
  leagueBar: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
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
});
