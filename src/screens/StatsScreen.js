import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  TouchableOpacity, TextInput, Animated, ScrollView,
  FlatList, RefreshControl, ActivityIndicator,
  TouchableWithoutFeedback, Keyboard, Modal,
} from 'react-native';

import { colors, spacing, radius } from '../theme';
import { API_URL } from '../config';
import PlayerProfileModal from '../components/players/PlayerProfileModal';
import PlayerAvatar from '../components/players/PlayerAvatar';

// ── Constants ──────────────────────────────────────────────────────────────────

const SECTIONS   = ['Players', 'Teams', 'Leaders'];
const SPORTS     = ['NBA', 'NHL', 'MLB'];

const STAT_PILLS = {
  NBA: ['PTS', 'REB', 'AST', 'BLK', 'STL', '3PM'],
  NHL: ['Goals', 'Assists', 'Points', 'Shots'],
  MLB: ['HR', 'RBI', 'AVG', 'H', 'K', 'ERA'],
};

const STAT_API_KEYS = {
  NBA: { PTS: 'PTS', REB: 'REB', AST: 'AST', BLK: 'BLK', STL: 'STL', '3PM': '3PM' },
  NHL: { Goals: 'G', Assists: 'A', Points: 'PTS', Shots: 'SOG' },
  MLB: { HR: 'HR', RBI: 'RBI', AVG: 'AVG', H: 'H', K: 'K', ERA: 'ERA' },
};

const TEAM_DETAIL_TABS = ['Overview', 'Roster', 'Schedule', 'Injuries'];

const INJURY_COLOR = {
  Out:          '#FF4444',
  Doubtful:     '#FF8C00',
  Questionable: '#FFD700',
  Probable:     '#00E87A',
  'Day-to-day': '#FFD700',
  GTD:          '#FFD700',
};

// ── Shared micro-components ────────────────────────────────────────────────────

