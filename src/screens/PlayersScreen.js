import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView,
  StatusBar, TouchableOpacity, TextInput, Animated,
  RefreshControl, ScrollView, TouchableWithoutFeedback, Keyboard,
} from 'react-native';

import { colors, spacing, radius } from '../theme';
import ChalkyMascot from '../components/ChalkyMascot';
import { API_URL } from '../config';
import PlayerProfileModal from '../components/players/PlayerProfileModal';
import PlayerAvatar from '../components/players/PlayerAvatar';

// ── Data config ────────────────────────────────────────────────────────────────

const LEAGUE_TABS = ['NBA', 'MLB', 'NHL', 'Soccer', 'WNBA'];

// Display-only label for Soccer tab
const LEAGUE_TAB_LABELS = { Soccer: 'World Cup' };

const STAT_PILLS = {
  NBA:    ['PTS', 'REB', 'AST', '3PM', 'STL', 'BLK'],
  MLB:    ['AVG', 'HR', 'RBI', 'ERA', 'K'],
  NHL:    ['G', 'A', 'PTS'],
  Soccer: ['G', 'A', 'SOT', 'MIN'],
  WNBA:   [],
};

// Returns the correct display label for each sport + stat combination.
// NBA shows per-game averages (PTS/G). NHL/MLB/Soccer show season totals or rate stats.
const STAT_LABELS = {
  NBA:    { PTS: 'PTS/G', REB: 'REB/G', AST: 'AST/G', '3PM': '3PM/G', STL: 'STL/G', BLK: 'BLK/G' },
  NHL:    { G: 'Goals', A: 'Assists', PTS: 'Points', '+/-': '+/-', SOG: 'Shots' },
  MLB:    { AVG: 'AVG', HR: 'HR', RBI: 'RBI', ERA: 'ERA', K: 'K' },
  Soccer: { G: 'Goals', A: 'Assists', SOT: 'Shots on Target', MIN: 'Minutes' },
};

const getStatLabel = (league, stat) =>
  STAT_LABELS[league]?.[stat] ?? stat;

// ── Sub-components ─────────────────────────────────────────────────────────────

function StaggerRow({ index, children }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(-12)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity,     { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(translateX,  { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    }, index * 60);
    return () => clearTimeout(t);
  }, []);
  return <Animated.View style={{ opacity, transform: [{ translateX }] }}>{children}</Animated.View>;
}

function LeaderRow({ item, index, onPress }) {
  const isFirst = item.rank === 1;
  return (
    <StaggerRow index={index}>
      <TouchableOpacity style={styles.leaderRow} onPress={() => onPress(item)} activeOpacity={0.75}>
        <Text style={[styles.leaderRank, isFirst && styles.leaderRankFirst]}>
          {item.rank}
        </Text>
        <PlayerAvatar name={item.name} headshot={item.headshot} size={36} />
        <View style={styles.leaderInfo}>
          <View style={styles.leaderNameRow}>
            <Text style={styles.leaderName} numberOfLines={1}>{item.name}</Text>
            {item.playingTonight && <View style={styles.playingDot} />}
          </View>
          <Text style={styles.leaderTeam}>{item.team}</Text>
        </View>
        <View style={styles.leaderRight}>
          {item.injuryStatus && (
            <View style={styles.injuryBadge}>
              <Text style={styles.injuryBadgeText}>
                {item.injuryStatus === 'Out' ? 'OUT' : 'GTD'}
              </Text>
            </View>
          )}
          <Text style={[styles.leaderStat, isFirst && styles.leaderStatFirst]}>
            {item.value}
          </Text>
        </View>
      </TouchableOpacity>
    </StaggerRow>
  );
}

