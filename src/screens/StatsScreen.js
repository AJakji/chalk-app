import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  TouchableOpacity, Animated, ScrollView,
  FlatList, RefreshControl, ActivityIndicator,
  Modal, Image,
} from 'react-native';

import { colors, spacing, radius } from '../theme';
import { API_URL } from '../config';
import PlayerProfileModal from '../components/players/PlayerProfileModal';
import PlayerAvatar from '../components/players/PlayerAvatar';

// ── Constants ──────────────────────────────────────────────────────────────────

const SECTIONS = ['Teams', 'Players'];
const SPORTS   = ['NBA', 'NHL', 'MLB'];

const STAT_PILLS = {
  NBA: ['PTS', 'REB', 'AST', 'BLK', 'STL', '3PM'],
  NHL: ['Goals', 'Assists', 'Points', 'Shots'],
  MLB: ['HR', 'RBI', 'AVG', 'H', 'K', 'ERA'],
};

const STAT_API_KEYS = {
  NBA: { PTS:'PTS', REB:'REB', AST:'AST', BLK:'BLK', STL:'STL', '3PM':'3PM' },
  NHL: { Goals:'G', Assists:'A', Points:'PTS', Shots:'SOG' },
  MLB: { HR:'HR', RBI:'RBI', AVG:'AVG', H:'H', K:'K', ERA:'ERA' },
};

const TEAM_DETAIL_TABS = ['Overview', 'Roster', 'Schedule', 'Injuries'];

const INJURY_COLORS = {
  Out:          '#FF4444',
  Doubtful:     '#FF8C00',
  Questionable: '#FFD700',
  Probable:     '#00E87A',
  'Day-to-day': '#FFD700',
  GTD:          '#FFD700',
};

// Playoff status → left border color
const STATUS_COLORS = {
  playoff: colors.green,
  wildcard:'#FFD700',
  playin:  '#FFD700',
  missed:  'transparent',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function getTeamLogoUri(sport, espnAbbr) {
  if (!espnAbbr) return null;
  return `https://a.espncdn.com/i/teamlogos/${sport.toLowerCase()}/500/${espnAbbr}.png`;
}

function TeamLogo({ sport, espnAbbr }) {
  const [failed, setFailed] = useState(false);
  const uri = getTeamLogoUri(sport, espnAbbr);
  if (!uri || failed) {
    return (
      <View style={s.logoFallback}>
        <Text style={s.logoFallbackText}>{(espnAbbr || '').slice(0,3).toUpperCase()}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={s.teamLogo}
      resizeMode="contain"
      onError={() => setFailed(true)}
    />
  );
}

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
      <View style={{ flex: 1, gap: 5 }}>
        <View style={s.skeletonName} />
        <View style={s.skeletonTeam} />
      </View>
      <View style={s.skeletonStat} />
    </Animated.View>
  );
}

// ── Team Detail Modal ──────────────────────────────────────────────────────────