function SportSwitcher({ sport, setSport }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.sportScroll} contentContainerStyle={s.sportBar}>
      {SPORTS.map(sp => (
        <TouchableOpacity
          key={sp}
          style={[s.sportChip, sport === sp && s.sportChipActive]}
          onPress={() => setSport(sp)}
          activeOpacity={0.75}
        >
          <Text style={[s.sportChipText, sport === sp && s.sportChipTextActive]}>{sp}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
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
    <Animated.View style={[s.skeletonRow, { opacity }]}>
      <View style={s.skeletonRank} />
      <View style={s.skeletonAvatar} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={s.skeletonName} />
        <View style={s.skeletonTeam} />
      </View>
      <View style={s.skeletonStat} />
    </Animated.View>
  );
}

function ResultDot({ result }) {
  const isWin  = result === 'W';
  const isLoss = result === 'L';
  return (
    <View style={[s.dot, isWin && s.dotWin, isLoss && s.dotLoss, !isWin && !isLoss && s.dotOT]} />
  );
}

// ── SECTION 1: PLAYERS ────────────────────────────────────────────────────────

function PlayersSection({ onOpenProfile }) {
  const [sport, setSport]     = useState('NBA');
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Reset results on sport change
  useEffect(() => {
    setQuery('');
    setResults([]);
    Animated.timing(fadeAnim, { toValue: 0, duration: 100, useNativeDriver: true }).start();
  }, [sport]);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/players/search?q=${encodeURIComponent(query)}&league=${sport}`
        );
        const { players } = await res.json();
        setResults(players || []);
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, sport]);

  const dismiss = () => {
    setQuery('');
    setResults([]);
    Keyboard.dismiss();
    Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
  };

  return (
    <View style={{ flex: 1 }}>
      <SportSwitcher sport={sport} setSport={setSport} />

      {/* Search bar */}
      <View style={s.searchRow}>
        <View style={s.searchBar}>
          <Text style={s.searchIcon}>🔍</Text>
          <TextInput
            style={s.searchInput}
            placeholder={`Search ${sport} players...`}
            placeholderTextColor={colors.grey}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
          />
          {searching && <ActivityIndicator size="small" color={colors.grey} style={{ marginRight: 4 }} />}
          {query.length > 0 && !searching && (
            <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Results dropdown */}
      {results.length > 0 && (
        <>
          <TouchableWithoutFeedback onPress={dismiss}>
            <View style={s.overlay} />
          </TouchableWithoutFeedback>
          <Animated.View style={[s.searchDropdown, { opacity: fadeAnim }]}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {results.map((p, i) => (
                <TouchableOpacity
                  key={i}
                  style={s.searchResultRow}
                  onPress={() => { dismiss(); onOpenProfile(p); }}
                  activeOpacity={0.75}
                >
                  <PlayerAvatar name={p.name} headshot={p.headshot} size={30} />
                  <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                    <Text style={s.resultName}>{p.name}</Text>
                    <Text style={s.resultMeta}>{p.team}{p.position ? ` · ${p.position}` : ''}</Text>
                  </View>
                  {(p.injuryStatus === 'Out' || p.injuryStatus === 'Day-To-Day' || p.injuryStatus === 'Questionable') && (
                    <View style={s.injuryBadge}>
                      <Text style={s.injuryBadgeText}>{p.injuryStatus === 'Out' ? 'OUT' : 'GTD'}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Animated.View>
        </>
      )}

      {/* Empty hint */}
      {!query && results.length === 0 && (
        <View style={s.searchHint}>
          <Text style={s.hintTitle}>Search {sport} players</Text>
          <Text style={s.hintBody}>Enter at least 2 characters to see results. Tap a player for their full profile.</Text>
        </View>
      )}

      {query.length === 1 && (
        <View style={s.searchHint}>
          <Text style={s.hintBody}>Keep typing…</Text>
        </View>
      )}
    </View>
  );
}

// ── SECTION 2: TEAMS ──────────────────────────────────────────────────────────

// Team Detail Modal

function TeamDetailModal({ team, sport, visible, onClose }) {
  const [subTab, setSubTab]       = useState('Overview');
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!visible || !team) return;
    setSubTab('Overview');
    setData(null);
    setLoading(true);

    const nameParam = team.name ? `&name=${encodeURIComponent(team.name)}` : '';
    fetch(`${API_URL}/api/stats/teams/${sport}/${encodeURIComponent(team.id)}${nameParam}`)
      .then(r => r.json())
      .then(body => {
        setData(body);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [visible, team, sport]);

  const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatLocalTime = (utc) => {
    if (!utc) return '';
    try {
      return new Date(utc).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch { return ''; }
  };

  const injuryColor = (status) =>
    INJURY_COLOR[status] || INJURY_COLOR['Questionable'];

  if (!team) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.detailSafe}>
        <StatusBar barStyle="light-content" />

        {/* Header */}
        <View style={s.detailHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.detailTeamName}>{team.name}</Text>
            <Text style={s.detailRecord}>
              {team.wins !== null && team.losses !== null
                ? `${team.wins}–${team.losses}${team.otLosses != null ? `–${team.otLosses}` : ''}`
                : sport}
              {team.division ? `  ·  ${team.division}` : ''}
            </Text>
          </View>
          <TouchableOpacity style={s.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Sub-tab bar */}
        <View style={s.subTabBar}>
          {TEAM_DETAIL_TABS.map(tab => (
            <TouchableOpacity
              key={tab}
              style={[s.subTab, subTab === tab && s.subTabActive]}
              onPress={() => setSubTab(tab)}
              activeOpacity={0.75}
            >
              <Text style={[s.subTabText, subTab === tab && s.subTabTextActive]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <View style={s.centeredPad}>
            <ActivityIndicator size="large" color={colors.green} />
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

            {/* OVERVIEW */}
            {subTab === 'Overview' && (
              <View>
                {/* Recent form */}
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>Recent Form</Text>
                  {(data?.recent_games || []).length === 0 ? (
                    <Text style={s.emptyNote}>No recent game data available.</Text>
                  ) : (
                    <View style={s.card}>
                      {(data.recent_games || []).slice(0, 5).map((g, i) => (
                        <View key={i} style={[s.gameRow, i > 0 && s.gameRowBorder]}>
                          <Text style={s.gameDate}>{formatDate(g.date)}</Text>
                          <Text style={s.gameOpp}>{g.home_away === 'H' ? 'vs' : '@'} {g.opponent}</Text>
                          <View style={s.gameResultRow}>
                            <Text style={[s.gameResult, { color: g.result === 'W' ? colors.green : g.result === 'L' ? colors.red : '#FFB800' }]}>
                              {g.result || '—'}
                            </Text>
                            {g.pts_for != null && (
                              <Text style={s.gameScore}>{g.pts_for}–{g.pts_against}</Text>
                            )}
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Upcoming */}
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>Upcoming Games</Text>
                  {(data?.upcoming_games || []).length === 0 ? (
                    <Text style={s.emptyNote}>No upcoming games found.</Text>
                  ) : (
                    <View style={s.card}>
                      {(data.upcoming_games || []).slice(0, 5).map((g, i) => (
                        <View key={i} style={[s.gameRow, i > 0 && s.gameRowBorder]}>
                          <Text style={s.gameDate}>{formatDate(g.date)}</Text>
                          <Text style={s.gameOpp}>{g.home_away === 'H' ? 'vs' : '@'} {g.opponent}</Text>
                          {g.time_utc && (
                            <Text style={s.gameTime}>{formatLocalTime(g.time_utc)}</Text>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* ROSTER */}
            {subTab === 'Roster' && (
              <View style={s.detailSection}>
                {(data?.roster || []).length === 0 ? (
                  <Text style={s.emptyNote}>Roster data not available.</Text>
                ) : (
                  <View style={s.card}>
                    {(data.roster || []).map((p, i) => (
                      <View key={i} style={[s.rosterRow, i > 0 && s.gameRowBorder]}>
                        <View style={s.rosterNumBadge}>
                          <Text style={s.rosterNum}>{p.number !== '—' ? p.number : ''}</Text>
                        </View>
                        <Text style={s.rosterName}>{p.name}</Text>
                        <Text style={s.rosterPos}>{p.position}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* SCHEDULE */}
            {subTab === 'Schedule' && (
              <View>
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>Recent Results</Text>
                  {(data?.recent_games || []).length === 0 ? (
                    <Text style={s.emptyNote}>No recent game data available.</Text>
                  ) : (
                    <View style={s.card}>
                      {/* table header */}
                      <View style={[s.schedRow, s.schedHeader]}>
                        <Text style={[s.schedCell, s.schedHeaderText, { flex: 1.2 }]}>DATE</Text>
                        <Text style={[s.schedCell, s.schedHeaderText, { flex: 2 }]}>OPPONENT</Text>
                        <Text style={[s.schedCell, s.schedHeaderText]}>RES</Text>
                        <Text style={[s.schedCell, s.schedHeaderText]}>SCORE</Text>
                      </View>
                      {(data.recent_games || []).map((g, i) => (
                        <View key={i} style={s.schedRow}>
                          <Text style={[s.schedCell, { flex: 1.2, fontSize: 11 }]}>{formatDate(g.date)}</Text>
                          <Text style={[s.schedCell, { flex: 2 }]}>{g.home_away === 'H' ? 'vs' : '@'} {g.opponent}</Text>
                          <Text style={[s.schedCell, { color: g.result === 'W' ? colors.green : g.result === 'L' ? colors.red : '#FFB800', fontWeight: '700' }]}>
                            {g.result || '—'}
                          </Text>
                          <Text style={s.schedCell}>
                            {g.pts_for != null ? `${g.pts_for}–${g.pts_against}` : '—'}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>Upcoming</Text>
                  {(data?.upcoming_games || []).length === 0 ? (
                    <Text style={s.emptyNote}>No upcoming games found.</Text>
                  ) : (
                    <View style={s.card}>
                      <View style={[s.schedRow, s.schedHeader]}>
                        <Text style={[s.schedCell, s.schedHeaderText, { flex: 1.2 }]}>DATE</Text>
                        <Text style={[s.schedCell, s.schedHeaderText, { flex: 2 }]}>OPPONENT</Text>
                        <Text style={[s.schedCell, s.schedHeaderText]}>H/A</Text>
                        <Text style={[s.schedCell, s.schedHeaderText]}>TIME</Text>
                      </View>
                      {(data.upcoming_games || []).map((g, i) => (
                        <View key={i} style={s.schedRow}>
                          <Text style={[s.schedCell, { flex: 1.2, fontSize: 11 }]}>{formatDate(g.date)}</Text>
                          <Text style={[s.schedCell, { flex: 2 }]}>{g.opponent}</Text>
                          <Text style={s.schedCell}>{g.home_away || '—'}</Text>
                          <Text style={[s.schedCell, { fontSize: 10 }]}>{g.time_utc ? formatLocalTime(g.time_utc) : '—'}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* INJURIES */}
            {subTab === 'Injuries' && (
              <View style={s.detailSection}>
                {(data?.injuries || []).length === 0 ? (
                  <View style={s.emptyState}>
                    <Text style={s.emptyStateTitle}>No injury data available</Text>
                    <Text style={s.emptyStateBody}>No injury data available for {team.name} right now.</Text>
                  </View>
                ) : (
                  <View style={s.card}>
                    {(data.injuries || []).map((inj, i) => (
                      <View key={i} style={[s.injuryRow, i > 0 && s.gameRowBorder]}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.injuryPlayer}>{inj.player}</Text>
                          <Text style={s.injuryDesc}>{inj.injury}</Text>
                        </View>
                        <View style={[s.injuryStatusBadge, { backgroundColor: (injuryColor(inj.status) || '#888') + '22', borderColor: (injuryColor(inj.status) || '#888') + '88' }]}>
                          <Text style={[s.injuryStatusText, { color: injuryColor(inj.status) || colors.grey }]}>
                            {inj.status}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// Teams list section

function TeamsSection() {
  const [sport, setSport]           = useState('NBA');
  const [teams, setTeams]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null);

  const fetchTeams = useCallback(async (sp) => {
    try {
      const res  = await fetch(`${API_URL}/api/stats/teams/${sp}`);
      const body = await res.json();
      setTeams(body.teams || []);
    } catch {
      setTeams([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setTeams([]);
    fetchTeams(sport);
  }, [sport]);

  const onRefresh = () => { setRefreshing(true); fetchTeams(sport); };

  const renderTeam = ({ item: team, index }) => (
    <TouchableOpacity
      style={s.teamCard}
      onPress={() => setSelectedTeam(team)}
      activeOpacity={0.8}
    >
      <View style={s.teamCardLeft}>
        <View style={s.teamAbbrevBadge}>
          <Text style={s.teamAbbrevText}>{team.abbreviation}</Text>
        </View>
        <View>
          <Text style={s.teamName}>{team.name}</Text>
          {team.division ? <Text style={s.teamDivision}>{team.division}</Text> : null}
        </View>
      </View>
      <View style={s.teamCardRight}>
        {/* Last 5 dots */}
        {team.last5?.length > 0 && (
          <View style={s.dotsRow}>
            {team.last5.map((r, i) => <ResultDot key={i} result={r} />)}
          </View>
        )}
        {/* Record */}
        <Text style={s.teamRecord}>
          {team.wins !== null && team.losses !== null
            ? `${team.wins}–${team.losses}${team.otLosses != null ? `–${team.otLosses}` : ''}`
            : '—'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1 }}>
      <SportSwitcher sport={sport} setSport={setSport} />

      {loading ? (
        <View style={s.centeredPad}>
          <ActivityIndicator size="large" color={colors.green} />
        </View>
      ) : (
        <FlatList
          data={teams}
          keyExtractor={t => `${sport}_${t.id}`}
          renderItem={renderTeam}
          contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={s.emptyStateTitle}>No teams found</Text>
              <Text style={s.emptyStateBody}>Pull to refresh or check your connection.</Text>
            </View>
          }
        />
      )}

      <TeamDetailModal
        team={selectedTeam}
        sport={sport}
        visible={!!selectedTeam}
        onClose={() => setSelectedTeam(null)}
      />
    </View>
  );
}

// ── SECTION 3: LEADERS ────────────────────────────────────────────────────────

function LeadersSection({ onOpenProfile }) {
  const [sport, setSport]           = useState('NBA');
  const [stat, setStat]             = useState('PTS');
  const [leaders, setLeaders]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const pills = STAT_PILLS[sport] || STAT_PILLS.NBA;

  useEffect(() => {
    setStat(pills[0]);
  }, [sport]);

  const fetchLeaders = useCallback(async (sp, st) => {
    setLoading(true);
    try {
      const apiStat = STAT_API_KEYS[sp]?.[st] || st;
      const res     = await fetch(`${API_URL}/api/players/leaders?league=${sp}&stat=${apiStat}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setLeaders(body.leaders || []);
    } catch {
      setLeaders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (stat) fetchLeaders(sport, stat); }, [sport, stat]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLeaders(sport, stat);
    setRefreshing(false);
  }, [sport, stat]);

  const statLabel = () => {
    if (sport === 'NBA') return `${stat}/Game`;
    return stat;
  };

  return (
    <View style={{ flex: 1 }}>
      <SportSwitcher sport={sport} setSport={setSport} />

      {/* Stat pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillScroll} contentContainerStyle={s.pillBar}>
        {pills.map(p => (
          <TouchableOpacity
            key={p}
            style={[s.pill, stat === p && s.pillActive]}
            onPress={() => setStat(p)}
            activeOpacity={0.75}
          >
            <Text style={[s.pillText, stat === p && s.pillTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Section label */}
      <View style={s.leaderHeader}>
        <Text style={s.leaderHeaderLeft}>League Leaders</Text>
        <Text style={s.leaderHeaderRight}>{statLabel()}</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
      >
        <View style={[s.card, { marginHorizontal: spacing.md }]}>
          {loading ? (
            [0,1,2,3,4].map(i => <SkeletonRow key={i} />)
          ) : leaders.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyStateTitle}>Stats loading.</Text>
              <Text style={s.emptyStateBody}>Check back in a moment.</Text>
            </View>
          ) : (
            leaders.slice(0, 20).map((item, i) => (
              <TouchableOpacity
                key={i}
                style={[s.leaderRow, i > 0 && s.leaderRowBorder]}
                onPress={() => onOpenProfile(item)}
                activeOpacity={0.75}
              >
                <Text style={[s.leaderRank, item.rank === 1 && s.leaderRankFirst]}>
                  {item.rank}
                </Text>
                <PlayerAvatar name={item.name} headshot={item.headshot} size={36} />
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Text style={s.leaderName} numberOfLines={1}>{item.name}</Text>
                    {item.playingTonight && <View style={s.playingDot} />}
                  </View>
                  <Text style={s.leaderTeam}>{item.team}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  {item.injuryStatus && (
                    <View style={s.injuryBadge}>
                      <Text style={s.injuryBadgeText}>{item.injuryStatus === 'Out' ? 'OUT' : 'GTD'}</Text>
                    </View>
                  )}
                  <Text style={[s.leaderStat, item.rank === 1 && s.leaderStatFirst]}>{item.value}</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function StatsScreen() {
  const [section, setSection]         = useState('Players');
  const [profilePlayer, setProfilePlayer] = useState(null);

  const openProfile = (item) => {
    setProfilePlayer({
      id:     item.playerId != null ? String(item.playerId) : (item.id || item.player_id || item.name?.toLowerCase().replace(/\s+/g, '-')),
      name:   item.name || item.player_name,
      league: item.league || item.sport || 'NBA',
    });
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Stats</Text>
      </View>

      {/* Section selector */}
      <View style={s.sectionBar}>
        {SECTIONS.map(sec => (
          <TouchableOpacity
            key={sec}
            style={[s.sectionPill, section === sec && s.sectionPillActive]}
            onPress={() => setSection(sec)}
            activeOpacity={0.75}
          >
            <Text style={[s.sectionPillText, section === sec && s.sectionPillTextActive]}>{sec}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Section content */}
      {section === 'Players' && <PlayersSection onOpenProfile={openProfile} />}
      {section === 'Teams'   && <TeamsSection />}
      {section === 'Leaders' && <LeadersSection onOpenProfile={openProfile} />}

      <PlayerProfileModal
        visible={!!profilePlayer}
        playerId={profilePlayer?.id}
        playerName={profilePlayer?.name}
        playerLeague={profilePlayer?.league || 'NBA'}
        onClose={() => setProfilePlayer(null)}
        onAskChalky={null}
      />
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.background },
  header:      { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.offWhite },

  // Section pills
  sectionBar: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: '#0f0f0f',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 3,
    gap: 2,
  },
  sectionPill: {
    flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.md,
  },
  sectionPillActive:    { backgroundColor: colors.green },
  sectionPillText:      { fontSize: 13, fontWeight: '700', color: '#888888', letterSpacing: 0.2 },
  sectionPillTextActive:{ color: '#0A0A0A' },

  // Sport switcher
  sportScroll: { height: 42, flexGrow: 0 },
  sportBar:    { paddingHorizontal: spacing.md, alignItems: 'center', gap: spacing.xs },
  sportChip: {
    paddingHorizontal: spacing.md + 2, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: '#0f0f0f',
    borderWidth: 1, borderColor: '#1e1e1e',
  },
  sportChipActive:     { backgroundColor: colors.offWhite, borderColor: colors.offWhite },
  sportChipText:       { fontSize: 13, fontWeight: '600', color: '#888888' },
  sportChipTextActive: { color: '#0A0A0A' },

  // Stat pills (Leaders)
  pillScroll: { height: 40, flexGrow: 0 },
  pillBar:    { paddingHorizontal: spacing.md, alignItems: 'center', gap: spacing.xs },
  pill: {
    paddingHorizontal: spacing.sm + 4, paddingVertical: 5,
    borderRadius: radius.full, backgroundColor: 'transparent',
    borderWidth: 1, borderColor: '#1e1e1e',
  },
  pillActive:     { backgroundColor: colors.green + '22', borderColor: colors.green },
  pillText:       { fontSize: 12, fontWeight: '600', color: '#888888' },
  pillTextActive: { color: colors.green },

  // Search
  searchRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0f0f0f', borderRadius: radius.lg,
    paddingHorizontal: spacing.sm, gap: spacing.xs,
    borderWidth: 1, borderColor: '#1e1e1e', height: 42,
  },
  searchIcon:  { fontSize: 14 },
  searchInput: { flex: 1, color: colors.offWhite, fontSize: 13 },
  clearBtnText:{ color: '#888888', fontSize: 14, fontWeight: '600', paddingHorizontal: 4 },
  overlay:     { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 },
  searchDropdown: {
    position: 'absolute', top: 100, left: spacing.md, right: spacing.md,
    backgroundColor: '#0f0f0f', borderRadius: radius.md, zIndex: 100,
    borderWidth: 1, borderColor: '#1e1e1e', overflow: 'hidden', maxHeight: 360,
  },
  searchResultRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: '#1e1e1e',
  },
  resultName: { fontSize: 13, fontWeight: '600', color: colors.offWhite },
  resultMeta: { fontSize: 11, color: '#888888', marginTop: 1 },
  searchHint: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 },
  hintTitle:  { fontSize: 15, fontWeight: '700', color: colors.offWhite, marginBottom: 8 },
  hintBody:   { fontSize: 13, color: '#888888', textAlign: 'center', lineHeight: 20 },

  // Team cards
  teamCard: {
    backgroundColor: '#0f0f0f',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  teamCardLeft:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  teamCardRight: { alignItems: 'flex-end', gap: 5 },
  teamAbbrevBadge: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: '#1e1e1e', alignItems: 'center', justifyContent: 'center',
  },
  teamAbbrevText: { fontSize: 12, fontWeight: '800', color: colors.offWhite },
  teamName:       { fontSize: 14, fontWeight: '700', color: colors.offWhite },
  teamDivision:   { fontSize: 11, color: '#888888', marginTop: 2 },
  teamRecord:     { fontSize: 14, fontWeight: '700', color: colors.offWhite },
  dotsRow:        { flexDirection: 'row', gap: 3 },
  dot:            { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1e1e1e' },
  dotWin:         { backgroundColor: colors.green },
  dotLoss:        { backgroundColor: colors.red },
  dotOT:          { backgroundColor: '#FFB800' },

  // Leaders
  leaderHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.xs,
  },
  leaderHeaderLeft:  { fontSize: 12, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.8 },
  leaderHeaderRight: { fontSize: 11, color: '#888888' },
  leaderRow:         { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  leaderRowBorder:   { borderTopWidth: 1, borderTopColor: '#1e1e1e' },
  leaderRank:        { fontSize: 14, fontWeight: '700', color: '#888888', width: 22, textAlign: 'center' },
  leaderRankFirst:   { color: colors.green },
  leaderName:        { fontSize: 14, fontWeight: '600', color: colors.offWhite },
  leaderTeam:        { fontSize: 11, color: '#888888', marginTop: 1 },
  leaderStat:        { fontSize: 18, fontWeight: '800', color: colors.offWhite },
  leaderStatFirst:   { color: colors.green },
  playingDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },

  // Skeleton
  skeletonRow:   { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  skeletonRank:  { width: 22, height: 16, backgroundColor: '#1e1e1e', borderRadius: 4 },
  skeletonAvatar:{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#1e1e1e' },
  skeletonName:  { height: 12, width: '60%', backgroundColor: '#1e1e1e', borderRadius: 4 },
  skeletonTeam:  { height: 10, width: '35%', backgroundColor: '#1a1a1a', borderRadius: 4 },
  skeletonStat:  { width: 36, height: 24, backgroundColor: '#1e1e1e', borderRadius: 4 },

  // Injury badge
  injuryBadge: {
    backgroundColor: colors.red + '18', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: colors.red + '44',
  },
  injuryBadgeText: { fontSize: 9, fontWeight: '700', color: colors.red },

  // Shared card
  card: {
    backgroundColor: '#0f0f0f', borderRadius: radius.lg,
    borderWidth: 1, borderColor: '#1e1e1e', overflow: 'hidden',
  },

  // Shared empty / loading
  centeredPad:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyState:     { padding: spacing.xl, alignItems: 'center' },
  emptyStateTitle:{ fontSize: 15, fontWeight: '700', color: colors.offWhite, marginBottom: 6 },
  emptyStateBody: { fontSize: 13, color: '#888888', textAlign: 'center', lineHeight: 20 },
  emptyNote:      { padding: spacing.md, fontSize: 13, color: '#888888' },

  // ─ Team Detail Modal ───────────────────────────────────────────────────────

  detailSafe:        { flex: 1, backgroundColor: colors.background },
  detailHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: '#1e1e1e',
  },
  detailTeamName:  { fontSize: 20, fontWeight: '800', color: colors.offWhite },
  detailRecord:    { fontSize: 13, color: '#888888', marginTop: 3 },
  closeBtn: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: '#1C1C1C', alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: '#888888', fontSize: 14, fontWeight: '600' },
  subTabBar: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    backgroundColor: '#0f0f0f',
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: '#1e1e1e',
    padding: 3, gap: 2,
  },
  subTab: {
    flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: radius.md,
  },
  subTabActive:    { backgroundColor: colors.green },
  subTabText:      { fontSize: 11, fontWeight: '700', color: '#888888' },
  subTabTextActive:{ color: '#0A0A0A' },
  detailSection:   { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  detailSectionTitle: {
    fontSize: 12, fontWeight: '700', color: '#888888',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm,
  },

  // Game rows
  gameRow:     { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: 8 },
  gameRowBorder:{ borderTopWidth: 1, borderTopColor: '#1e1e1e' },
  gameDate:    { fontSize: 12, color: '#888888', width: 52 },
  gameOpp:     { flex: 1, fontSize: 13, fontWeight: '600', color: colors.offWhite },
  gameResultRow:{ flexDirection: 'row', alignItems: 'center', gap: 6 },
  gameResult:  { fontSize: 13, fontWeight: '800' },
  gameScore:   { fontSize: 12, color: '#888888' },
  gameTime:    { fontSize: 12, color: '#888888' },

  // Roster rows
  rosterRow:      { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  rosterNumBadge: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#1e1e1e', alignItems: 'center', justifyContent: 'center' },
  rosterNum:      { fontSize: 11, fontWeight: '700', color: '#888888' },
  rosterName:     { flex: 1, fontSize: 13, fontWeight: '600', color: colors.offWhite },
  rosterPos:      { fontSize: 12, color: '#888888' },

  // Schedule table
  schedRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 9 },
  schedHeader:    { borderBottomWidth: 1, borderBottomColor: '#1e1e1e', backgroundColor: '#0a0a0a' },
  schedHeaderText:{ fontWeight: '700', color: '#888888', fontSize: 10, textTransform: 'uppercase' },
  schedCell:      { flex: 1, fontSize: 12, color: colors.offWhite },

  // Injury rows
  injuryRow:          { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  injuryPlayer:       { fontSize: 13, fontWeight: '600', color: colors.offWhite },
  injuryDesc:         { fontSize: 11, color: '#888888', marginTop: 2 },
  injuryStatusBadge: {
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1,
  },
  injuryStatusText:   { fontSize: 11, fontWeight: '700' },
});