function SkeletonRow() {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={[styles.skeletonRow, { opacity }]}>
      <View style={styles.skeletonRank} />
      <View style={styles.skeletonAvatar} />
      <View style={styles.skeletonInfo}>
        <View style={styles.skeletonName} />
        <View style={styles.skeletonTeam} />
      </View>
      <View style={styles.skeletonStat} />
    </Animated.View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function PlayersScreen({ navigation }) {
  const [league, setLeague]               = useState('NBA');
  const [stat, setStat]                   = useState('PTS');
  const [leaders, setLeaders]             = useState([]);
  const [searchQ, setSearchQ]             = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loadingLeaders, setLoadingLeaders] = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [profilePlayer, setProfilePlayer] = useState(null);
  const searchFadeAnim = useRef(new Animated.Value(0)).current;

  // Reset stat pill when league changes
  useEffect(() => {
    if (league === 'WNBA') return;
    setStat((STAT_PILLS[league] || STAT_PILLS.NBA)[0]);
  }, [league]);

  const fetchLeaders = useCallback(async (selectedLeague, selectedStat) => {
    setLoadingLeaders(true);
    try {
      const res = await fetch(`${API_URL}/api/players/leaders?league=${selectedLeague}&stat=${selectedStat}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const data = body.leaders || [];
      setLeaders(data);
      if (!data.length) {
        setTimeout(() => fetchLeaders(selectedLeague, selectedStat), 30000);
      }
    } catch {
      setLeaders([]);
    } finally {
      setLoadingLeaders(false);
    }
  }, []);

  useEffect(() => {
    if (league === 'WNBA') return;
    fetchLeaders(league, stat);
  }, [league, stat]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLeaders(league, stat);
    setRefreshing(false);
  }, [league, stat]);

  // Debounced search
  useEffect(() => {
    if (!searchQ.trim()) {
      setSearchResults([]);
      Animated.timing(searchFadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/players/search?q=${encodeURIComponent(searchQ)}&league=${league}`);
        const { players } = await res.json();
        setSearchResults(players || []);
        Animated.timing(searchFadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQ, league]);

  const dismissSearch = () => {
    setSearchQ('');
    setSearchResults([]);
    Keyboard.dismiss();
    Animated.timing(searchFadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
  };

  const openProfile = (item) => {
    setProfilePlayer({
      id:     item.playerId != null ? String(item.playerId) : (item.id || item.name?.toLowerCase().replace(/\s+/g, '-')),
      name:   item.name,
      league: item.league || (league !== 'All' ? league : 'NBA'),
    });
  };

  const handleAskChalky = (message) => {
    navigation?.navigate('Research', { prefillMessage: message });
  };

  const pills = STAT_PILLS[league] || STAT_PILLS.NBA;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Players</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search any player across all leagues..."
            placeholderTextColor={colors.grey}
            value={searchQ}
            onChangeText={setSearchQ}
            returnKeyType="search"
          />
          {searchQ.length > 0 && (
            <TouchableOpacity onPress={dismissSearch} style={styles.clearBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tap-outside overlay + search results dropdown */}
      {searchResults.length > 0 && (
        <>
          <TouchableWithoutFeedback onPress={dismissSearch}>
            <View style={styles.searchOverlay} />
          </TouchableWithoutFeedback>
          <Animated.View style={[styles.searchDropdown, { opacity: searchFadeAnim }]}>
            {searchResults.map((p, i) => (
              <TouchableOpacity
                key={i}
                style={styles.searchResultRow}
                onPress={() => { dismissSearch(); openProfile(p); }}
                activeOpacity={0.75}
              >
                <PlayerAvatar name={p.name} headshot={p.headshot} size={28} />
                <View style={{ marginLeft: spacing.sm }}>
                  <Text style={styles.searchResultName}>{p.name}</Text>
                  <Text style={styles.searchResultMeta}>{p.team} · {p.position} · {p.league}</Text>
                </View>
                {(p.injuryStatus === 'Out' || p.injuryStatus === 'Day-To-Day' || p.injuryStatus === 'Questionable') && (
                  <View style={[styles.injuryBadge, { marginLeft: 'auto' }]}>
                    <Text style={styles.injuryBadgeText}>{p.injuryStatus === 'Out' ? 'OUT' : 'GTD'}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </Animated.View>
        </>
      )}

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
      >
        {/* League tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.leagueScroll} contentContainerStyle={styles.leagueBar}>
          {LEAGUE_TABS.map(l => (
            <TouchableOpacity
              key={l}
              style={[styles.leagueChip, league === l && styles.leagueChipActive]}
              onPress={() => setLeague(l)}
              activeOpacity={0.75}
            >
              <Text style={[styles.leagueChipText, league === l && styles.leagueChipTextActive]}>{LEAGUE_TAB_LABELS[l] || l}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Stat pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillScroll} contentContainerStyle={styles.pillBar}>
          {pills.map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.pill, stat === p && styles.pillActive]}
              onPress={() => setStat(p)}
              activeOpacity={0.75}
            >
              <Text style={[styles.pillText, stat === p && styles.pillTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* WNBA coming soon placeholder */}
        {league === 'WNBA' ? (
          <View style={styles.wnbaPlaceholder}>
            <ChalkyMascot size={200} style={styles.wnbaAvatar} />
            <Text style={styles.wnbaTitle}>WNBA Coming Soon</Text>
            <Text style={styles.wnbaText}>
              The WNBA season tips off in May. Chalky will have full coverage of picks, scores, and player stats when the season begins.
            </Text>
          </View>
        ) : (
          <>
            {/* League leaders */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>League Leaders</Text>
              <Text style={styles.sectionStat}>{getStatLabel(league, stat)}</Text>
            </View>

            <View style={styles.leadersList}>
              {loadingLeaders ? (
                [0,1,2,3,4].map(i => <SkeletonRow key={i} />)
              ) : leaders.length === 0 ? (
                <View style={styles.emptyLeaders}>
                  <Text style={styles.emptyLeadersTitle}>Stats are loading.</Text>
                  <Text style={styles.emptyLeadersNote}>Check back in a moment.</Text>
                </View>
              ) : (
                leaders.map((item, i) => (
                  <LeaderRow key={i} item={item} index={i} onPress={openProfile} />
                ))
              )}
            </View>
          </>
        )}

        <View style={{ height: 48 }} />
      </ScrollView>

      <PlayerProfileModal
        visible={!!profilePlayer}
        playerId={profilePlayer?.id}
        playerName={profilePlayer?.name}
        playerLeague={profilePlayer?.league || 'NBA'}
        onClose={() => setProfilePlayer(null)}
        onAskChalky={handleAskChalky}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea:   { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs,
    flexDirection: 'row', alignItems: 'center',
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.offWhite },
  // Search
  searchRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingHorizontal: spacing.sm, gap: spacing.xs,
    borderWidth: 1, borderColor: colors.border, height: 40,
  },
  searchIcon:  { fontSize: 14 },
  searchInput: { flex: 1, color: colors.offWhite, fontSize: 13 },
  searchOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 50, backgroundColor: 'transparent',
  },
  searchDropdown: {
    position: 'absolute', top: 96, left: spacing.md, right: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md, zIndex: 100,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  clearBtn:     { paddingHorizontal: 4 },
  clearBtnText: { color: colors.grey, fontSize: 14, fontWeight: '600' },
  searchResultRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border + '66',
  },
  searchResultName: { fontSize: 13, fontWeight: '600', color: colors.offWhite },
  searchResultMeta: { fontSize: 11, color: colors.grey, marginTop: 1 },
  // League tabs
  leagueScroll: { height: 44, flexGrow: 0 },
  leagueBar:    { paddingHorizontal: spacing.md, alignItems: 'center', gap: spacing.xs },
  leagueChip: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  leagueChipActive:     { backgroundColor: colors.offWhite, borderColor: colors.offWhite },
  leagueChipText:       { fontSize: 13, fontWeight: '600', color: colors.grey },
  leagueChipTextActive: { color: colors.background },
  // Stat pills
  pillScroll: { height: 40, flexGrow: 0 },
  pillBar:    { paddingHorizontal: spacing.md, alignItems: 'center', gap: spacing.xs },
  pill: {
    paddingHorizontal: spacing.sm + 4, paddingVertical: 5,
    borderRadius: radius.full, backgroundColor: 'transparent',
    borderWidth: 1, borderColor: colors.border,
  },
  pillActive:     { backgroundColor: colors.green + '22', borderColor: colors.green },
  pillText:       { fontSize: 12, fontWeight: '600', color: colors.grey },
  pillTextActive: { color: colors.green },
  // Section header
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionStat:  { fontSize: 11, color: colors.grey },
  // Leaders list
  leadersList: {
    marginHorizontal: spacing.md, backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border + '66', gap: spacing.sm,
  },
  leaderRank:      { fontSize: 14, fontWeight: '700', color: colors.grey, width: 20, textAlign: 'center' },
  leaderRankFirst: { color: colors.green },
  leaderInfo:      { flex: 1 },
  leaderNameRow:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  leaderName:      { fontSize: 14, fontWeight: '600', color: colors.offWhite },
  leaderTeam:      { fontSize: 11, color: colors.grey, marginTop: 1 },
  playingDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  leaderRight:     { alignItems: 'flex-end', gap: 3 },
  leaderStat:      { fontSize: 18, fontWeight: '800', color: colors.offWhite },
  leaderStatFirst: { color: colors.green },
  injuryBadge: {
    backgroundColor: colors.red + '18', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: colors.red + '44',
  },
  injuryBadgeText: { fontSize: 9, fontWeight: '700', color: colors.red },
  // Skeleton
  skeletonRow:   { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  skeletonRank:  { width: 20, height: 16, backgroundColor: colors.border, borderRadius: 4 },
  skeletonAvatar:{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border },
  skeletonInfo:  { flex: 1, gap: 6 },
  skeletonName:  { height: 12, width: '60%', backgroundColor: colors.border, borderRadius: 4 },
  skeletonTeam:  { height: 10, width: '35%', backgroundColor: colors.border + '88', borderRadius: 4 },
  skeletonStat:  { width: 36, height: 24, backgroundColor: colors.border, borderRadius: 4 },
  scroll:        { flex: 1 },
  emptyLeaders:  { padding: spacing.lg, alignItems: 'center' },
  emptyLeadersTitle: { fontSize: 14, fontWeight: '700', color: colors.offWhite, marginBottom: 4 },
  emptyLeadersNote:  { fontSize: 12, color: colors.grey },
  wnbaPlaceholder: {
    alignItems: 'center', paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl, paddingBottom: spacing.lg, gap: spacing.md,
  },
  wnbaAvatar:  { width: 100, height: 100, opacity: 0.85, marginBottom: spacing.md },
  wnbaTitle:   { fontSize: 16, fontWeight: '700', color: colors.offWhite, textAlign: 'center' },
  wnbaText:    { fontSize: 13, color: colors.grey, textAlign: 'center', lineHeight: 20 },
});
