import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { colors, spacing } from '../theme';
import PickCard from '../components/picks/PickCard';
import PickDetailModal from '../components/picks/PickDetailModal';
import { fetchTodaysPicks } from '../services/api';

export default function PicksScreen() {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPick, setSelectedPick] = useState(null);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const loadPicks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTodaysPicks();
      setPicks(data);
    } catch (err) {
      console.error('Failed to load picks:', err);
      setError('Could not load picks. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPicks();
  }, [loadPicks]);

  const topPickId = picks.length > 0
    ? picks.reduce((best, p) => (p.confidence > best.confidence ? p : best), picks[0]).id
    : null;

  const wins = picks.filter((p) => p.result === 'win').length;
  const settled = picks.filter((p) => p.result !== null).length;
  const winRate = settled > 0 ? Math.round((wins / settled) * 100) : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>Chalk</Text>
          <Text style={styles.tagline}>AI picks. No noise.</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>AI picks live</Text>
          </View>
        </View>
      </View>

      {/* Date strip */}
      <View style={styles.dateBanner}>
        <Text style={styles.dateLabel}>Today's Picks</Text>
        <Text style={styles.dateText}>{today}</Text>
      </View>

      {/* Stats row */}
      <View style={styles.recordRow}>
        <View style={styles.recordItem}>
          <Text style={styles.recordNum}>{loading ? '—' : picks.length}</Text>
          <Text style={styles.recordLabel}>Picks Today</Text>
        </View>
        <View style={styles.recordDivider} />
        <View style={styles.recordItem}>
          <Text style={[styles.recordNum, winRate !== null && { color: colors.green }]}>
            {winRate !== null ? `${winRate}%` : '—'}
          </Text>
          <Text style={styles.recordLabel}>Today Win Rate</Text>
        </View>
        <View style={styles.recordDivider} />
        <View style={styles.recordItem}>
          <Text style={[styles.recordNum, { color: colors.green }]}>
            {loading ? '—' : picks.filter((p) => p.confidence >= 80).length}
          </Text>
          <Text style={styles.recordLabel}>High Confidence</Text>
        </View>
      </View>

      {/* Pick list / loading / error */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.green} />
          <Text style={styles.loadingText}>Generating AI picks...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorIcon}>⚡</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadPicks} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={picks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PickCard pick={item} onPress={setSelectedPick} isTopPick={item.id === topPickId} />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Detail modal */}
      <PickDetailModal
        pick={selectedPick}
        visible={!!selectedPick}
        onClose={() => setSelectedPick(null)}
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
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  appName: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.offWhite,
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 11,
    color: colors.grey,
    letterSpacing: 0.2,
  },
  headerRight: { alignItems: 'flex-end' },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.green + '18',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 5,
    borderWidth: 1,
    borderColor: colors.green + '33',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.green,
  },
  liveText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.green,
  },
  dateBanner: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  dateLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  dateText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.offWhite,
    marginTop: 1,
    letterSpacing: -0.2,
  },
  recordRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    borderRadius: 12,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordItem: { flex: 1, alignItems: 'center' },
  recordNum: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.offWhite,
  },
  recordLabel: {
    fontSize: 9,
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 1,
    textAlign: 'center',
  },
  recordDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  loadingText: {
    fontSize: 14,
    color: colors.grey,
    marginTop: spacing.sm,
  },
  errorIcon: { fontSize: 36 },
  errorText: {
    fontSize: 14,
    color: colors.grey,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    backgroundColor: colors.green,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    marginTop: spacing.sm,
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.background,
  },
});
