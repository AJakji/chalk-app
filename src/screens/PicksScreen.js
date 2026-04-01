import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, ScrollView, StyleSheet,
  SafeAreaView, StatusBar, ActivityIndicator, TouchableOpacity, Animated,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing, radius } from '../theme';
import ChalkyFace from '../components/ChalkyFace';
import ChalkyMascot from '../components/ChalkyMascot';
import PickCard from '../components/picks/PickCard';
import PropPickCard from '../components/picks/PropPickCard';
import PickDetailModal from '../components/picks/PickDetailModal';
import PropDetailModal from '../components/picks/PropDetailModal';
import ChalkyMenuButton from '../components/ChalkyMenuButton';
import ChalkyLogo from '../components/ChalkyLogo';
import { fetchPicksForTab, fetchPickCounts } from '../services/api';
import { useProStatus } from '../hooks/useProStatus';
import { usePaywall } from '../context/PaywallContext';
import PicksInfoButtons from '../components/PicksInfoButtons';
import { isBeforePicksTime, getPicksCountdown, getPicksReleaseTime } from '../utils/timeUtils';

const TABS = ["Chalky's Picks", 'NBA', 'MLB', 'NHL', 'Soccer', 'WNBA'];

// Display-only labels — internal values stay the same so data filters still work
const TAB_LABELS = { Soccer: 'World Cup' };

// All picks are locked for non-Pro users on every tab.


function LockedPickWrapper({ children, onUnlock }) {
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onUnlock} style={locked.container}>
      <View style={locked.inner} pointerEvents="none">
        {children}
      </View>
      <BlurView intensity={18} tint="dark" style={locked.blur} />
      <View style={locked.overlay}>
        <View style={locked.lockBadge}>
          <Ionicons name="lock-closed" size={16} color="#FFD700" />
          <Text style={locked.lockText}>Pro Pick</Text>
        </View>
        <Text style={locked.lockSub}>Unlock with Chalky Pro</Text>
      </View>
    </TouchableOpacity>
  );
}

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
function ChalkysPicksHeader({ date }) {
  return (
    <View style={styles.chalkysHeader}>
      <View style={styles.chalkysAvatarRow}>
        <ChalkyFace size={40} style={styles.chalkysAvatar} />
        <View style={styles.chalkysHeaderText}>
          <Text style={styles.chalkysTitle}>Today's Best 7</Text>
          <Text style={styles.chalkysDate}>{date}</Text>
        </View>
      </View>
      <Text style={styles.chalkysSubtext}>
        Chalky's highest confidence picks across all leagues and props today
      </Text>
      <PicksInfoButtons />
    </View>
  );
}