function TeamDetailModal({ team, sport, visible, onClose }) {
  const [subTab, setSubTab] = useState('Overview');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible || !team) return;
    setSubTab('Overview');
    setData(null);
    setLoading(true);
    const nameParam = team.name ? `&name=${encodeURIComponent(team.name)}` : '';
    fetch(`${API_URL}/api/stats/teams/${sport}/${encodeURIComponent(team.id)}${nameParam}`)
      .then(r => r.json())
      .then(body => { setData(body); setLoading(false); })
      .catch(() => setLoading(false));
  }, [visible, team, sport]);

  const fmtDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  };
  const fmtTime = (utc) => {
    if (!utc) return '';
    try { return new Date(utc).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }); }
    catch { return ''; }
  };

  if (!team) return null;
  const record = team.wins !== null && team.losses !== null
    ? `${team.wins}–${team.losses}${team.otl != null ? `–${team.otl}` : ''}`
    : sport;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.detailSafe}>
        <StatusBar barStyle="light-content" />

        {/* Header */}
        <View style={s.detailHeader}>
          <View style={s.detailLogoWrap}>
            <TeamLogo sport={sport} espnAbbr={team.espnAbbr} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.detailTeamName}>{team.name}</Text>
            <Text style={s.detailRecord}>{record}{team.division ? `  ·  ${team.division}` : ''}</Text>
          </View>
          <TouchableOpacity style={s.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Sub-tabs */}
        <View style={s.subTabBar}>
          {TEAM_DETAIL_TABS.map(tab => (
            <TouchableOpacity key={tab} style={[s.subTab, subTab === tab && s.subTabActive]} onPress={() => setSubTab(tab)} activeOpacity={0.75}>
              <Text style={[s.subTabText, subTab === tab && s.subTabTextActive]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <View style={s.centerPad}><ActivityIndicator size="large" color={colors.green} /></View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

            {subTab === 'Overview' && (
              <View>
                <View style={s.dtSection}>
                  <Text style={s.dtSectionTitle}>Recent Form</Text>
                  {!(data?.recent_games?.length) ? <Text style={s.emptyNote}>No recent game data.</Text> : (
                    <View style={s.card}>
                      {data.recent_games.slice(0, 5).map((g, i) => (
                        <View key={i} style={[s.gameRow, i > 0 && s.rowBorder]}>
                          <Text style={s.gameDate}>{fmtDate(g.date)}</Text>
                          <Text style={s.gameOpp}>{g.home_away === 'H' ? 'vs' : '@'} {g.opponent}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={[s.gameResult, { color: g.result === 'W' ? colors.green : g.result === 'L' ? colors.red : '#FFB800' }]}>{g.result || '—'}</Text>
                            {g.pts_for != null && <Text style={s.gameScore}>{g.pts_for}–{g.pts_against}</Text>}
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                <View style={s.dtSection}>
                  <Text style={s.dtSectionTitle}>Upcoming</Text>
                  {!(data?.upcoming_games?.length) ? <Text style={s.emptyNote}>No upcoming games found.</Text> : (
                    <View style={s.card}>
                      {data.upcoming_games.slice(0, 5).map((g, i) => (
                        <View key={i} style={[s.gameRow, i > 0 && s.rowBorder]}>
                          <Text style={s.gameDate}>{fmtDate(g.date)}</Text>
                          <Text style={s.gameOpp}>{g.home_away === 'H' ? 'vs' : '@'} {g.opponent}</Text>
                          {g.time_utc ? <Text style={s.gameTime}>{fmtTime(g.time_utc)}</Text> : null}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}

            {subTab === 'Roster' && (
              <View style={s.dtSection}>
                {!(data?.roster?.length) ? <Text style={s.emptyNote}>Roster data not available.</Text> : (
                  <View style={s.card}>
                    {data.roster.map((p, i) => (
                      <View key={i} style={[s.rosterRow, i > 0 && s.rowBorder]}>
                        <View style={s.numBadge}><Text style={s.numText}>{p.number !== '—' ? p.number : ''}</Text></View>
                        <Text style={s.rosterName}>{p.name}</Text>
                        <Text style={s.rosterPos}>{p.position}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {subTab === 'Schedule' && (
              <View>
                <View style={s.dtSection}>
                  <Text style={s.dtSectionTitle}>Recent Results</Text>
                  {!(data?.recent_games?.length) ? <Text style={s.emptyNote}>No data.</Text> : (
                    <View style={s.card}>
                      <View style={[s.schedRow, s.schedHead]}>
                        {['DATE','OPPONENT','RES','SCORE'].map(h => (
                          <Text key={h} style={[s.schedCell, s.schedHeadText, h === 'OPPONENT' && { flex: 2 }, h === 'DATE' && { flex: 1.2 }]}>{h}</Text>
                        ))}
                      </View>
                      {data.recent_games.map((g, i) => (
                        <View key={i} style={s.schedRow}>
                          <Text style={[s.schedCell, { flex: 1.2, fontSize: 11 }]}>{fmtDate(g.date)}</Text>
                          <Text style={[s.schedCell, { flex: 2 }]}>{g.home_away === 'H' ? 'vs' : '@'} {g.opponent}</Text>
                          <Text style={[s.schedCell, { color: g.result === 'W' ? colors.green : g.result === 'L' ? colors.red : '#FFB800', fontWeight:'700' }]}>{g.result || '—'}</Text>
                          <Text style={s.schedCell}>{g.pts_for != null ? `${g.pts_for}–${g.pts_against}` : '—'}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                <View style={s.dtSection}>
                  <Text style={s.dtSectionTitle}>Upcoming</Text>
                  {!(data?.upcoming_games?.length) ? <Text style={s.emptyNote}>No upcoming games.</Text> : (
                    <View style={s.card}>
                      <View style={[s.schedRow, s.schedHead]}>
                        {['DATE','OPPONENT','H/A','TIME'].map(h => (
                          <Text key={h} style={[s.schedCell, s.schedHeadText, h === 'OPPONENT' && { flex: 2 }, h === 'DATE' && { flex: 1.2 }]}>{h}</Text>
                        ))}
                      </View>
                      {data.upcoming_games.map((g, i) => (
                        <View key={i} style={s.schedRow}>
                          <Text style={[s.schedCell, { flex: 1.2, fontSize: 11 }]}>{fmtDate(g.date)}</Text>
                          <Text style={[s.schedCell, { flex: 2 }]}>{g.opponent}</Text>
                          <Text style={s.schedCell}>{g.home_away}</Text>
                          <Text style={[s.schedCell, { fontSize: 10 }]}>{g.time_utc ? fmtTime(g.time_utc) : '—'}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}

            {subTab === 'Injuries' && (
              <View style={s.dtSection}>
                {!(data?.injuries?.length) ? (
                  <View style={s.emptyState}>
                    <Text style={s.emptyTitle}>No injury data</Text>
                    <Text style={s.emptyBody}>No injury data available for {team.name} right now.</Text>
                  </View>
                ) : (
                  <View style={s.card}>
                    {data.injuries.map((inj, i) => {
                      const ic = INJURY_COLORS[inj.status] || '#888888';
                      return (
                        <View key={i} style={[s.injuryRow, i > 0 && s.rowBorder]}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.injuryPlayer}>{inj.player}</Text>
                            <Text style={s.injuryDesc}>{inj.injury}</Text>
                          </View>
                          <View style={[s.injuryBadge, { backgroundColor: ic + '22', borderColor: ic + '88' }]}>
                            <Text style={[s.injuryBadgeText, { color: ic }]}>{inj.status}</Text>
                          </View>
                        </View>
                      );
                    })}
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

// ── Teams Standings Section ────────────────────────────────────────────────────

// Column headers per sport
const COLS = {
  NBA: [{ key:'wins', label:'W', w:28 }, { key:'losses', label:'L', w:28 }, { key:'pct', label:'PCT', w:44 }, { key:'gb', label:'GB', w:32 }],
  NHL: [{ key:'gp', label:'GP', w:28 }, { key:'wins', label:'W', w:28 }, { key:'losses', label:'L', w:28 }, { key:'otl', label:'OTL', w:32 }, { key:'pts', label:'PTS', w:36 }],
  MLB: [{ key:'wins', label:'W', w:28 }, { key:'losses', label:'L', w:28 }, { key:'pct', label:'PCT', w:44 }, { key:'gb', label:'GB', w:32 }],
};

function StandingsRow({ team, sport, rank, onPress }) {
  const statusColor = STATUS_COLORS[team.playoffStatus] || 'transparent';
  const cols = COLS[sport] || COLS.NBA;

  return (
    <TouchableOpacity style={[s.standingRow, { borderLeftColor: statusColor, borderLeftWidth: 3 }]} onPress={() => onPress(team)} activeOpacity={0.78}>
      <Text style={s.standingRank}>{rank}</Text>
      <View style={s.logoWrap}>
        <TeamLogo sport={sport} espnAbbr={team.espnAbbr} />
      </View>
      <Text style={s.standingName} numberOfLines={1}>{team.name}</Text>
      {cols.map(col => (
        <Text key={col.key} style={[s.standingCell, { width: col.w }]}>
          {team[col.key] ?? '—'}
        </Text>
      ))}
    </TouchableOpacity>
  );
}

function DivisionBlock({ division, sport, onPressTeam }) {
  const cols = COLS[sport] || COLS.NBA;
  return (
    <View style={s.divBlock}>
      {/* Division header */}
      <View style={s.divHeader}>
        <Text style={s.divName}>{division.name}</Text>
        <View style={s.divColHeaders}>
          {cols.map(col => (
            <Text key={col.key} style={[s.divColText, { width: col.w }]}>{col.label}</Text>
          ))}
        </View>
      </View>
      {/* Team rows */}
      {division.teams.map((team, i) => (
        <StandingsRow key={team.id} team={team} sport={sport} rank={i + 1} onPress={onPressTeam} />
      ))}
    </View>
  );
}

function TeamsSection() {
  const [sport, setSport]           = useState('NBA');
  const [standings, setStandings]   = useState(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null);

  const fetchStandings = useCallback(async (sp) => {
    try {
      const res  = await fetch(`${API_URL}/api/stats/standings/${sp}`);
      const body = await res.json();
      setStandings(body.conferences || []);
    } catch {
      setStandings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setStandings(null);
    fetchStandings(sport);
  }, [sport]);

  const onRefresh = () => { setRefreshing(true); fetchStandings(sport); };

  const playoffLegend = () => {
    if (sport === 'NBA') return '● Playoff  ○ Play-in';
    if (sport === 'NHL') return '● Division leader  ○ Wildcard';
    return '● Division winner  ○ Wildcard';
  };

  return (
    <View style={{ flex: 1 }}>
      <SportSwitcher sport={sport} setSport={setSport} />

      {loading ? (
        <View style={s.centerPad}><ActivityIndicator size="large" color={colors.green} /></View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
          contentContainerStyle={{ paddingBottom: 48 }}
        >
          {/* Legend */}
          <View style={s.legendRow}>
            <View style={[s.legendDot, { backgroundColor: colors.green }]} />
            <Text style={s.legendText}>Playoff  </Text>
            <View style={[s.legendDot, { backgroundColor: '#FFD700' }]} />
            <Text style={s.legendText}>{sport === 'NBA' ? 'Play-in' : 'Wildcard'}</Text>
          </View>

          {(standings || []).map((conf, ci) => (
            <View key={ci} style={s.confBlock}>
              {/* Conference header */}
              <View style={s.confHeader}>
                <Text style={s.confName}>{conf.name}</Text>
              </View>
              {/* Divisions */}
              {(conf.divisions || []).map((div, di) => (
                <DivisionBlock
                  key={di}
                  division={div}
                  sport={sport}
                  onPressTeam={setSelectedTeam}
                />
              ))}
            </View>
          ))}

          {(!standings || standings.length === 0) && (
            <View style={s.emptyState}>
              <Text style={s.emptyTitle}>Could not load standings</Text>
              <Text style={s.emptyBody}>Pull to refresh or check your connection.</Text>
            </View>
          )}
        </ScrollView>
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

// ── Players (Leaders) Section ─────────────────────────────────────────────────

function PlayersSection({ onOpenProfile }) {
  const [sport, setSport]           = useState('NBA');
  const [stat, setStat]             = useState('PTS');
  const [leaders, setLeaders]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const pills = STAT_PILLS[sport] || STAT_PILLS.NBA;

  useEffect(() => { setStat(pills[0]); }, [sport]);

  const fetchLeaders = useCallback(async (sp, st) => {
    setLoading(true);
    try {
      const apiStat = STAT_API_KEYS[sp]?.[st] || st;
      const res     = await fetch(`${API_URL}/api/players/leaders?league=${sp}&stat=${apiStat}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setLeaders(body.leaders || []);
    } catch { setLeaders([]); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { if (stat) fetchLeaders(sport, stat); }, [sport, stat]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLeaders(sport, stat);
    setRefreshing(false);
  }, [sport, stat]);

  const statLabel = sport === 'NBA' ? `${stat}/Game` : stat;

  return (
    <View style={{ flex: 1 }}>
      <SportSwitcher sport={sport} setSport={setSport} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillScroll} contentContainerStyle={s.pillBar}>
        {pills.map(p => (
          <TouchableOpacity key={p} style={[s.pill, stat === p && s.pillActive]} onPress={() => setStat(p)} activeOpacity={0.75}>
            <Text style={[s.pillText, stat === p && s.pillTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.leaderHeader}>
        <Text style={s.leaderHeaderLeft}>League Leaders</Text>
        <Text style={s.leaderHeaderRight}>{statLabel}</Text>
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
              <Text style={s.emptyTitle}>Stats loading.</Text>
              <Text style={s.emptyBody}>Check back in a moment.</Text>
            </View>
          ) : (
            leaders.slice(0, 20).map((item, i) => (
              <TouchableOpacity
                key={i}
                style={[s.leaderRow, i > 0 && s.rowBorder]}
                onPress={() => onOpenProfile(item)}
                activeOpacity={0.75}
              >
                <Text style={[s.leaderRank, item.rank === 1 && s.leaderRankFirst]}>{item.rank}</Text>
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
                    <View style={s.injBadge}>
                      <Text style={s.injBadgeText}>{item.injuryStatus === 'Out' ? 'OUT' : 'GTD'}</Text>
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
  const [section, setSection]         = useState('Teams');
  const [profilePlayer, setProfilePlayer] = useState(null);

  const openProfile = (item) => {
    setProfilePlayer({
      id:     item.playerId != null ? String(item.playerId) : (item.id || item.name?.toLowerCase().replace(/\s+/g, '-')),
      name:   item.name,
      league: item.league || 'NBA',
    });
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      <View style={s.header}>
        <Text style={s.headerTitle}>Stats</Text>
      </View>

      {/* Section selector — 2 pills */}
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

      {section === 'Teams'   && <TeamsSection />}
      {section === 'Players' && <PlayersSection onOpenProfile={openProfile} />}

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
    marginHorizontal: spacing.md, marginBottom: spacing.sm,
    backgroundColor: '#0f0f0f', borderRadius: radius.lg,
    borderWidth: 1, borderColor: '#1e1e1e',
    padding: 3, gap: 2,
  },
  sectionPill:       { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.md },
  sectionPillActive: { backgroundColor: colors.green },
  sectionPillText:   { fontSize: 13, fontWeight: '700', color: '#888888', letterSpacing: 0.2 },
  sectionPillTextActive: { color: '#0A0A0A' },

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

  // Team logo
  teamLogo:        { width: 28, height: 28 },
  logoWrap:        { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  logoFallback:    { width: 28, height: 28, borderRadius: 4, backgroundColor: '#1e1e1e', alignItems: 'center', justifyContent: 'center' },
  logoFallbackText:{ fontSize: 8, fontWeight: '800', color: '#888888' },

  // Legend
  legendRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: 4 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: '#888888' },

  // Conference block
  confBlock:  { marginBottom: spacing.sm },
  confHeader: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#1e1e1e',
    marginBottom: 2,
  },
  confName: { fontSize: 13, fontWeight: '800', color: colors.offWhite, textTransform: 'uppercase', letterSpacing: 0.6 },

  // Division block
  divBlock: { marginBottom: spacing.sm },
  divHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: 6,
    backgroundColor: '#0d0d0d',
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#1a1a1a',
  },
  divName:      { fontSize: 11, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.5 },
  divColHeaders:{ flexDirection: 'row', alignItems: 'center' },
  divColText:   { fontSize: 10, fontWeight: '700', color: '#555555', textAlign: 'right' },

  // Standings row
  standingRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 9,
    backgroundColor: colors.background,
    borderBottomWidth: 1, borderBottomColor: '#0f0f0f',
    gap: 6,
  },
  standingRank: { fontSize: 12, fontWeight: '700', color: '#555555', width: 16, textAlign: 'center' },
  standingName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.offWhite, marginLeft: 4 },
  standingCell: { fontSize: 12, fontWeight: '600', color: '#888888', textAlign: 'right' },

  // Stat pills (Players section)
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

  // Leaders
  leaderHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.xs,
  },
  leaderHeaderLeft:  { fontSize: 12, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.8 },
  leaderHeaderRight: { fontSize: 11, color: '#888888' },
  leaderRow:         { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
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

  injBadge:     { backgroundColor: colors.red + '18', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: colors.red + '44' },
  injBadgeText: { fontSize: 9, fontWeight: '700', color: colors.red },

  // Shared card
  card:    { backgroundColor: '#0f0f0f', borderRadius: radius.lg, borderWidth: 1, borderColor: '#1e1e1e', overflow: 'hidden' },
  rowBorder:{ borderTopWidth: 1, borderTopColor: '#1e1e1e' },

  // Shared empty / loading
  centerPad: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyState:{ padding: spacing.xl, alignItems: 'center' },
  emptyTitle:{ fontSize: 15, fontWeight: '700', color: colors.offWhite, marginBottom: 6 },
  emptyBody: { fontSize: 13, color: '#888888', textAlign: 'center', lineHeight: 20 },
  emptyNote: { padding: spacing.md, fontSize: 13, color: '#888888' },

  // ── Team Detail Modal ─────────────────────────────────────────────────────

  detailSafe:      { flex: 1, backgroundColor: colors.background },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: '#1e1e1e', gap: spacing.sm,
  },
  detailLogoWrap:  { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  detailTeamName:  { fontSize: 18, fontWeight: '800', color: colors.offWhite },
  detailRecord:    { fontSize: 12, color: '#888888', marginTop: 2 },
  closeBtn:        { width: 32, height: 32, borderRadius: radius.full, backgroundColor: '#1C1C1C', alignItems: 'center', justifyContent: 'center' },
  closeBtnText:    { color: '#888888', fontSize: 14, fontWeight: '600' },
  subTabBar: {
    flexDirection: 'row', marginHorizontal: spacing.md, marginVertical: spacing.sm,
    backgroundColor: '#0f0f0f', borderRadius: radius.lg, borderWidth: 1, borderColor: '#1e1e1e', padding: 3, gap: 2,
  },
  subTab:          { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: radius.md },
  subTabActive:    { backgroundColor: colors.green },
  subTabText:      { fontSize: 11, fontWeight: '700', color: '#888888' },
  subTabTextActive:{ color: '#0A0A0A' },
  dtSection:       { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  dtSectionTitle:  { fontSize: 12, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm },

  gameRow:   { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: 8 },
  gameDate:  { fontSize: 12, color: '#888888', width: 52 },
  gameOpp:   { flex: 1, fontSize: 13, fontWeight: '600', color: colors.offWhite },
  gameResult:{ fontSize: 13, fontWeight: '800' },
  gameScore: { fontSize: 12, color: '#888888' },
  gameTime:  { fontSize: 12, color: '#888888' },

  rosterRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  numBadge:  { width: 28, height: 28, borderRadius: 6, backgroundColor: '#1e1e1e', alignItems: 'center', justifyContent: 'center' },
  numText:   { fontSize: 11, fontWeight: '700', color: '#888888' },
  rosterName:{ flex: 1, fontSize: 13, fontWeight: '600', color: colors.offWhite },
  rosterPos: { fontSize: 12, color: '#888888' },

  schedRow:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 9 },
  schedHead:   { borderBottomWidth: 1, borderBottomColor: '#1e1e1e', backgroundColor: '#0a0a0a' },
  schedHeadText:{ fontWeight: '700', color: '#888888', fontSize: 10, textTransform: 'uppercase' },
  schedCell:   { flex: 1, fontSize: 12, color: colors.offWhite },

  injuryRow:      { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  injuryPlayer:   { fontSize: 13, fontWeight: '600', color: colors.offWhite },
  injuryDesc:     { fontSize: 11, color: '#888888', marginTop: 2 },
  injuryBadge:    { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  injuryBadgeText:{ fontSize: 11, fontWeight: '700' },
});
