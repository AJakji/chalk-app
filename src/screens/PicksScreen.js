import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, Image, FlatList, ScrollView, StyleSheet,
  SafeAreaView, StatusBar, ActivityIndicator, TouchableOpacity, Animated,
} from 'react-native';

const CHALKY_PNG = require('../../assets/chalky.png');
import { colors, spacing, radius } from '../theme';
import PickCard from '../components/picks/PickCard';
import PropPickCard from '../components/picks/PropPickCard';
import PickDetailModal from '../components/picks/PickDetailModal';
import PropDetailModal from '../components/picks/PropDetailModal';
import ChalkyMenuButton from '../components/ChalkyMenuButton';
import ChalkyLogo from '../components/ChalkyLogo';
import { fetchTodaysPicks } from '../services/api';

const TABS = ["Chalky's Picks", 'NBA', 'MLB', 'NHL', 'Soccer', 'WNBA'];

// Display-only labels — internal values stay the same so data filters still work
const TAB_LABELS = { Soccer: 'World Cup' };

// Staggered card entrance animation
function StaggeredItem({ index, children }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }, index * 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

// Header for the Chalky's Picks tab
function ChalkysPicksHeader({ date, totalCount, highConfCount }) {
  return (
    <View style={styles.chalkysHeader}>
      <View style={styles.chalkysAvatarRow}>
        <Image source={CHALKY_PNG} style={styles.chalkysAvatar} resizeMode="contain" />
        <View style={styles.chalkysHeaderText}>
          <Text style={styles.chalkysTitle}>Today's Best 5</Text>
          <Text style={styles.chalkysDate}>{date}</Text>
        </View>
      </View>
      <Text style={styles.chalkysSubtext}>
        Chalky's highest confidence picks across all leagues and props today
      </Text>
      <View style={styles.chalkysStats}>
        <View style={styles.chalkysStatItem}>
          <Text style={styles.chalkysStatNum}>{totalCount}</Text>
          <Text style={styles.chalkysStatLabel}>Picks Today</Text>
        </View>
        <View style={styles.chalkysStatDivider} />
        <View style={styles.chalkysStatItem}>
          <Text style={[styles.chalkysStatNum, { color: colors.green }]}>{highConfCount}</Text>
          <Text style={styles.chalkysStatLabel}>High Confidence</Text>
        </View>
      </View>
    </View>
  );
}