export default function PicksScreen() {
  const [picks, setPicks]         = useState([]);
  const [counts, setCounts]       = useState({});
  const [loading, setLoading]     = useState(!isBeforePicksTime()); // only spin if past 7 AM
  const [error, setError]         = useState(false);
  const [countdown, setCountdown] = useState(getPicksCountdown());
  const [selectedPick, setSelectedPick] = useState(null);
  const [activeTab, setActiveTab] = useState("Chalky's Picks");
  const { isPro } = useProStatus();
  const { openPaywall } = usePaywall();

  // Ref so the countdown timer always sees the current tab
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Fetch picks for the active tab
  const loadPicks = useCallback(async (tab) => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchPicksForTab(tab);
      setPicks(data);
    } catch (err) {
      console.warn('Picks API unavailable:', err.message);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch count badges — only after 7 AM ET
  useEffect(() => {
    if (isBeforePicksTime()) return;
    fetchPickCounts().then(setCounts).catch(() => {});
  }, []);

  // Fetch picks on tab change — skip before 7 AM (countdown handles the initial fetch)
  useEffect(() => {
    if (isBeforePicksTime()) return;
    loadPicks(activeTab);
  }, [activeTab, loadPicks]);

  // Countdown timer — ticks every second before 7 AM ET.
  // When it hits 7 AM it clears itself, fetches picks, and updates count badges.
  useEffect(() => {
    if (!isBeforePicksTime()) return; // already past 7 AM on mount, tab effect handles it

    const timer = setInterval(() => {
      if (!isBeforePicksTime()) {
        clearInterval(timer);
        loadPicks(activeTabRef.current);
        fetchPickCounts().then(setCounts).catch(() => {});
      } else {
        setCountdown(getPicksCountdown());
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Picks are already sorted by confidence from the backend — use as-is
  const displayedPicks = picks;

  // Top pick is always index 0 in the current view
  const topPickId = picks.length > 0 ? picks[0].id : null;

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
          const isActive  = activeTab === tab;
          const isChalky  = tab === "Chalky's Picks";
          const countKey  = isChalky ? 'CHALKY' : tab;
          const count     = counts[countKey];
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
                <ChalkyFace size={32} style={styles.tabChalkyAvatar} />
              )}
              <Text style={[
                styles.tabText,
                isActive && (isChalky ? styles.tabTextActiveChalky : styles.tabTextActive),
              ]}>
                {TAB_LABELS[tab] || tab}
              </Text>
              {count != null && count > 0 && (
                <Text style={[styles.tabCount, isActive && styles.tabCountActive]}>
                  {count}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      {activeTab === 'WNBA' ? (
        <View style={styles.centered}>
          <ChalkyMascot size={200} style={styles.emptyImage} />
          <Text style={styles.emptyTitle}>WNBA Coming Soon</Text>
          <Text style={styles.emptyText}>
            The WNBA season tips off in May. Chalky will have full coverage of picks, scores, and player stats when the season begins.
          </Text>
        </View>
      ) : isBeforePicksTime() ? (
        // ── Waiting screen: shown before 7 AM ET regardless of DB state ──────
        <View style={styles.centered}>
          <ChalkyMascot size={200} style={styles.emptyImage} />
          <Text style={styles.emptyTitle}>Picks drop at {getPicksReleaseTime()}</Text>
          <Text style={styles.countdownText}>{countdown}</Text>
          <Text style={styles.emptyText}>
            Follow @chalkyapp on Instagram for free daily picks.{'\n'}
            Pro unlocks everything inside the app.
          </Text>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.green} />
          <Text style={styles.loadingText}>Chalky is studying the lines...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <ChalkyMascot size={200} style={styles.emptyImage} />
          <Text style={styles.emptyTitle}>Can't reach the server.</Text>
          <Text style={styles.emptyText}>Check your connection and try again.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => loadPicks(activeTab)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : picks.length === 0 ? (
        // ── After 7 AM with no picks = pipeline issue, not waiting ───────────
        <View style={styles.centered}>
          <ChalkyMascot size={200} style={styles.emptyImage} />
          <Text style={styles.emptyTitle}>No picks yet today.</Text>
          <Text style={styles.emptyText}>Chalky's still working on it. Check back shortly.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => loadPicks(activeTab)}>
            <Text style={styles.retryText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={displayedPicks}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            activeTab === "Chalky's Picks" ? (
              <ChalkysPicksHeader date={today} />
            ) : null
          }
          renderItem={({ item, index }) => {
            const isLocked = !isPro;
            const card = item.pickCategory === 'prop' ? (
              <PropPickCard
                pick={item}
                onPress={isLocked ? openPaywall : setSelectedPick}
                isTopPick={item.id === topPickId}
                isLocked={isLocked}
                onLockedPress={openPaywall}
              />
            ) : (
              <PickCard
                pick={item}
                onPress={isLocked ? openPaywall : setSelectedPick}
                isTopPick={item.id === topPickId}
                isLocked={isLocked}
                onLockedPress={openPaywall}
              />
            );
            return (
              <StaggeredItem index={index}>
                <View>
                  <Text style={styles.pickRank}>#{index + 1}</Text>
                  {card}
                </View>
              </StaggeredItem>
            );
          }}
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
    paddingLeft: 6,
    paddingRight: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 3,
  },
  tabActive: {
    backgroundColor: colors.offWhite,
    borderColor: colors.offWhite,
  },
  tabActiveChalky: {
    backgroundColor: colors.green + '22',
    borderColor: colors.green,
  },
  tabChalkyAvatar: { width: 32, height: 32, borderRadius: 16, marginVertical: -5 },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.grey },
  tabTextActive: { color: colors.background },
  tabTextActiveChalky: { color: colors.green },
  tabCount: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.grey,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  tabCountActive: { color: colors.offWhite },
  pickRank: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.grey,
    letterSpacing: 0.5,
    marginBottom: 4,
    marginLeft: 2,
  },
  // Chalky's Picks header card
  chalkysHeader: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.green + '33',
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
  },
  chalkysAvatarRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs,
  },
  chalkysAvatar: { width: 40, height: 40, borderRadius: 20 },
  chalkysHeaderText: { flex: 1 },
  chalkysTitle: { fontSize: 15, fontWeight: '800', color: colors.offWhite },
  chalkysDate: { fontSize: 11, color: colors.grey, marginTop: 1 },
  chalkysSubtext: {
    fontSize: 12, color: colors.grey, lineHeight: 17, marginBottom: spacing.sm,
  },
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
  countdownText: { fontSize: 36, fontWeight: '800', color: colors.green, letterSpacing: 2, fontVariant: ['tabular-nums'], marginVertical: 4 },
  emptyText: { fontSize: 13, color: colors.grey, textAlign: 'center', marginTop: 4, lineHeight: 20 },
  retryBtn: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, backgroundColor: colors.green },
  retryText: { fontSize: 14, fontWeight: '700', color: colors.background },
});

const locked = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 0,
  },
  inner: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  blur: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#FFD70055',
  },
  lockText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFD700',
    letterSpacing: 0.5,
  },
  lockSub: {
    fontSize: 12,
    color: colors.grey,
    fontWeight: '500',
  },
});