export default function PicksScreen() {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedPick, setSelectedPick] = useState(null);
  const [activeTab, setActiveTab] = useState("Chalky's Picks");

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const loadPicks = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchTodaysPicks();
      setPicks(data);
    } catch (err) {
      console.warn('Picks API unavailable:', err.message);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPicks(); }, [loadPicks]);

  // Filtered picks based on active tab
  const displayedPicks = useMemo(() => {
    const sorted = [...picks].sort((a, b) => b.confidence - a.confidence);
    if (activeTab === "Chalky's Picks") return sorted.slice(0, 5);
    return sorted.filter(p => p.league === activeTab);
  }, [picks, activeTab]);

  const topPickId = picks.length > 0
    ? picks.reduce((best, p) => p.confidence > best.confidence ? p : best, picks[0]).id
    : null;

  const highConfCount = picks.filter(p => p.confidence >= 80).length;

  // Separate selected prop vs game pick for the right modal
  const selectedGamePick = selectedPick?.pickCategory !== 'prop' ? selectedPick : null;
  const selectedPropPick = selectedPick?.pickCategory === 'prop' ? selectedPick : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <ChalkyMenuButton />
        <View style={styles.headerCenter}>
          <ChalkyLogo size={26} />
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      </View>

      {/* Tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabBar}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab;
          const isChalky = tab === "Chalky's Picks";
          return (
            <TouchableOpacity
              key={tab}
              style={[
                styles.tab,
                isActive && (isChalky ? styles.tabActiveChalky : styles.tabActive),
              ]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.75}
            >
              {isChalky && (
                <Image source={CHALKY_PNG} style={styles.tabChalkyAvatar} resizeMode="contain" />
              )}
              <Text style={[
                styles.tabText,
                isActive && (isChalky ? styles.tabTextActiveChalky : styles.tabTextActive),
              ]}>
                {TAB_LABELS[tab] || tab}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      {activeTab === 'WNBA' ? (
        <View style={styles.centered}>
          <Image source={CHALKY_PNG} style={styles.emptyImage} resizeMode="contain" />
          <Text style={styles.emptyTitle}>WNBA Coming Soon</Text>
          <Text style={styles.emptyText}>
            The WNBA season tips off in May. Chalky will have full coverage of picks, scores, and player stats when the season begins.
          </Text>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.green} />
          <Text style={styles.loadingText}>Chalky is studying the lines...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Image source={CHALKY_PNG} style={styles.emptyImage} resizeMode="contain" />
          <Text style={styles.emptyTitle}>Can't reach the server.</Text>
          <Text style={styles.emptyText}>Check your connection and try again.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadPicks}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={displayedPicks}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            activeTab === "Chalky's Picks" ? (
              <ChalkysPicksHeader
                date={today}
                totalCount={picks.length}
                highConfCount={highConfCount}
              />
            ) : null
          }
          renderItem={({ item, index }) => (
            <StaggeredItem index={index}>
              {item.pickCategory === 'prop' ? (
                <PropPickCard
                  pick={item}
                  onPress={setSelectedPick}
                  isTopPick={item.id === topPickId}
                />
              ) : (
                <PickCard
                  pick={item}
                  onPress={setSelectedPick}
                  isTopPick={item.id === topPickId}
                />
              )}
            </StaggeredItem>
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Image source={CHALKY_PNG} style={styles.emptyImage} resizeMode="contain" />
              <Text style={styles.emptyTitle}>
                {activeTab === "Chalky's Picks"
                  ? new Date().getHours() < 11
                    ? 'Analyzing today\'s slate.'
                    : 'No picks today.'
                  : `No ${TAB_LABELS[activeTab] || activeTab} picks today.`}
              </Text>
              <Text style={styles.emptyText}>
                {activeTab === "Chalky's Picks" && new Date().getHours() < 11
                  ? 'Check back after 11am ET.'
                  : 'Day off.'}
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Game pick detail modal */}
      <PickDetailModal
        pick={selectedGamePick}
        visible={!!selectedGamePick}
        onClose={() => setSelectedPick(null)}
      />

      {/* Prop pick detail modal */}
      <PropDetailModal
        pick={selectedPropPick}
        visible={!!selectedPropPick}
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.green + '18', borderRadius: radius.full,
    paddingHorizontal: 10, paddingVertical: 4, gap: 5,
    borderWidth: 1, borderColor: colors.green + '33',
  },
  liveDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: colors.green },
  liveText: { fontSize: 11, fontWeight: '600', color: colors.green },
  // Tab bar
  tabScroll: { height: 52, flexGrow: 0 },
  tabBar: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
    alignItems: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 5,
  },
  tabActive: {
    backgroundColor: colors.offWhite,
    borderColor: colors.offWhite,
  },
  tabActiveChalky: {
    backgroundColor: colors.green + '22',
    borderColor: colors.green,
  },
  tabChalkyAvatar: { width: 16, height: 16, borderRadius: 8 },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.grey },
  tabTextActive: { color: colors.background },
  tabTextActiveChalky: { color: colors.green },
  // Chalky's Picks header card
  chalkysHeader: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.green + '33',
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
  },
  chalkysAvatarRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm,
  },
  chalkysAvatar: { width: 44, height: 44, borderRadius: 22 },
  chalkysHeaderText: { flex: 1 },
  chalkysTitle: { fontSize: 18, fontWeight: '800', color: colors.offWhite },
  chalkysDate: { fontSize: 12, color: colors.grey, marginTop: 1 },
  chalkysSubtext: {
    fontSize: 13, color: colors.grey, lineHeight: 18, marginBottom: spacing.md,
  },
  chalkysStats: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chalkysStatItem: { flex: 1, alignItems: 'center' },
  chalkysStatNum: { fontSize: 18, fontWeight: '800', color: colors.offWhite },
  chalkysStatLabel: { fontSize: 9, color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1, textAlign: 'center' },
  chalkysStatDivider: { width: 1, backgroundColor: colors.border },
  // List
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    paddingTop: spacing.sm,
    flexGrow: 1,
  },
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl,
  },
  loadingText: { fontSize: 14, color: colors.grey, marginTop: spacing.sm },
  emptyImage: { width: 100, height: 100, opacity: 0.85, marginBottom: spacing.md },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.offWhite, textAlign: 'center' },
  emptyText: { fontSize: 13, color: colors.grey, textAlign: 'center', marginTop: 4 },
  retryBtn: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, backgroundColor: colors.green },
  retryText: { fontSize: 14, fontWeight: '700', color: colors.background },
});
