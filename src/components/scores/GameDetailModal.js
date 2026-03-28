import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  SafeAreaView,
  StatusBar,
  Animated,
  Dimensions,
  LayoutAnimation,
  UIManager,
  Platform,
} from 'react-native';
import { colors, spacing, radius } from '../../theme';
import TeamLogo from '../TeamLogo';
import { useTeamLogos } from '../../context/TeamLogosContext';
import PlayerProfileModal from '../players/PlayerProfileModal';
import {
  fetchNBALiveBoxScore,
  fetchNBAPlayByPlay,
  fetchSportsBoxScore,
  fetchSportsPBP,
  fetchGameInfo,
  fetchGameDetails,
  fetchGameOdds,
  fetchMLBLiveState,
  fetchTeamLeaders,
  fetchChalkyTake,
} from '../../services/api';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TABS     = ['Box Score', 'Play by Play', 'Game Info'];
const PRE_TABS = ['Preview', 'Matchup', 'Odds', 'Injuries'];

// ── Skeleton loading pulse ────────────────────────────────────────────────────

function SkeletonBar({ width = '100%', height = 14, style }) {
  const pulse = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: 6, backgroundColor: colors.surfaceAlt, opacity: pulse },
        style,
      ]}
    />
  );
}

function SkeletonBoxScore() {
  return (
    <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md }}>
      <SkeletonBar height={20} width="60%" />
      <View style={{ gap: 10 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <SkeletonBar width={120} height={13} />
            <SkeletonBar width={28} height={13} />
            <SkeletonBar width={32} height={13} />
            <SkeletonBar width={32} height={13} />
            <SkeletonBar width={32} height={13} />
            <SkeletonBar width={44} height={13} />
            <SkeletonBar width={32} height={13} />
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Score flash animation ─────────────────────────────────────────────────────

function FlashScore({ score, isLive, style }) {
  const flash     = useRef(new Animated.Value(0)).current;
  const prevScore = useRef(score);

  useEffect(() => {
    if (isLive && score !== prevScore.current) {
      prevScore.current = score;
      flash.setValue(1);
      Animated.timing(flash, { toValue: 0, duration: 1200, useNativeDriver: false }).start();
    }
  }, [score, isLive]);

  const bg = flash.interpolate({ inputRange: [0, 1], outputRange: ['transparent', colors.green + '40'] });

  return (
    <Animated.View style={[{ borderRadius: 6, paddingHorizontal: 4, paddingVertical: 2 }, { backgroundColor: bg }]}>
      <Text style={[styles.heroScore, style]}>{score ?? '--'}</Text>
    </Animated.View>
  );
}

// ── Live pulsing dot ──────────────────────────────────────────────────────────

function PulsingDot() {
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale,   { toValue: 1.5, duration: 600, useNativeDriver: true }),
          Animated.timing(scale,   { toValue: 1,   duration: 600, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1,   duration: 600, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      style={[styles.liveDot, { transform: [{ scale }], opacity }]}
    />
  );
}

// ── Line score (quarter grid) ─────────────────────────────────────────────────

function LineScore({ quarters, awayAbbr, homeAbbr }) {
  if (!quarters) return null;
  const { away = [], home = [], hasOT } = quarters;
  const maxQ  = Math.max(away.length, home.length);
  const labels = [];
  for (let i = 0; i < maxQ; i++) {
    if (i < 4) labels.push(`Q${i + 1}`);
    else labels.push(`OT${i === 4 ? '' : i - 3}`);
  }
  const awayTotal = away.filter(s => s !== null).reduce((a, b) => a + (b || 0), 0);
  const homeTotal = home.filter(s => s !== null).reduce((a, b) => a + (b || 0), 0);

  return (
    <View style={styles.lineScoreCard}>
      {/* Header row */}
      <View style={styles.lsRow}>
        <Text style={[styles.lsTeamCell, styles.lsHeader]} />
        {labels.map(l => <Text key={l} style={[styles.lsQCell, styles.lsHeader]}>{l}</Text>)}
        <Text style={[styles.lsTotalCell, styles.lsHeader]}>T</Text>
      </View>
      {/* Divider */}
      <View style={styles.lsDivider} />
      {/* Away row */}
      <View style={styles.lsRow}>
        <Text style={[styles.lsTeamCell, styles.lsTeamLabel]}>{awayAbbr}</Text>
        {labels.map((_, i) => (
          <Text key={i} style={[styles.lsQCell, away[i] == null && styles.lsEmpty]}>
            {away[i] != null ? away[i] : '–'}
          </Text>
        ))}
        <Text style={[styles.lsTotalCell, awayTotal > homeTotal && styles.lsWinner]}>{awayTotal}</Text>
      </View>
      {/* Home row */}
      <View style={styles.lsRow}>
        <Text style={[styles.lsTeamCell, styles.lsTeamLabel]}>{homeAbbr}</Text>
        {labels.map((_, i) => (
          <Text key={i} style={[styles.lsQCell, home[i] == null && styles.lsEmpty]}>
            {home[i] != null ? home[i] : '–'}
          </Text>
        ))}
        <Text style={[styles.lsTotalCell, homeTotal > awayTotal && styles.lsWinner]}>{homeTotal}</Text>
      </View>
    </View>
  );
}

// ── Team stats summary bar ────────────────────────────────────────────────────

function TeamStatBar({ label, awayVal, homeVal, isPercent, higherIsBetter = true }) {
  const awayNum = parseFloat(awayVal) || 0;
  const homeNum = parseFloat(homeVal) || 0;
  const awayBetter = higherIsBetter ? awayNum >= homeNum : awayNum <= homeNum;
  const homeBetter = higherIsBetter ? homeNum > awayNum : homeNum < awayNum;

  return (
    <View style={styles.statBarRow}>
      <Text style={[styles.statBarVal, awayBetter && styles.statBarValBetter]}>
        {isPercent ? `${awayVal}%` : awayVal}
      </Text>
      <Text style={styles.statBarLabel}>{label}</Text>
      <Text style={[styles.statBarVal, homeBetter && styles.statBarValBetter]}>
        {isPercent ? `${homeVal}%` : homeVal}
      </Text>
    </View>
  );
}

function TeamStatsBlock({ awayStats, homeStats, awayAbbr, homeAbbr }) {
  if (!awayStats || !homeStats) return null;
  return (
    <View style={styles.teamStatsBlock}>
      <View style={styles.teamStatsHeader}>
        <Text style={styles.teamStatsAbbr}>{awayAbbr}</Text>
        <Text style={styles.teamStatsTitle}>Team Stats</Text>
        <Text style={styles.teamStatsAbbr}>{homeAbbr}</Text>
      </View>
      <TeamStatBar label="FG%" awayVal={awayStats.fgPct} homeVal={homeStats.fgPct} isPercent />
      <TeamStatBar label="3P%" awayVal={awayStats.threePct} homeVal={homeStats.threePct} isPercent />
      <TeamStatBar label="REB" awayVal={awayStats.reb} homeVal={homeStats.reb} />
      <TeamStatBar label="AST" awayVal={awayStats.ast} homeVal={homeStats.ast} />
      <TeamStatBar label="TOV" awayVal={awayStats.tov} homeVal={homeStats.tov} higherIsBetter={false} />
    </View>
  );
}

// ── Player row (expandable) ───────────────────────────────────────────────────

function PlayerRow({ player, isHeader, isTopPerformer, isExpanded, onPress, onPlayerPress }) {
  const fadeIn = useRef(new Animated.Value(isExpanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(fadeIn, {
      toValue: isExpanded ? 1 : 0,
      tension: 280,
      friction: 24,
      useNativeDriver: true,
    }).start();
  }, [isExpanded]);

  if (isHeader) {
    return (
      <View style={[styles.playerRow, styles.playerRowHeader]}>
        <Text style={[styles.pName, styles.pHeaderText]}>Player</Text>
        <Text style={[styles.pPos, styles.pHeaderText]}>POS</Text>
        <Text style={[styles.pMin, styles.pHeaderText]}>MIN</Text>
        <Text style={[styles.pStat, styles.pHeaderText]}>PTS</Text>
        <Text style={[styles.pStat, styles.pHeaderText]}>REB</Text>
        <Text style={[styles.pStat, styles.pHeaderText]}>AST</Text>
        <Text style={[styles.pStat, styles.pHeaderText]}>STL</Text>
        <Text style={[styles.pStat, styles.pHeaderText]}>BLK</Text>
        <Text style={[styles.pFG, styles.pHeaderText]}>FG</Text>
        <Text style={[styles.pFG, styles.pHeaderText]}>3P</Text>
        <Text style={[styles.pPM, styles.pHeaderText]}>+/-</Text>
      </View>
    );
  }

  const pmColor = player.pm > 0 ? colors.green : player.pm < 0 ? colors.red : colors.grey;
  const minDisplay = typeof player.min === 'string' ? player.min.split(':')[0] : (player.min || '0');

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.playerRow,
        isTopPerformer && styles.playerRowTop,
      ]}
    >
      {/* Main stat row */}
      <TouchableOpacity onPress={() => onPlayerPress?.(player.name)} activeOpacity={0.7} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
        <Text style={[styles.pName, styles.playerNameLink]} numberOfLines={1}>{player.name}</Text>
      </TouchableOpacity>
      <Text style={styles.pPos}>{player.pos}</Text>
      <Text style={styles.pMin}>{minDisplay}</Text>
      <Text style={[styles.pStat, styles.pPTS]}>{player.pts}</Text>
      <Text style={styles.pStat}>{player.reb}</Text>
      <Text style={styles.pStat}>{player.ast}</Text>
      <Text style={styles.pStat}>{player.stl ?? '--'}</Text>
      <Text style={styles.pStat}>{player.blk ?? '--'}</Text>
      <Text style={styles.pFG}>{player.fg}</Text>
      <Text style={styles.pFG}>{player.threeP ?? '--'}</Text>
      <Text style={[styles.pPM, { color: pmColor }]}>
        {player.pm > 0 ? `+${player.pm}` : player.pm}
      </Text>

      {/* Expandable advanced stats */}
      {isExpanded && (
        <Animated.View style={[styles.advancedRow, { opacity: fadeIn }]}>
          <View style={styles.advancedItem}>
            <Text style={styles.advancedVal}>{player.tov ?? 0}</Text>
            <Text style={styles.advancedLabel}>TOV</Text>
          </View>
          <View style={styles.advancedItem}>
            <Text style={styles.advancedVal}>{player.fg}</Text>
            <Text style={styles.advancedLabel}>FG</Text>
          </View>
          <View style={styles.advancedItem}>
            <Text style={styles.advancedVal}>{player.threeP}</Text>
            <Text style={styles.advancedLabel}>3PT</Text>
          </View>
          <View style={styles.advancedItem}>
            <Text style={styles.advancedVal}>{player.min}</Text>
            <Text style={styles.advancedLabel}>MIN</Text>
          </View>
        </Animated.View>
      )}
    </TouchableOpacity>
  );
}

// ── Player table ──────────────────────────────────────────────────────────────

function PlayerTable({ players, teamName, awayAbbr, onPlayerPress }) {
  const [expandedIdx, setExpandedIdx] = useState(null);

  const handlePress = (i) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedIdx(prev => (prev === i ? null : i));
  };

  if (!players || players.length === 0) return null;

  return (
    <View style={styles.playerBlock}>
      <Text style={styles.blockLabel}>{teamName}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ minWidth: SCREEN_WIDTH - spacing.md * 2 }}>
          <PlayerRow isHeader />
          {players.map((p, i) => (
            <PlayerRow
              key={i}
              player={p}
              isTopPerformer={i === 0}
              isExpanded={expandedIdx === i}
              onPress={() => handlePress(i)}
              onPlayerPress={onPlayerPress}
            />
          ))}
          {/* Totals row */}
          <View style={[styles.playerRow, styles.totalsRow]}>
            <Text style={[styles.pName, styles.totalsLabel]}>Team Totals</Text>
            <Text style={styles.pPos} />
            <Text style={styles.pMin} />
            <Text style={[styles.pStat, styles.pPTS]}>
              {players.reduce((s, p) => s + (p.pts || 0), 0)}
            </Text>
            <Text style={styles.pStat}>{players.reduce((s, p) => s + (p.reb || 0), 0)}</Text>
            <Text style={styles.pStat}>{players.reduce((s, p) => s + (p.ast || 0), 0)}</Text>
            <Text style={styles.pStat}>{players.reduce((s, p) => s + (p.stl || 0), 0)}</Text>
            <Text style={styles.pStat}>{players.reduce((s, p) => s + (p.blk || 0), 0)}</Text>
            <Text style={styles.pFG} />
            <Text style={styles.pFG} />
            <Text style={styles.pPM} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Box Score Tab ─────────────────────────────────────────────────────────────

function BoxScoreTab({ game, boxScore, loading, onPlayerPress }) {
  if (loading && !boxScore) return <SkeletonBoxScore />;

  if (!boxScore) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>📊</Text>
        <Text style={styles.emptyText}>
          {game.status === 'upcoming' ? 'Box score available at tip-off' : 'Box score unavailable'}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: spacing.md }}>
      {/* Line score */}
      <Text style={styles.sectionLabel}>Line Score</Text>
      <LineScore
        quarters={boxScore.quarters}
        awayAbbr={game.awayTeam.abbr}
        homeAbbr={game.homeTeam.abbr}
      />

      {/* Team stats */}
      <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Team Stats</Text>
      <TeamStatsBlock
        awayStats={boxScore.awayStats}
        homeStats={boxScore.homeStats}
        awayAbbr={game.awayTeam.abbr}
        homeAbbr={game.homeTeam.abbr}
      />

      {/* Player tables */}
      <PlayerTable
        players={boxScore.away?.players}
        teamName={game.awayTeam.name}
        awayAbbr={game.awayTeam.abbr}
        onPlayerPress={onPlayerPress}
      />
      <PlayerTable
        players={boxScore.home?.players}
        teamName={game.homeTeam.name}
        awayAbbr={game.homeTeam.abbr}
        onPlayerPress={onPlayerPress}
      />

      <View style={{ height: 40 }} />
    </View>
  );
}

// ── Play by Play Tab ──────────────────────────────────────────────────────────

function PlayRow({ play, isLive, isNew }) {
  const fadeIn = useRef(new Animated.Value(isNew ? 0 : 1)).current;

  useEffect(() => {
    if (isNew) {
      Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  }, []);

  const bgColor =
    play.type === 'score'    ? colors.green + '12' :
    play.type === 'turnover' ? colors.red   + '12' :
    play.type === 'foul'     ? '#FF990012'          :
    'transparent';

  const dotColor = play.teamAbbr ? colors.green : colors.grey;

  const hasScore = play.awayScore != null && play.homeScore != null;

  return (
    <Animated.View style={[styles.pbpRow, { backgroundColor: bgColor, opacity: fadeIn }]}>
      <View style={[styles.pbpDot, { backgroundColor: dotColor }]} />
      <Text style={[styles.pbpTime, isLive && { color: colors.red }]} numberOfLines={1}>
        {play.time}
      </Text>
      <Text style={styles.pbpEvent} numberOfLines={3}>{play.event}</Text>
      {hasScore && (
        <Text style={styles.pbpScore}>{play.awayScore}–{play.homeScore}</Text>
      )}
    </Animated.View>
  );
}

function PlayByPlayTab({ plays, loading, isLive, awayAbbr, homeAbbr }) {
  const scrollRef = useRef(null);
  const prevLen   = useRef(plays?.length || 0);

  useEffect(() => {
    if (isLive && plays?.length > 0 && plays.length !== prevLen.current) {
      prevLen.current = plays.length;
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [plays?.length]);

  if (loading && (!plays || plays.length === 0)) {
    return (
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm }}>
        {[1,2,3,4,5,6,7,8].map(i => (
          <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: 8 }}>
            <SkeletonBar width={8} height={8} style={{ borderRadius: 4 }} />
            <SkeletonBar width={64} height={12} />
            <SkeletonBar width="60%" height={12} />
          </View>
        ))}
      </View>
    );
  }

  if (!plays || plays.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>🏀</Text>
        <Text style={styles.emptyText}>Play-by-play available once game starts</Text>
      </View>
    );
  }

  // Group plays by quarter
  const groups = [];
  let currentQ = null;
  for (const play of plays) {
    const q = play.quarter;
    if (q !== currentQ) {
      currentQ = q;
      const qLabel = q == null ? '' : q <= 4 ? `Quarter ${q}` : `OT${q > 5 ? q - 4 : ''}`;
      groups.push({ label: qLabel, plays: [] });
    }
    groups[groups.length - 1]?.plays.push(play);
  }

  return (
    <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}>
      {isLive && (
        <View style={styles.pbpLiveHeader}>
          <PulsingDot />
          <Text style={styles.pbpLiveText}>Live Updates</Text>
        </View>
      )}
      {groups.map((group, gi) => (
        <View key={gi}>
          {group.label ? (
            <View style={styles.pbpQHeader}>
              <Text style={styles.pbpQLabel}>{group.label}</Text>
            </View>
          ) : null}
          {group.plays.map((play, pi) => (
            <PlayRow
              key={`${gi}-${pi}`}
              play={play}
              isLive={isLive}
              isNew={isLive && gi === 0 && pi < 3}
            />
          ))}
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ── Game Info Tab ─────────────────────────────────────────────────────────────

function Last5Row({ games, abbr, teamName }) {
  if (!games || games.length === 0) return null;
  return (
    <View style={styles.last5Block}>
      <Text style={styles.last5TeamName}>{teamName || abbr}</Text>
      <View style={styles.last5Pills}>
        {games.map((g, i) => (
          <View key={i} style={{ alignItems: 'center', gap: 4 }}>
            <View style={[styles.last5Pill, g.result === 'W' ? styles.last5Win : styles.last5Loss]}>
              <Text style={styles.last5PillText}>{g.result}</Text>
            </View>
            <Text style={styles.last5Opp} numberOfLines={1}>
              {g.isHome ? 'vs' : '@'} {g.opponent?.split(' ').pop()}
            </Text>
            <Text style={styles.last5Score}>{g.teamScore}–{g.oppScore}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function HeadToHeadRow({ game, awayAbbr, homeAbbr }) {
  return (
    <View style={styles.h2hRow}>
      <Text style={styles.h2hDate}>{game.date}</Text>
      <View style={styles.h2hResult}>
        <Text style={[styles.h2hTeam, game.awayWon && styles.h2hWinner]}>{game.awayAbbr}</Text>
        <Text style={styles.h2hScoreText}>{game.awayScore} – {game.homeScore}</Text>
        <Text style={[styles.h2hTeam, !game.awayWon && styles.h2hWinner]}>{game.homeAbbr}</Text>
      </View>
    </View>
  );
}

function InjuryRow({ player }) {
  const statusColor =
    (player.status || '').toLowerCase() === 'out' ? colors.red :
    (player.status || '').toLowerCase() === 'questionable' ? '#FF9900' :
    colors.grey;
  return (
    <View style={styles.injuryRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.injuryName}>{player.name}</Text>
        {!!player.description && (
          <Text style={styles.injuryDesc} numberOfLines={2}>{player.description}</Text>
        )}
      </View>
      <Text style={[styles.injuryStatus, { color: statusColor }]}>{player.status}</Text>
    </View>
  );
}

function GameInfoTab({ game, gameInfo, loading, weather, goalieMatchup }) {
  if (loading && !gameInfo) {
    return (
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md }}>
        <SkeletonBar height={16} width="40%" />
        <SkeletonBar height={12} width="70%" />
        <SkeletonBar height={12} width="55%" />
        <SkeletonBar height={16} width="40%" style={{ marginTop: spacing.md }} />
        <SkeletonBar height={60} />
        <SkeletonBar height={16} width="40%" style={{ marginTop: spacing.md }} />
        <SkeletonBar height={60} />
      </View>
    );
  }

  const { arena, arenaCity, officials = [], awayInjuries = [], homeInjuries = [],
    awayLast5 = [], homeLast5 = [], headToHead = [] } = gameInfo || {};

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ paddingHorizontal: spacing.md }}>
      {/* Venue */}
      {(arena || arenaCity) && (
        <View style={styles.infoSection}>
          <Text style={styles.infoSectionLabel}>Venue</Text>
          {!!arena     && <Text style={styles.infoVal}>{arena}</Text>}
          {!!arenaCity && <Text style={styles.infoSubVal}>{arenaCity}</Text>}
        </View>
      )}

      {/* NHL Goalie Matchup */}
      {goalieMatchup && (
        <View style={styles.infoSection}>
          <Text style={styles.infoSectionLabel}>Goalie Matchup</Text>
          <NHLGoalieMatchup
            goalieMatchup={goalieMatchup}
            awayAbbr={game.awayTeam.abbr}
            homeAbbr={game.homeTeam.abbr}
          />
        </View>
      )}

      {/* Weather (MLB only) */}
      {weather && (
        <View style={styles.infoSection}>
          <Text style={styles.infoSectionLabel}>Weather</Text>
          <WeatherBlock weather={weather} />
        </View>
      )}

      {/* Last 5 Games */}
      {(awayLast5.length > 0 || homeLast5.length > 0) && (
        <View style={styles.infoSection}>
          <Text style={styles.infoSectionLabel}>Last 5 Games</Text>
          <Last5Row games={awayLast5} abbr={game.awayTeam.abbr} teamName={game.awayTeam.name} />
          <Last5Row games={homeLast5} abbr={game.homeTeam.abbr} teamName={game.homeTeam.name} />
        </View>
      )}

      {/* Head to Head */}
      {headToHead.length > 0 && (
        <View style={styles.infoSection}>
          <Text style={styles.infoSectionLabel}>Head to Head</Text>
          {headToHead.map((g, i) => (
            <HeadToHeadRow key={i} game={g} awayAbbr={game.awayTeam.abbr} homeAbbr={game.homeTeam.abbr} />
          ))}
        </View>
      )}

      {/* Injuries */}
      {(awayInjuries.length > 0 || homeInjuries.length > 0) && (
        <View style={styles.infoSection}>
          <Text style={styles.infoSectionLabel}>Injuries</Text>
          {awayInjuries.length > 0 && (
            <>
              <Text style={styles.injuryTeamHeader}>{game.awayTeam.name}</Text>
              {awayInjuries.map((p, i) => <InjuryRow key={i} player={p} />)}
            </>
          )}
          {homeInjuries.length > 0 && (
            <>
              <Text style={[styles.injuryTeamHeader, awayInjuries.length > 0 && { marginTop: spacing.sm }]}>
                {game.homeTeam.name}
              </Text>
              {homeInjuries.map((p, i) => <InjuryRow key={i} player={p} />)}
            </>
          )}
        </View>
      )}

      {/* Officials */}
      {officials.length > 0 && (
        <View style={styles.infoSection}>
          <Text style={styles.infoSectionLabel}>Officials</Text>
          <Text style={styles.infoVal}>{officials.join(', ')}</Text>
        </View>
      )}

      {!gameInfo && !loading && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Game information unavailable</Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ── MLB-SPECIFIC COMPONENTS ──────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

// Base runner diamond: filled circle = runner on base
function BasesDiamond({ firstBase, secondBase, thirdBase }) {
  const CONTAINER = 80;
  const BASE_SIZE = 18;
  // Diamond positions (centered in 80x80)
  // Rotated square outline: 46x46 rotated 45° centered at (40,40)
  // Corners: Top=(40,12), Right=(68,40), Bottom=(40,68), Left=(12,40)
  const bases = [
    { key: '2b', occupied: secondBase, left: 40 - BASE_SIZE / 2, top: 12 - BASE_SIZE / 2 },  // 2B top
    { key: '1b', occupied: firstBase,  left: 68 - BASE_SIZE / 2, top: 40 - BASE_SIZE / 2 },  // 1B right
    { key: '3b', occupied: thirdBase,  left: 12 - BASE_SIZE / 2, top: 40 - BASE_SIZE / 2 },  // 3B left
  ];

  return (
    <View style={{ width: CONTAINER, height: CONTAINER, position: 'relative' }}>
      {/* Diamond outline */}
      <View style={{
        position: 'absolute',
        width: 46,
        height: 46,
        top: 40 - 23,
        left: 40 - 23,
        borderWidth: 1.5,
        borderColor: colors.border,
        transform: [{ rotate: '45deg' }],
      }} />
      {/* Home plate marker */}
      <View style={{
        position: 'absolute',
        width: 10,
        height: 10,
        borderRadius: 2,
        backgroundColor: colors.border,
        left: 40 - 5,
        top: 68 - 5,
      }} />
      {/* Base circles */}
      {bases.map(b => (
        <View
          key={b.key}
          style={{
            position: 'absolute',
            width: BASE_SIZE,
            height: BASE_SIZE,
            borderRadius: BASE_SIZE / 2,
            backgroundColor: b.occupied ? colors.green : colors.surfaceAlt,
            borderWidth: 1.5,
            borderColor: b.occupied ? colors.green : colors.border,
            left: b.left,
            top: b.top,
          }}
        />
      ))}
    </View>
  );
}

// Balls / Strikes / Outs dot indicators
function BSO({ balls, strikes, outs }) {
  const Dot = ({ filled, color }) => (
    <View style={{
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: filled ? color : 'transparent',
      borderWidth: 1.5,
      borderColor: filled ? color : colors.border,
    }} />
  );

  const Row = ({ label, count, total, color }) => (
    <View style={{ alignItems: 'center', gap: 5 }}>
      <Text style={mlbStyles.bsoLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {Array.from({ length: total }, (_, i) => (
          <Dot key={i} filled={i < count} color={color} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={mlbStyles.bsoRow}>
      <Row label="B" count={balls  ?? 0} total={3} color={colors.green} />
      <Row label="S" count={strikes ?? 0} total={2} color={colors.red}   />
      <Row label="O" count={outs   ?? 0} total={3} color={colors.red}   />
    </View>
  );
}

// Full MLB live panel: inning indicator + bases + BSO + current players
function MLBLivePanel({ liveState, awayAbbr, homeAbbr }) {
  if (!liveState) return null;
  const { inning, inningHalf, balls, strikes, outs,
    firstBase, secondBase, thirdBase, currentPitcher, currentHitter } = liveState;

  const isTop    = (inningHalf || 'T') === 'T';
  const arrow    = isTop ? '▲' : '▼';
  const halfLabel = isTop ? 'TOP' : 'BOT';
  const battingTeam = isTop ? awayAbbr : homeAbbr;

  return (
    <View style={mlbStyles.livePanel}>
      {/* Inning indicator */}
      <View style={mlbStyles.inningBlock}>
        <Text style={mlbStyles.inningArrow}>{arrow}</Text>
        <Text style={mlbStyles.inningNumber}>{inning || '--'}</Text>
        <Text style={mlbStyles.inningHalf}>{halfLabel}</Text>
      </View>

      {/* Vertical divider */}
      <View style={mlbStyles.panelDivider} />

      {/* Bases diamond */}
      <BasesDiamond
        firstBase={firstBase}
        secondBase={secondBase}
        thirdBase={thirdBase}
      />

      {/* Vertical divider */}
      <View style={mlbStyles.panelDivider} />

      {/* BSO + players */}
      <View style={{ flex: 1, gap: 8 }}>
        <BSO balls={balls} strikes={strikes} outs={outs} />
        {(currentHitter || currentPitcher) && (
          <View style={{ gap: 3 }}>
            {!!currentHitter && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={mlbStyles.playerDot}>⚾</Text>
                <Text style={mlbStyles.playerLabel} numberOfLines={1}>{currentHitter}</Text>
              </View>
            )}
            {!!currentPitcher && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={mlbStyles.playerDot}>🤾</Text>
                <Text style={mlbStyles.playerLabel} numberOfLines={1}>{currentPitcher}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// ── MLB Box Score Tab ─────────────────────────────────────────────────────────

function MLBInningLineScore({ innings, awayAbbr, homeAbbr, awayRHE, homeRHE }) {
  // Show up to 9 innings, plus extras
  const maxInning = Math.max(9, innings.length);
  const inningNums = Array.from({ length: maxInning }, (_, i) => i + 1);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={mlbStyles.lineScoreTable}>
        {/* Header row */}
        <View style={mlbStyles.lsRow}>
          <Text style={[mlbStyles.lsTeam, mlbStyles.lsHeaderText]} />
          {inningNums.map(n => (
            <Text key={n} style={[mlbStyles.lsCell, mlbStyles.lsHeaderText]}>{n}</Text>
          ))}
          <Text style={[mlbStyles.lsRHE, mlbStyles.lsHeaderText]}>R</Text>
          <Text style={[mlbStyles.lsRHE, mlbStyles.lsHeaderText]}>H</Text>
          <Text style={[mlbStyles.lsRHE, mlbStyles.lsHeaderText]}>E</Text>
        </View>
        {/* Divider */}
        <View style={mlbStyles.lsDivider} />
        {/* Away row */}
        <View style={mlbStyles.lsRow}>
          <Text style={[mlbStyles.lsTeam, mlbStyles.lsTeamText]}>{awayAbbr}</Text>
          {inningNums.map(n => {
            const inn = innings.find(i => i.number === n);
            return (
              <Text key={n} style={[mlbStyles.lsCell, inn == null && mlbStyles.lsEmpty]}>
                {inn ? (inn.away ?? '×') : '–'}
              </Text>
            );
          })}
          <Text style={[mlbStyles.lsRHE, mlbStyles.lsRHEWin]}>{awayRHE?.r ?? '--'}</Text>
          <Text style={mlbStyles.lsRHE}>{awayRHE?.h ?? '--'}</Text>
          <Text style={mlbStyles.lsRHE}>{awayRHE?.e ?? '--'}</Text>
        </View>
        {/* Home row */}
        <View style={mlbStyles.lsRow}>
          <Text style={[mlbStyles.lsTeam, mlbStyles.lsTeamText]}>{homeAbbr}</Text>
          {inningNums.map(n => {
            const inn = innings.find(i => i.number === n);
            return (
              <Text key={n} style={[mlbStyles.lsCell, inn == null && mlbStyles.lsEmpty]}>
                {inn ? (inn.home ?? '×') : '–'}
              </Text>
            );
          })}
          <Text style={[mlbStyles.lsRHE, mlbStyles.lsRHEWin]}>{homeRHE?.r ?? '--'}</Text>
          <Text style={mlbStyles.lsRHE}>{homeRHE?.h ?? '--'}</Text>
          <Text style={mlbStyles.lsRHE}>{homeRHE?.e ?? '--'}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function MLBBattingTable({ batters, totals, teamName, onPlayerPress }) {
  if (!batters || batters.length === 0) return null;
  return (
    <View style={mlbStyles.tableBlock}>
      <Text style={mlbStyles.tableTeamName}>{teamName} — Batting</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Header */}
          <View style={mlbStyles.statRow}>
            <Text style={[mlbStyles.batName, mlbStyles.hdr]}>PLAYER</Text>
            <Text style={[mlbStyles.batSm, mlbStyles.hdr]}>AB</Text>
            <Text style={[mlbStyles.batSm, mlbStyles.hdr]}>R</Text>
            <Text style={[mlbStyles.batSm, mlbStyles.hdr]}>H</Text>
            <Text style={[mlbStyles.batSm, mlbStyles.hdr]}>RBI</Text>
            <Text style={[mlbStyles.batSm, mlbStyles.hdr]}>BB</Text>
            <Text style={[mlbStyles.batSm, mlbStyles.hdr]}>SO</Text>
            <Text style={[mlbStyles.batAvg, mlbStyles.hdr]}>AVG</Text>
          </View>
          {batters.map((p, i) => (
            <View key={i} style={[mlbStyles.statRow, i % 2 === 0 && mlbStyles.rowAlt]}>
              <TouchableOpacity onPress={() => onPlayerPress?.(p.name)} activeOpacity={0.7}>
                <Text style={[mlbStyles.batName, mlbStyles.playerNameLink]} numberOfLines={1}>{p.name}</Text>
              </TouchableOpacity>
              <Text style={mlbStyles.batSm}>{p.ab}</Text>
              <Text style={mlbStyles.batSm}>{p.r}</Text>
              <Text style={[mlbStyles.batSm, p.h > 0 && mlbStyles.hitHighlight]}>{p.h}</Text>
              <Text style={[mlbStyles.batSm, p.rbi > 0 && mlbStyles.rbiHighlight]}>{p.rbi}</Text>
              <Text style={mlbStyles.batSm}>{p.bb}</Text>
              <Text style={mlbStyles.batSm}>{p.so}</Text>
              <Text style={mlbStyles.batAvg}>{p.avg}</Text>
            </View>
          ))}
          {/* Totals */}
          {totals && (
            <View style={[mlbStyles.statRow, mlbStyles.totalsRow]}>
              <Text style={[mlbStyles.batName, mlbStyles.totalsLabel]}>Totals</Text>
              <Text style={mlbStyles.batSm}>{totals.ab}</Text>
              <Text style={mlbStyles.batSm}>{totals.r}</Text>
              <Text style={mlbStyles.batSm}>{totals.h}</Text>
              <Text style={mlbStyles.batSm}>{totals.rbi}</Text>
              <Text style={mlbStyles.batSm}>{totals.bb}</Text>
              <Text style={mlbStyles.batSm}>{totals.so}</Text>
              <Text style={mlbStyles.batAvg}>{totals.avg}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function MLBPitchingTable({ pitchers, teamName, onPlayerPress }) {
  if (!pitchers || pitchers.length === 0) return null;
  return (
    <View style={mlbStyles.tableBlock}>
      <Text style={mlbStyles.tableTeamName}>{teamName} — Pitching</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Header */}
          <View style={mlbStyles.statRow}>
            <Text style={[mlbStyles.pitName, mlbStyles.hdr]}>PITCHER</Text>
            <Text style={[mlbStyles.pitSm, mlbStyles.hdr]}>IP</Text>
            <Text style={[mlbStyles.pitSm, mlbStyles.hdr]}>H</Text>
            <Text style={[mlbStyles.pitSm, mlbStyles.hdr]}>R</Text>
            <Text style={[mlbStyles.pitSm, mlbStyles.hdr]}>ER</Text>
            <Text style={[mlbStyles.pitSm, mlbStyles.hdr]}>BB</Text>
            <Text style={[mlbStyles.pitSm, mlbStyles.hdr]}>K</Text>
            <Text style={[mlbStyles.pitEra, mlbStyles.hdr]}>ERA</Text>
            <Text style={[mlbStyles.pitPc, mlbStyles.hdr]}>PC</Text>
          </View>
          {pitchers.map((p, i) => {
            const decisionColor =
              p.decision === 'W' ? colors.green :
              p.decision === 'L' ? colors.red   : colors.grey;
            return (
              <View key={i} style={[
                mlbStyles.statRow,
                p.isStarter && mlbStyles.starterRow,
                i % 2 === 0 && !p.isStarter && mlbStyles.rowAlt,
              ]}>
                <View style={mlbStyles.pitName}>
                  <TouchableOpacity onPress={() => onPlayerPress?.(p.name)} activeOpacity={0.7}>
                    <Text style={[mlbStyles.pitNameText, p.isStarter && mlbStyles.starterText, mlbStyles.playerNameLink]} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                  {!!p.decision && (
                    <Text style={[mlbStyles.decisionBadge, { color: decisionColor }]}>
                      {p.decision}
                    </Text>
                  )}
                </View>
                <Text style={mlbStyles.pitSm}>{p.ip}</Text>
                <Text style={mlbStyles.pitSm}>{p.h}</Text>
                <Text style={mlbStyles.pitSm}>{p.r}</Text>
                <Text style={mlbStyles.pitSm}>{p.er}</Text>
                <Text style={mlbStyles.pitSm}>{p.bb}</Text>
                <Text style={[mlbStyles.pitSm, p.so >= 8 && mlbStyles.kHighlight]}>{p.so}</Text>
                <Text style={mlbStyles.pitEra}>{p.era}</Text>
                <Text style={mlbStyles.pitPc}>{p.pitches > 0 ? p.pitches : '--'}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function MLBBoxScoreTab({ game, boxScore, loading, onPlayerPress }) {
  if (loading && !boxScore) {
    return (
      <View style={{ padding: spacing.md, gap: spacing.md }}>
        <SkeletonBar height={16} width="40%" />
        <SkeletonBar height={44} />
        <SkeletonBar height={16} width="40%" style={{ marginTop: spacing.md }} />
        {[...Array(5)].map((_, i) => <SkeletonBar key={i} height={38} />)}
      </View>
    );
  }

  if (!boxScore) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>⚾</Text>
        <Text style={styles.emptyText}>
          {game.status === 'upcoming' ? 'Box score available at first pitch' : 'Box score unavailable'}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: spacing.md }}>
      {/* Inning line score */}
      <Text style={styles.sectionLabel}>Line Score</Text>
      <MLBInningLineScore
        innings={boxScore.innings || []}
        awayAbbr={game.awayTeam.abbr}
        homeAbbr={game.homeTeam.abbr}
        awayRHE={boxScore.awayRHE}
        homeRHE={boxScore.homeRHE}
      />

      {/* Batting tables */}
      <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Batting</Text>
      <MLBBattingTable batters={boxScore.away?.batters} totals={boxScore.away?.totals} teamName={game.awayTeam.name} onPlayerPress={onPlayerPress} />
      <MLBBattingTable batters={boxScore.home?.batters} totals={boxScore.home?.totals} teamName={game.homeTeam.name} onPlayerPress={onPlayerPress} />

      {/* Pitching tables */}
      <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Pitching</Text>
      <MLBPitchingTable pitchers={boxScore.away?.pitchers} teamName={game.awayTeam.name} onPlayerPress={onPlayerPress} />
      <MLBPitchingTable pitchers={boxScore.home?.pitchers} teamName={game.homeTeam.name} onPlayerPress={onPlayerPress} />

      <View style={{ height: 40 }} />
    </View>
  );
}

// ── MLB Play by Play ──────────────────────────────────────────────────────────

const MLB_PLAY_CONFIG = {
  hr:         { bg: colors.green + '25', label: 'HR',  labelColor: colors.green,  icon: '🚀' },
  '3b':       { bg: colors.green + '15', label: '3B',  labelColor: colors.green,  icon: '🔥' },
  '2b':       { bg: colors.green + '10', label: '2B',  labelColor: colors.green,  icon: '✅' },
  '1b':       { bg: 'transparent',       label: '1B',  labelColor: colors.greyLight, icon: '✅' },
  bb:         { bg: '#FF990010',         label: 'BB',  labelColor: '#FF9900',     icon: '🚶' },
  k:          { bg: colors.red + '12',   label: 'K',   labelColor: colors.red,    icon: '❌' },
  flyout:     { bg: 'transparent',       label: 'FO',  labelColor: colors.grey,   icon: '💨' },
  groundout:  { bg: 'transparent',       label: 'GO',  labelColor: colors.grey,   icon: '⬇️' },
  lineout:    { bg: 'transparent',       label: 'LO',  labelColor: colors.grey,   icon: '➡️' },
  sacfly:     { bg: 'transparent',       label: 'SF',  labelColor: colors.grey,   icon: '✈️' },
  sac:        { bg: 'transparent',       label: 'SH',  labelColor: colors.grey,   icon: '🔄' },
  out:        { bg: 'transparent',       label: 'OUT', labelColor: colors.grey,   icon: '⚾' },
  score:      { bg: colors.green + '12', label: '●',   labelColor: colors.green,  icon: '✅' },
  normal:     { bg: 'transparent',       label: '·',   labelColor: colors.grey,   icon: '' },
};

function MLBPlayRow({ play, isNew }) {
  const fadeIn = useRef(new Animated.Value(isNew ? 0 : 1)).current;
  useEffect(() => {
    if (isNew) Animated.timing(fadeIn, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const config = MLB_PLAY_CONFIG[play.type] || MLB_PLAY_CONFIG.normal;
  const hasScore = play.awayScore != null && play.homeScore != null;

  return (
    <Animated.View style={[mlbStyles.mlbPlayRow, { backgroundColor: config.bg, opacity: fadeIn }]}>
      {/* Play type badge */}
      <View style={[mlbStyles.playTypeBadge, { borderColor: config.labelColor + '55' }]}>
        <Text style={[mlbStyles.playTypeText, { color: config.labelColor }]}>{config.label}</Text>
      </View>
      {/* Time */}
      <Text style={mlbStyles.playTime}>{play.time}</Text>
      {/* Description */}
      <Text style={[mlbStyles.playEvent, play.isScoring && mlbStyles.scoringPlay]} numberOfLines={3}>
        {play.event}
      </Text>
      {/* Running score */}
      {hasScore && (
        <Text style={mlbStyles.playScore}>{play.awayScore}–{play.homeScore}</Text>
      )}
    </Animated.View>
  );
}

// ── MLB Game Info Tab extras (weather) ────────────────────────────────────────

function WeatherBlock({ weather }) {
  if (!weather) return null;
  const windStr = weather.windSpeed != null
    ? `${weather.windSpeed} mph ${weather.windDirection || ''}`.trim()
    : weather.windDirection || '';
  return (
    <View style={mlbStyles.weatherBlock}>
      {weather.tempF != null && (
        <View style={mlbStyles.weatherItem}>
          <Text style={mlbStyles.weatherIcon}>🌡</Text>
          <Text style={mlbStyles.weatherVal}>{weather.tempF}°F</Text>
        </View>
      )}
      {!!windStr && (
        <View style={mlbStyles.weatherItem}>
          <Text style={mlbStyles.weatherIcon}>💨</Text>
          <Text style={mlbStyles.weatherVal}>{windStr}</Text>
        </View>
      )}
      {!!weather.condition && (
        <View style={mlbStyles.weatherItem}>
          <Text style={mlbStyles.weatherIcon}>☁️</Text>
          <Text style={mlbStyles.weatherVal}>{weather.condition}</Text>
        </View>
      )}
      {weather.humidity != null && (
        <View style={mlbStyles.weatherItem}>
          <Text style={mlbStyles.weatherIcon}>💧</Text>
          <Text style={mlbStyles.weatherVal}>{weather.humidity}% humidity</Text>
        </View>
      )}
    </View>
  );
}

// ── MLB-specific styles ───────────────────────────────────────────────────────
const mlbStyles = StyleSheet.create({
  // Live panel
  livePanel: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  inningBlock: {
    alignItems: 'center',
    minWidth: 44,
  },
  inningArrow: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.red,
  },
  inningNumber: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.offWhite,
    lineHeight: 30,
  },
  inningHalf: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.grey,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  panelDivider: {
    width: 1,
    height: 72,
    backgroundColor: colors.border,
  },
  // BSO
  bsoRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  bsoLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.grey,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  playerDot: {
    fontSize: 12,
  },
  playerLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.offWhite,
    flex: 1,
  },

  // MLB Line score
  lineScoreTable: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
  },
  lsHeaderText: {
    color: colors.grey,
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'uppercase',
  },
  lsTeam: {
    width: 38,
    fontSize: 13,
    fontWeight: '700',
    color: colors.offWhite,
  },
  lsTeamText: {
    color: colors.offWhite,
  },
  lsCell: {
    width: 22,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '500',
    color: colors.offWhite,
  },
  lsEmpty: {
    color: colors.grey,
  },
  lsRHE: {
    width: 26,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey,
  },
  lsRHEWin: {
    fontWeight: '800',
    color: colors.offWhite,
  },
  lsDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },

  // Stat tables (shared batting/pitching)
  tableBlock: {
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tableTeamName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '44',
  },
  rowAlt: {
    backgroundColor: colors.surfaceAlt + '44',
  },
  hdr: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  totalsRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 0,
    paddingTop: 10,
  },
  totalsLabel: {
    fontWeight: '700',
    color: colors.grey,
    fontSize: 12,
  },

  playerNameLink: {
    textDecorationLine: 'underline',
    textDecorationColor: '#3a3a3a',
    textDecorationStyle: 'solid',
  },

  // Batting columns
  batName: {
    width: 120,
    fontSize: 13,
    fontWeight: '500',
    color: colors.offWhite,
    paddingRight: 6,
  },
  batSm: {
    width: 32,
    fontSize: 13,
    color: colors.offWhite,
    textAlign: 'center',
  },
  batAvg: {
    width: 44,
    fontSize: 12,
    color: colors.greyLight,
    textAlign: 'right',
  },
  hitHighlight: {
    color: colors.green,
    fontWeight: '700',
  },
  rbiHighlight: {
    color: colors.green,
    fontWeight: '700',
  },

  // Pitching columns
  pitName: {
    width: 130,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingRight: 4,
  },
  pitNameText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.offWhite,
    flex: 1,
  },
  starterRow: {
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
    paddingLeft: 4,
  },
  starterText: {
    fontWeight: '700',
  },
  decisionBadge: {
    fontSize: 11,
    fontWeight: '800',
  },
  pitSm: {
    width: 28,
    fontSize: 13,
    color: colors.offWhite,
    textAlign: 'center',
  },
  pitEra: {
    width: 44,
    fontSize: 12,
    color: colors.greyLight,
    textAlign: 'center',
  },
  pitPc: {
    width: 32,
    fontSize: 12,
    color: colors.grey,
    textAlign: 'right',
  },
  kHighlight: {
    color: colors.green,
    fontWeight: '700',
  },

  // MLB Play by play
  mlbPlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '44',
    gap: spacing.sm,
  },
  playTypeBadge: {
    width: 34,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playTypeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  playTime: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.red,
    width: 36,
    flexShrink: 0,
  },
  playEvent: {
    flex: 1,
    fontSize: 12,
    color: colors.offWhite,
    lineHeight: 18,
  },
  scoringPlay: {
    fontWeight: '700',
    color: colors.offWhite,
  },
  playScore: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.grey,
    width: 40,
    textAlign: 'right',
    flexShrink: 0,
  },

  // Weather
  weatherBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  weatherItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  weatherIcon: {
    fontSize: 16,
    width: 24,
  },
  weatherVal: {
    fontSize: 14,
    color: colors.offWhite,
    fontWeight: '500',
  },
});

// ════════════════════════════════════════════════════════════════════════════
// ── PRE-MATCH COMPONENTS ──────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

// W/L pill with stagger entrance animation
function WLPill({ result, teamScore, oppScore, opponent, index }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const delay = (index || 0) * 80;
    setTimeout(() => {
      Animated.parallel([
        Animated.spring(scale,   { toValue: 1, tension: 280, friction: 20, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 220,              useNativeDriver: true }),
      ]).start();
    }, delay);
  }, []);

  const isWin = result === 'W';
  const oppShort = opponent ? (opponent.split(' ').slice(-1)[0] || opponent) : '';

  return (
    <Animated.View style={[preStyles.wlPill, isWin ? preStyles.wlWin : preStyles.wlLoss, { opacity, transform: [{ scale }] }]}>
      <Text style={[preStyles.wlLetter, { color: isWin ? colors.green : colors.red }]}>{result}</Text>
      {(teamScore != null && oppScore != null) && (
        <Text style={preStyles.wlScore}>{teamScore}–{oppScore}</Text>
      )}
      <Text style={preStyles.wlOpp} numberOfLines={1}>{oppShort}</Text>
    </Animated.View>
  );
}

// ── Season Series Badge (H2H) ─────────────────────────────────────────────────
function SeasonSeriesBadge({ series, awayAbbr, homeAbbr }) {
  if (!series || series.totalGames === 0) return null;
  const { awayWins, homeWins, totalGames } = series;
  let summaryText;
  if (awayWins > homeWins)       summaryText = `${awayAbbr} leads series ${awayWins}-${homeWins}`;
  else if (homeWins > awayWins)  summaryText = `${homeAbbr} leads series ${homeWins}-${awayWins}`;
  else                           summaryText = `Series tied ${awayWins}-${homeWins}`;

  return (
    <View style={preStyles.seriesBadge}>
      <Text style={preStyles.seriesText}>{summaryText}</Text>
      <Text style={preStyles.seriesSub}>({totalGames} meeting{totalGames !== 1 ? 's' : ''} this season)</Text>
    </View>
  );
}

// ── Rest Days Row ─────────────────────────────────────────────────────────────
function RestDaysRow({ awayAbbr, homeAbbr, awayRest, homeRest }) {
  if (awayRest == null && homeRest == null) return null;
  const restLabel = (days, abbr) => {
    if (days == null) return null;
    const isB2B    = days <= 1;
    const label    = days === 0 ? 'Playing today'
      : days === 1 ? `${abbr} B2B`
      : `${abbr}: ${days} days rest`;
    return { label, isB2B };
  };
  const away = restLabel(awayRest, awayAbbr);
  const home = restLabel(homeRest, homeAbbr);
  return (
    <View style={preStyles.restRow}>
      {away && (
        <View style={[preStyles.restBadge, away.isB2B && preStyles.restB2B]}>
          <Text style={[preStyles.restText, away.isB2B && preStyles.restB2BText]}>{away.isB2B ? '⚠ ' : ''}{away.label}</Text>
        </View>
      )}
      {home && (
        <View style={[preStyles.restBadge, home.isB2B && preStyles.restB2B]}>
          <Text style={[preStyles.restText, home.isB2B && preStyles.restB2BText]}>{home.isB2B ? '⚠ ' : ''}{home.label}</Text>
        </View>
      )}
    </View>
  );
}

// ── MLB Pitcher Card ──────────────────────────────────────────────────────────
function PitcherCard({ pitcher, abbr, isHome }) {
  if (!pitcher) return (
    <View style={[preStyles.pitcherCard, isHome && { alignItems: 'flex-end' }]}>
      <Text style={preStyles.pitcherName}>TBD</Text>
      <Text style={preStyles.pitcherSub}>Starter not announced</Text>
    </View>
  );
  const record   = `${pitcher.wins ?? '--'}-${pitcher.losses ?? '--'}`;
  const last3Str = pitcher.last3?.length > 0 ? pitcher.last3.join(' | ') : '--';
  return (
    <View style={[preStyles.pitcherCard, isHome && { alignItems: 'flex-end' }]}>
      <Text style={preStyles.pitcherTeam}>{abbr}</Text>
      <Text style={preStyles.pitcherName} numberOfLines={2}>{pitcher.name}</Text>
      <Text style={preStyles.pitcherHand}>{pitcher.hand === 'L' ? 'LHP' : pitcher.hand === 'R' ? 'RHP' : ''}</Text>
      <View style={[preStyles.pitcherStats, isHome && { justifyContent: 'flex-end' }]}>
        {[
          { v: pitcher.era,  l: 'ERA'  },
          { v: pitcher.whip, l: 'WHIP' },
          { v: pitcher.k9,   l: 'K/9'  },
        ].map(s => (
          <View key={s.l} style={preStyles.pitcherStat}>
            <Text style={preStyles.pitcherStatVal}>{s.v}</Text>
            <Text style={preStyles.pitcherStatLbl}>{s.l}</Text>
          </View>
        ))}
      </View>
      <Text style={preStyles.pitcherRecord}>{record} · Last 3: {last3Str}</Text>
    </View>
  );
}

// ── NHL Goalie Card ───────────────────────────────────────────────────────────
function GoalieCard({ goalie, abbr, isHome }) {
  if (!goalie) return (
    <View style={[preStyles.pitcherCard, isHome && { alignItems: 'flex-end' }]}>
      <Text style={preStyles.pitcherName}>TBD</Text>
      <Text style={preStyles.pitcherSub}>Starter not confirmed</Text>
    </View>
  );
  const record = (goalie.wins != null && goalie.losses != null)
    ? `${goalie.wins}-${goalie.losses}-${goalie.otLosses ?? 0}`
    : '--';
  return (
    <View style={[preStyles.pitcherCard, isHome && { alignItems: 'flex-end' }]}>
      <Text style={preStyles.pitcherTeam}>{abbr}</Text>
      <Text style={preStyles.pitcherName} numberOfLines={2}>{goalie.name}</Text>
      {!goalie.confirmed && <Text style={[preStyles.pitcherHand, { color: '#FF9900' }]}>Unconfirmed</Text>}
      <View style={[preStyles.pitcherStats, isHome && { justifyContent: 'flex-end' }]}>
        {[
          { v: goalie.svPct, l: 'SV%'  },
          { v: goalie.gaa,   l: 'GAA'  },
          { v: record,       l: 'REC'  },
        ].map(s => (
          <View key={s.l} style={preStyles.pitcherStat}>
            <Text style={preStyles.pitcherStatVal}>{s.v ?? '--'}</Text>
            <Text style={preStyles.pitcherStatLbl}>{s.l}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Weather Widget ────────────────────────────────────────────────────────────
const WEATHER_ICONS = { 0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️', 45: '🌫', 61: '🌧', 63: '🌧', 71: '🌨', 80: '🌦', 95: '⛈' };
function weatherIcon(code) {
  if (code == null) return '🌡';
  if (code <= 1)  return '☀️';
  if (code <= 3)  return '⛅';
  if (code <= 49) return '🌫';
  if (code <= 67) return '🌧';
  if (code <= 77) return '🌨';
  if (code <= 82) return '🌦';
  return '⛈';
}

function WeatherWidget({ weather }) {
  if (!weather) return null;

  const parkColor =
    weather.parkColor === 'green' ? colors.green :
    weather.parkColor === 'blue'  ? '#4A90D9'    : colors.grey;

  return (
    <View style={preStyles.weatherCard}>
      <View style={preStyles.weatherVenueRow}>
        <Text style={preStyles.weatherVenue}>{weather.venueName}</Text>
        <Text style={preStyles.weatherCity}>{weather.venueCity}</Text>
      </View>
      <View style={[preStyles.parkFactorBadge, { backgroundColor: parkColor + '22', borderColor: parkColor + '66' }]}>
        <Text style={[preStyles.parkFactorText, { color: parkColor }]}>{weather.parkLabel}</Text>
        <Text style={preStyles.parkFactorFactor}>HR Factor {weather.parkFactor?.toFixed(2)}</Text>
      </View>
      {weather.indoor ? (
        <Text style={preStyles.weatherIndoor}>Retractable roof — weather not a factor</Text>
      ) : (weather.tempF != null) ? (
        <View style={preStyles.weatherConditions}>
          <Text style={preStyles.weatherTemp}>{weatherIcon(weather.weatherCode)} {weather.tempF}°F</Text>
          <Text style={preStyles.weatherDetail}>Wind: {weather.windMph} mph {weather.windDir}</Text>
          {weather.precipChance > 0 && (
            <Text style={preStyles.weatherDetail}>Precip: {weather.precipChance}% chance</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

// Row of up to 5 W/L pills + streak badge
function Last5Strip({ games, abbr, record }) {
  if (!games || games.length === 0) return null;

  const streak = (() => {
    if (!games.length) return '';
    const r = games[0].result;
    let n = 0;
    for (const g of games) { if (g.result === r) n++; else break; }
    return `${r}${n}`;
  })();
  const streakColor = streak.startsWith('W') ? colors.green : colors.red;

  return (
    <View style={preStyles.last5Row}>
      <View style={preStyles.last5TeamRow}>
        <Text style={preStyles.last5Team}>{abbr}</Text>
        {record ? (
          <Text style={preStyles.last5Record}>{record}</Text>
        ) : null}
        <View style={[preStyles.streakBadge, { borderColor: streakColor + '66', backgroundColor: streakColor + '15' }]}>
          <Text style={[preStyles.streakText, { color: streakColor }]}>{streak}</Text>
        </View>
      </View>
      <View style={preStyles.last5Pills}>
        {games.map((g, i) => (
          <WLPill key={i} index={i} result={g.result} teamScore={g.teamScore} oppScore={g.oppScore} opponent={g.opponent} />
        ))}
      </View>
    </View>
  );
}

// H2H single meeting row
function H2HMeetingRow({ game, awayAbbr }) {
  const awayWon = (game.awayAbbr === awayAbbr && game.awayWon) || (game.homeAbbr === awayAbbr && !game.awayWon);
  return (
    <View style={preStyles.h2hRow}>
      <Text style={preStyles.h2hDate}>{game.date}</Text>
      <Text style={[preStyles.h2hTeam, (game.awayAbbr === awayAbbr ? game.awayWon : !game.awayWon) && preStyles.h2hWinner]}>
        {game.awayAbbr}
      </Text>
      <Text style={preStyles.h2hScore}>{game.awayScore}–{game.homeScore}</Text>
      <Text style={[preStyles.h2hTeam, { textAlign: 'right' }, (game.homeAbbr === awayAbbr ? !game.awayWon : game.awayWon) && preStyles.h2hWinner]}>
        {game.homeAbbr}
      </Text>
    </View>
  );
}

// Animated confidence bar
function ConfidenceBarAnimated({ confidence }) {
  const width = useRef(new Animated.Value(0)).current;
  const pct   = Math.round(((confidence || 0) / 5) * 100);
  const color = confidence >= 4 ? colors.green : confidence >= 3 ? '#FF9900' : colors.red;
  const label = confidence >= 4 ? 'High Confidence' : confidence >= 3 ? 'Medium Confidence' : 'Low Confidence';

  useEffect(() => {
    Animated.timing(width, { toValue: pct, duration: 900, delay: 300, useNativeDriver: false }).start();
  }, [pct]);

  const widthInterp = width.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <View style={preStyles.confBarWrap}>
      <View style={preStyles.confBarRow}>
        <Text style={[preStyles.confLabel, { color }]}>{label}</Text>
        <Text style={[preStyles.confPct,   { color }]}>{pct}%</Text>
      </View>
      <View style={preStyles.confTrack}>
        <Animated.View style={[preStyles.confFill, { width: widthInterp, backgroundColor: color }]} />
      </View>
    </View>
  );
}

// Chalky's pre-match analysis card
function ChalkyAnalysis({ chalkPick }) {
  if (!chalkPick) return null;
  const { pick, pickType, shortReason, confidence, analysis } = chalkPick;
  const pickLabel = pickType === 'spread' ? 'Spread' : pickType === 'total' ? 'Total' : 'Moneyline';

  return (
    <View style={preStyles.chalkyCard}>
      <View style={preStyles.chalkyHeader}>
        <View style={preStyles.chalkyBadge}>
          <Text style={preStyles.chalkyIcon}>🎯</Text>
          <Text style={preStyles.chalkyBadgeText}>Chalky's Pick</Text>
        </View>
        <View style={preStyles.pickTypePill}>
          <Text style={preStyles.pickTypeText}>{pickLabel.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={preStyles.chalkyPick}>{pick}</Text>
      {!!shortReason && <Text style={preStyles.chalkyReason}>{shortReason}</Text>}
      {!!confidence && <ConfidenceBarAnimated confidence={confidence} />}
      {!!analysis?.summary && <Text style={preStyles.chalkyAnalysis}>{analysis.summary}</Text>}
    </View>
  );
}

// ── Team Leaders Section ──────────────────────────────────────────────────────

function LeaderRow({ row }) {
  if (!row) return null;
  return (
    <View style={preStyles.leaderRow}>
      {/* Away side */}
      <View style={preStyles.leaderSide}>
        {row.away ? (
          <>
            <Text style={preStyles.leaderValue}>{row.away.value}<Text style={preStyles.leaderUnit}> {row.unit}</Text></Text>
            <Text style={preStyles.leaderName} numberOfLines={1}>{row.away.name}</Text>
          </>
        ) : (
          <Text style={preStyles.leaderNA}>--</Text>
        )}
      </View>
      {/* Center label */}
      <View style={preStyles.leaderCenter}>
        <Text style={preStyles.leaderLabel}>{row.label}</Text>
      </View>
      {/* Home side */}
      <View style={[preStyles.leaderSide, { alignItems: 'flex-end' }]}>
        {row.home ? (
          <>
            <Text style={[preStyles.leaderValue, { textAlign: 'right' }]}>{row.home.value}<Text style={preStyles.leaderUnit}> {row.unit}</Text></Text>
            <Text style={[preStyles.leaderName, { textAlign: 'right' }]} numberOfLines={1}>{row.home.name}</Text>
          </>
        ) : (
          <Text style={[preStyles.leaderNA, { textAlign: 'right' }]}>--</Text>
        )}
      </View>
    </View>
  );
}

function TeamLeadersSection({ leaders, awayAbbr, homeAbbr, loading }) {
  if (loading && !leaders) {
    return (
      <View style={preStyles.leadersBlock}>
        <SkeletonBar height={14} width="50%" style={{ marginBottom: spacing.sm }} />
        <SkeletonBar height={44} style={{ marginBottom: 4 }} />
        <SkeletonBar height={44} style={{ marginBottom: 4 }} />
        <SkeletonBar height={44} style={{ marginBottom: 4 }} />
        <SkeletonBar height={44} />
      </View>
    );
  }
  if (!leaders?.rows?.length) return null;

  return (
    <View style={preStyles.leadersBlock}>
      <View style={preStyles.leadersHeader}>
        <Text style={preStyles.leadersTeam}>{awayAbbr}</Text>
        <Text style={preStyles.leadersTitle}>Team Leaders</Text>
        <Text style={[preStyles.leadersTeam, { textAlign: 'right' }]}>{homeAbbr}</Text>
      </View>
      {leaders.rows.map((row, i) => (
        <LeaderRow key={row.label} row={row} />
      ))}
    </View>
  );
}

// ── Chalky's Take Card ────────────────────────────────────────────────────────

function ChalkyTakeCard({ take, loading }) {
  if (loading && !take) {
    return <SkeletonBar height={78} style={{ borderRadius: 10 }} />;
  }
  if (!take) return null;

  return (
    <View style={preStyles.chalkyTakeCard}>
      <Text style={preStyles.chalkyTakeLabel}>CHALKY'S TAKE</Text>
      <View style={preStyles.chalkyTakeBody}>
        <Text style={preStyles.chalkyTakeIcon}>🎯</Text>
        <Text style={preStyles.chalkyTakeText}>"{take}"</Text>
      </View>
    </View>
  );
}

// ── Preview Tab ────────────────────────────────────────────────────────────────
function PreviewTab({ game, gameInfo, loading, leadersData, chalkyTake, leadersLoading, chalkyLoading }) {
  const { chalkPick, awayTeam, homeTeam, league } = game;
  const {
    awayLast5 = [], homeLast5 = [], headToHead = [],
    arena, arenaCity, awayRecord, homeRecord,
    awayPitcher, homePitcher, h2hSeries, venueWeather,
    awayRestDays, homeRestDays,
    goalieMatchup,
    awayHomeRecord, homeHomeRecord, awayRoadRecord, homeRoadRecord,
  } = gameInfo || {};

  const isMLB = league === 'MLB';
  const isNHL = league === 'NHL';
  const isNBA = league === 'NBA';

  if (loading && !gameInfo) {
    return (
      <View style={{ padding: spacing.md, gap: spacing.md }}>
        <SkeletonBar height={80} />
        <SkeletonBar height={16} width="40%" style={{ marginTop: spacing.md }} />
        <SkeletonBar height={68} />
        <SkeletonBar height={68} />
      </View>
    );
  }

  const awayWinsH2H = headToHead.filter(g =>
    (g.awayAbbr === awayTeam.abbr && g.awayWon) || (g.homeAbbr === awayTeam.abbr && !g.awayWon)
  ).length;
  const homeWinsH2H = headToHead.length - awayWinsH2H;

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ paddingHorizontal: spacing.md }}>
      {(arena || arenaCity) && !isMLB && (
        <View style={preStyles.venueRow}>
          <Text style={preStyles.venueIcon}>🏟</Text>
          <Text style={preStyles.venueText}>{[arena, arenaCity].filter(Boolean).join(' · ')}</Text>
        </View>
      )}

      {/* MLB: Probable Pitchers */}
      {isMLB && (
        <View style={preStyles.section}>
          <Text style={preStyles.sectionTitle}>Probable Pitchers</Text>
          <View style={preStyles.pitcherRow}>
            <PitcherCard pitcher={awayPitcher} abbr={awayTeam.abbr} isHome={false} />
            <View style={preStyles.pitcherVsDivider} />
            <PitcherCard pitcher={homePitcher} abbr={homeTeam.abbr} isHome={true} />
          </View>
        </View>
      )}

      {/* MLB: Weather + Park Factor */}
      {isMLB && venueWeather && (
        <View style={preStyles.section}>
          <Text style={preStyles.sectionTitle}>Venue & Conditions</Text>
          <WeatherWidget weather={venueWeather} />
        </View>
      )}

      {/* NHL: Probable Goalies */}
      {/* 1. LAST 5 GAMES */}
      {(awayLast5.length > 0 || homeLast5.length > 0) && (
        <View style={preStyles.section}>
          <Text style={preStyles.sectionTitle}>Last 5 Games</Text>
          <View style={preStyles.last5Block}>
            <Last5Strip games={awayLast5} abbr={awayTeam.abbr} record={awayRecord} />
            {awayLast5.length > 0 && homeLast5.length > 0 && <View style={preStyles.last5Divider} />}
            <Last5Strip games={homeLast5} abbr={homeTeam.abbr} record={homeRecord} />
          </View>
        </View>
      )}

      {/* 2. QUICK STATS — season series, rest days (NBA), home/road splits (NHL) */}
      {h2hSeries && h2hSeries.totalGames > 0 && (
        <View style={preStyles.section}>
          <SeasonSeriesBadge series={h2hSeries} awayAbbr={awayTeam.abbr} homeAbbr={homeTeam.abbr} />
        </View>
      )}
      {isNBA && (awayRestDays != null || homeRestDays != null) && (
        <View style={preStyles.section}>
          <RestDaysRow awayAbbr={awayTeam.abbr} homeAbbr={homeTeam.abbr} awayRest={awayRestDays} homeRest={homeRestDays} />
        </View>
      )}
      {isNHL && (awayRoadRecord || homeHomeRecord) && (
        <View style={preStyles.section}>
          <View style={preStyles.splitRecordRow}>
            <View style={preStyles.splitRecordBlock}>
              <Text style={preStyles.splitRecordLabel}>{awayTeam.abbr} Road</Text>
              <Text style={preStyles.splitRecordValue}>{awayRoadRecord ?? '--'}</Text>
            </View>
            <View style={preStyles.splitRecordBlock}>
              <Text style={preStyles.splitRecordLabel}>{homeTeam.abbr} Home</Text>
              <Text style={preStyles.splitRecordValue}>{homeHomeRecord ?? '--'}</Text>
            </View>
          </View>
        </View>
      )}

      {/* 3. TEAM LEADERS */}
      {(leadersData || leadersLoading) && (
        <View style={preStyles.section}>
          <TeamLeadersSection
            leaders={leadersData}
            awayAbbr={awayTeam.abbr}
            homeAbbr={homeTeam.abbr}
            loading={leadersLoading}
          />
        </View>
      )}

      {/* 4. CHALKY'S TAKE */}
      {(chalkyTake || chalkyLoading) && (
        <View style={preStyles.section}>
          <ChalkyTakeCard take={chalkyTake} loading={chalkyLoading} />
        </View>
      )}

      {/* 5. CHALKY'S PICK (from picks engine, if game has a Chalk pick) */}
      {chalkPick && (
        <View style={preStyles.section}>
          <ChalkyAnalysis chalkPick={chalkPick} />
        </View>
      )}

      {/* 6. STARTING PITCHERS (MLB) or PROBABLE GOALIES (NHL) */}
      {isMLB && (
        <View style={preStyles.section}>
          <Text style={preStyles.sectionTitle}>Probable Pitchers</Text>
          <View style={preStyles.pitcherRow}>
            <PitcherCard pitcher={awayPitcher} abbr={awayTeam.abbr} isHome={false} />
            <View style={preStyles.pitcherVsDivider} />
            <PitcherCard pitcher={homePitcher} abbr={homeTeam.abbr} isHome={true} />
          </View>
        </View>
      )}
      {isNHL && (
        <View style={preStyles.section}>
          <Text style={preStyles.sectionTitle}>Probable Goalies</Text>
          <View style={preStyles.pitcherRow}>
            <GoalieCard goalie={goalieMatchup?.awayGoalie} abbr={awayTeam.abbr} isHome={false} />
            <View style={preStyles.pitcherVsDivider} />
            <GoalieCard goalie={goalieMatchup?.homeGoalie} abbr={homeTeam.abbr} isHome={true} />
          </View>
        </View>
      )}

      {/* 7. WEATHER (MLB only) */}
      {isMLB && venueWeather && (
        <View style={preStyles.section}>
          <Text style={preStyles.sectionTitle}>Venue & Conditions</Text>
          <WeatherWidget weather={venueWeather} />
        </View>
      )}

      {/* 8. HEAD TO HEAD (historical game log from SD.io) */}
      {headToHead.length > 0 && (
        <View style={preStyles.section}>
          <Text style={preStyles.sectionTitle}>Head to Head</Text>
          <View style={preStyles.h2hBlock}>
            <View style={preStyles.h2hWinsRow}>
              <View>
                <Text style={preStyles.h2hWinsNum}>{awayWinsH2H}</Text>
                <Text style={preStyles.h2hWinsTeam}>{awayTeam.abbr}</Text>
              </View>
              <Text style={preStyles.h2hWinsLabel}>LAST {headToHead.length}</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={preStyles.h2hWinsNum}>{homeWinsH2H}</Text>
                <Text style={preStyles.h2hWinsTeam}>{homeTeam.abbr}</Text>
              </View>
            </View>
            {headToHead.map((g, i) => (
              <H2HMeetingRow key={i} game={g} awayAbbr={awayTeam.abbr} />
            ))}
          </View>
        </View>
      )}

      {!gameInfo && !loading && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>Preview data unavailable</Text>
        </View>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ── Animated stat comparison bar ───────────────────────────────────────────────
function PreMatchStatBar({ label, awayVal, homeVal, higherIsBetter = true, delay = 0 }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 500, delay: 150 + delay, useNativeDriver: false }).start();
  }, []);

  const awayNum = parseFloat(String(awayVal).replace(/[^0-9.]/g, '')) || 0;
  const homeNum = parseFloat(String(homeVal).replace(/[^0-9.]/g, '')) || 0;
  const total   = awayNum + homeNum;
  const awayPct = total > 0 ? awayNum / total : 0.5;
  const awayBetter = higherIsBetter ? awayNum >= homeNum : awayNum <= homeNum;
  const homeBetter = !awayBetter;

  const awayW = anim.interpolate({ inputRange: [0, 1], outputRange: ['50%', `${awayPct * 100}%`] });
  const homeW = anim.interpolate({ inputRange: [0, 1], outputRange: ['50%', `${(1 - awayPct) * 100}%`] });

  return (
    <View style={preStyles.matchupBar}>
      <Text style={[preStyles.matchupVal, awayBetter && preStyles.matchupValBetter]}>{awayVal ?? '--'}</Text>
      <View style={preStyles.matchupCenter}>
        <View style={preStyles.matchupTrack}>
          <Animated.View style={[preStyles.matchupFill, { width: awayW, backgroundColor: awayBetter ? colors.green : colors.grey + '55', borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }]} />
          <Animated.View style={[preStyles.matchupFill, { width: homeW, backgroundColor: homeBetter ? colors.green : colors.grey + '55', borderTopRightRadius: 3, borderBottomRightRadius: 3 }]} />
        </View>
        <Text style={preStyles.matchupLabel}>{label}</Text>
      </View>
      <Text style={[preStyles.matchupVal, { textAlign: 'right' }, homeBetter && preStyles.matchupValBetter]}>{homeVal ?? '--'}</Text>
    </View>
  );
}

// ── Matchup Tab ────────────────────────────────────────────────────────────────
function NBAMatchupBars({ away, home, awayAbbr, homeAbbr }) {
  const bars = [
    { label: 'PPG', away: away.ppg, home: home.ppg },
    { label: 'RPG', away: away.rpg, home: home.rpg },
    { label: 'APG', away: away.apg, home: home.apg },
    { label: 'FG%', away: away.fg,  home: home.fg  },
    { label: '3P%', away: away.three, home: home.three },
    { label: 'FT%', away: away.ft,  home: home.ft  },
    { label: 'TOV', away: away.tov, home: home.tov, higherIsBetter: false },
    { label: 'BLK', away: away.blk, home: home.blk },
    { label: 'STL', away: away.stl, home: home.stl },
  ];
  return (
    <View style={preStyles.matchupBlock}>
      <View style={preStyles.matchupHeader}>
        <Text style={preStyles.matchupTeamLbl}>{awayAbbr}</Text>
        <Text style={preStyles.matchupStatLbl}>STAT</Text>
        <Text style={[preStyles.matchupTeamLbl, { textAlign: 'right' }]}>{homeAbbr}</Text>
      </View>
      {bars.map((b, i) => (
        <PreMatchStatBar key={b.label} label={b.label} awayVal={b.away} homeVal={b.home}
          higherIsBetter={b.higherIsBetter !== false} delay={i * 40} />
      ))}
    </View>
  );
}

function NHLMatchupBars({ away, home, awayAbbr, homeAbbr }) {
  const bars = [
    { label: 'Goals/G',    away: away.gf,        home: home.gf        },
    { label: 'Goals Ag/G', away: away.ga,         home: home.ga,        higherIsBetter: false },
    { label: 'SOG/G',      away: away.sog,        home: home.sog        },
    { label: 'PP%',        away: away.ppPct,      home: home.ppPct      },
    { label: 'PK%',        away: away.pkPct,      home: home.pkPct      },
    { label: 'Possession', away: away.corsiPct,   home: home.corsiPct   },
    { label: 'Faceoff%',   away: away.foWinPct,   home: home.foWinPct   },
  ];
  return (
    <View style={preStyles.matchupBlock}>
      <View style={preStyles.matchupHeader}>
        <Text style={preStyles.matchupTeamLbl}>{awayAbbr}</Text>
        <Text style={preStyles.matchupStatLbl}>STAT</Text>
        <Text style={[preStyles.matchupTeamLbl, { textAlign: 'right' }]}>{homeAbbr}</Text>
      </View>
      {bars.map((b, i) => (
        <PreMatchStatBar key={b.label} label={b.label} awayVal={b.away} homeVal={b.home}
          higherIsBetter={b.higherIsBetter !== false} delay={i * 50} />
      ))}
    </View>
  );
}

function MLBMatchupBars({ away, home, awayAbbr, homeAbbr }) {
  const bars = [
    { label: 'AVG',      away: away.avg,  home: home.avg                           },
    { label: 'OBP',      away: away.obp,  home: home.obp                           },
    { label: 'SLG',      away: away.slg,  home: home.slg                           },
    { label: 'OPS',      away: away.ops,  home: home.ops                           },
    { label: 'Runs/G',   away: away.rpg,  home: home.rpg                           },
    { label: 'Team ERA', away: away.era,  home: home.era,  higherIsBetter: false   },
    { label: 'WHIP',     away: away.whip, home: home.whip, higherIsBetter: false   },
    { label: 'K/9',      away: away.k9,   home: home.k9                            },
    { label: 'BB/9',     away: away.bb9,  home: home.bb9,  higherIsBetter: false   },
  ];
  return (
    <View style={preStyles.matchupBlock}>
      <View style={preStyles.matchupHeader}>
        <Text style={preStyles.matchupTeamLbl}>{awayAbbr}</Text>
        <Text style={preStyles.matchupStatLbl}>STAT</Text>
        <Text style={[preStyles.matchupTeamLbl, { textAlign: 'right' }]}>{homeAbbr}</Text>
      </View>
      {bars.map((b, i) => (
        <PreMatchStatBar key={b.label} label={b.label} awayVal={b.away} homeVal={b.home}
          higherIsBetter={b.higherIsBetter !== false} delay={i * 50} />
      ))}
    </View>
  );
}

function NBAKeyPlayerCard({ player, isHome }) {
  if (!player) return <View style={{ flex: 1 }} />;
  return (
    <View style={[preStyles.playerCard, isHome && { alignItems: 'flex-end' }]}>
      <Text style={preStyles.playerName} numberOfLines={2}>{player.name}</Text>
      <Text style={preStyles.playerPos}>{player.pos}</Text>
      <View style={preStyles.playerStats}>
        {[{ v: player.pts, l: 'PPG' }, { v: player.reb, l: 'RPG' }, { v: player.ast, l: 'APG' }].map(s => (
          <View key={s.l} style={preStyles.playerStat}>
            <Text style={preStyles.playerStatVal}>{s.v}</Text>
            <Text style={preStyles.playerStatLabel}>{s.l}</Text>
          </View>
        ))}
      </View>
      <Text style={preStyles.playerFG}>{player.fg} FG%</Text>
    </View>
  );
}

function MatchupTab({ game, gameInfo, loading }) {
  const { league, awayTeam, homeTeam } = game;
  const { awayTeamStats, homeTeamStats, keyPlayers } = gameInfo || {};
  const L = (league || '').toUpperCase();

  if (loading && !gameInfo) {
    return (
      <View style={{ padding: spacing.md, gap: 10 }}>
        <SkeletonBar height={16} width="40%" />
        {[...Array(6)].map((_, i) => <SkeletonBar key={i} height={34} />)}
      </View>
    );
  }

  const hasStats = awayTeamStats && homeTeamStats;

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ paddingHorizontal: spacing.md }}>
      {hasStats ? (
        <View style={preStyles.section}>
          <Text style={preStyles.sectionTitle}>Season Stats</Text>
          {L === 'NBA' && <NBAMatchupBars away={awayTeamStats} home={homeTeamStats} awayAbbr={awayTeam.abbr} homeAbbr={homeTeam.abbr} />}
          {L === 'NHL' && <NHLMatchupBars away={awayTeamStats} home={homeTeamStats} awayAbbr={awayTeam.abbr} homeAbbr={homeTeam.abbr} />}
          {L === 'MLB' && <MLBMatchupBars away={awayTeamStats} home={homeTeamStats} awayAbbr={awayTeam.abbr} homeAbbr={homeTeam.abbr} />}
        </View>
      ) : !loading && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Season stats unavailable</Text>
        </View>
      )}

      {L === 'NBA' && keyPlayers && (keyPlayers.away?.length > 0 || keyPlayers.home?.length > 0) && (
        <View style={preStyles.section}>
          <Text style={preStyles.sectionTitle}>Key Players</Text>
          {Array.from({ length: Math.max(keyPlayers.away?.length || 0, keyPlayers.home?.length || 0) }, (_, i) => (
            <View key={i} style={preStyles.keyPlayerRow}>
              <NBAKeyPlayerCard player={keyPlayers.away?.[i]} isHome={false} />
              <View style={preStyles.vsCircle}><Text style={preStyles.vsText}>VS</Text></View>
              <NBAKeyPlayerCard player={keyPlayers.home?.[i]} isHome />
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ── Odds Tab ───────────────────────────────────────────────────────────────────
const BOOKS_ORDER = ['DraftKings', 'FanDuel', 'BetMGM', 'bet365'];

function OddsMarketTable({ title, rows, awayAbbr, homeAbbr, bestAway, bestHome, isTotal, awayLine, homeLine }) {
  if (!rows || rows.length === 0) return null;
  const topLine = isTotal ? rows[0]?.line : null;

  return (
    <View style={preStyles.section}>
      <Text style={preStyles.sectionTitle}>{title}{topLine ? ` · ${topLine}` : ''}</Text>
      <View style={preStyles.oddsTable}>
        {/* Header */}
        <View style={[preStyles.oddsRow, preStyles.oddsHeaderRow]}>
          <Text style={[preStyles.oddsBook, preStyles.oddsHdr, { flex: 1 }]}>BOOK</Text>
          <Text style={[preStyles.oddsValText, preStyles.oddsHdr]}>
            {isTotal ? 'OVER' : (awayLine ? `${awayAbbr} ${awayLine}` : awayAbbr)}
          </Text>
          <Text style={[preStyles.oddsValText, preStyles.oddsHdr]}>
            {isTotal ? 'UNDER' : (homeLine ? `${homeAbbr} ${homeLine}` : homeAbbr)}
          </Text>
        </View>
        {rows.map(row => {
          const leftBest  = row.book === bestAway;
          const rightBest = row.book === bestHome;
          const leftOdds  = isTotal ? row.overOdds  : row.awayOdds;
          const rightOdds = isTotal ? row.underOdds : row.homeOdds;
          if (!leftOdds && !rightOdds) return null;
          return (
            <View key={row.book} style={[preStyles.oddsRow, (leftBest || rightBest) && preStyles.oddsBestRow]}>
              <Text style={[preStyles.oddsBook, { flex: 1 }]}>{row.book}</Text>
              <Text style={[preStyles.oddsValText, leftBest  && preStyles.oddsBestText]}>{leftOdds  ?? '—'}</Text>
              <Text style={[preStyles.oddsValText, rightBest && preStyles.oddsBestText]}>{rightOdds ?? '—'}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function OddsTab({ game, oddsData, loading }) {
  const { chalkPick, awayTeam, homeTeam } = game;

  if (loading) {
    return (
      <View style={{ padding: spacing.md, gap: 10 }}>
        <SkeletonBar height={16} width="40%" />
        {[...Array(5)].map((_, i) => <SkeletonBar key={i} height={36} />)}
      </View>
    );
  }

  const hasRealOdds = oddsData && (
    oddsData.moneyline?.length > 0 ||
    oddsData.spread?.length   > 0 ||
    oddsData.total?.length    > 0
  );

  const awayAbbr = awayTeam?.abbr || '';
  const homeAbbr = homeTeam?.abbr || '';

  // Derive spread lines for header from first bookmaker entry
  const awaySpLine = oddsData?.spread?.[0]?.awayLine;
  const homeSpLine = oddsData?.spread?.[0]?.homeLine;

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ paddingHorizontal: spacing.md }}>

      {/* Chalky pick banner if available */}
      {chalkPick?.pick && (
        <View style={preStyles.section}>
          <View style={preStyles.pickSummary}>
            <Text style={preStyles.pickSummaryLabel}>🎯 Chalky's Pick</Text>
            <Text style={preStyles.pickSummaryValue}>{chalkPick.pick}</Text>
          </View>
        </View>
      )}

      {hasRealOdds ? (
        <>
          <OddsMarketTable
            title="Moneyline"
            rows={oddsData.moneyline}
            awayAbbr={awayAbbr}
            homeAbbr={homeAbbr}
            bestAway={oddsData.bestMLAway}
            bestHome={oddsData.bestMLHome}
          />
          <OddsMarketTable
            title="Spread"
            rows={oddsData.spread}
            awayAbbr={awayAbbr}
            homeAbbr={homeAbbr}
            awayLine={awaySpLine}
            homeLine={homeSpLine}
            bestAway={oddsData.bestSpAway}
            bestHome={oddsData.bestSpHome}
          />
          <OddsMarketTable
            title="Total"
            rows={oddsData.total}
            awayAbbr="Over"
            homeAbbr="Under"
            bestAway={oddsData.bestOver}
            bestHome={oddsData.bestUnder}
            isTotal
          />

          {/* Bet buttons */}
          <View style={preStyles.section}>
            <Text style={preStyles.sectionTitle}>Place Your Bet</Text>
            <View style={preStyles.ctaGrid}>
              {BOOKS_ORDER.map(book => {
                const mlRow   = oddsData.moneyline?.find(r => r.book === book);
                const isBest  = book === oddsData.bestMLAway || book === oddsData.bestMLHome;
                if (!mlRow) return null;
                return (
                  <TouchableOpacity key={book} style={[preStyles.ctaBtn, isBest && preStyles.ctaBtnBest]} activeOpacity={0.8}>
                    <Text style={[preStyles.ctaBtnText, isBest && preStyles.ctaBtnTextBest]}>{book}</Text>
                    {isBest && <Text style={preStyles.ctaBtnSub}>Best Odds</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={styles.emptyText}>
            {oddsData?.noGame
              ? 'Odds not yet available for this game'
              : 'Odds available closer to game time'}
          </Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ── Injuries Tab ───────────────────────────────────────────────────────────────
const INJURY_STATUS_CFG = {
  Out:          { dot: colors.red,   label: 'OUT',     color: colors.red   },
  Doubtful:     { dot: '#FF6600',    label: 'DOUBT.',  color: '#FF6600'    },
  Questionable: { dot: '#FFD700',    label: 'QUEST.',  color: '#FFD700'    },
  Probable:     { dot: colors.green, label: 'PROB.',   color: colors.green },
  GTD:          { dot: colors.grey,  label: 'GTD',     color: colors.grey  },
};

function InjuryCard({ player, isHighImpact }) {
  const cfg = INJURY_STATUS_CFG[player.status] || { dot: colors.grey, label: (player.status || '?').toUpperCase().slice(0, 6), color: colors.grey };
  return (
    <View style={preStyles.injuryCard}>
      <View style={[preStyles.injuryDot, { backgroundColor: cfg.dot }]} />
      <View style={preStyles.injuryContent}>
        <View style={preStyles.injuryNameRow}>
          <Text style={preStyles.injuryName} numberOfLines={1}>{player.name}</Text>
          {isHighImpact && (
            <View style={preStyles.impactBadge}>
              <Text style={preStyles.impactText}>HIGH IMPACT</Text>
            </View>
          )}
        </View>
        {!!player.description && (
          <Text style={preStyles.injuryDesc} numberOfLines={2}>{player.description}</Text>
        )}
      </View>
      <View style={[preStyles.injuryStatus, { borderColor: cfg.color + '55', backgroundColor: cfg.color + '18' }]}>
        <Text style={[preStyles.injuryStatusText, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
    </View>
  );
}

function InjuriesTab({ game, gameInfo, loading }) {
  const { awayInjuries = [], homeInjuries = [] } = gameInfo || {};

  if (loading && !gameInfo) {
    return (
      <View style={{ padding: spacing.md, gap: 10 }}>
        <SkeletonBar height={16} width="40%" />
        {[...Array(4)].map((_, i) => <SkeletonBar key={i} height={56} />)}
      </View>
    );
  }

  const total = awayInjuries.length + homeInjuries.length;
  if (total === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>✅</Text>
        <Text style={styles.emptyText}>No injuries reported</Text>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ paddingHorizontal: spacing.md }}>
      {awayInjuries.length > 0 && (
        <View style={preStyles.section}>
          <Text style={preStyles.sectionTitle}>{game.awayTeam.name}</Text>
          <View style={preStyles.injuryBlock}>
            {awayInjuries.map((p, i) => (
              <InjuryCard key={i} player={p} isHighImpact={i < 2 && p.status === 'Out'} />
            ))}
          </View>
        </View>
      )}
      {homeInjuries.length > 0 && (
        <View style={preStyles.section}>
          <Text style={preStyles.sectionTitle}>{game.homeTeam.name}</Text>
          <View style={preStyles.injuryBlock}>
            {homeInjuries.map((p, i) => (
              <InjuryCard key={i} player={p} isHighImpact={i < 2 && p.status === 'Out'} />
            ))}
          </View>
        </View>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ── Live transition banner (slides in when game goes live) ─────────────────────
function LiveTransitionBanner({ visible }) {
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.sequence([
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, tension: 180, friction: 18, useNativeDriver: true }),
        Animated.timing(opacity,    { toValue: 1, duration: 280,              useNativeDriver: true }),
      ]),
      Animated.delay(3200),
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  return (
    <Animated.View style={[preStyles.liveBanner, { transform: [{ translateY }], opacity }]} pointerEvents="none">
      <View style={preStyles.liveBannerDot} />
      <Text style={preStyles.liveBannerText}>Game is Live!</Text>
    </Animated.View>
  );
}

// ── Pre-match styles ───────────────────────────────────────────────────────────
const preStyles = StyleSheet.create({
  section:      { marginTop: spacing.md },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm },

  venueRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: spacing.xs },
  venueIcon: { fontSize: 14 },
  venueText: { fontSize: 13, color: colors.grey, flex: 1 },

  // W/L pills
  wlPill:   { borderRadius: radius.sm, padding: 7, alignItems: 'center', gap: 2, minWidth: 50, borderWidth: 1 },
  wlWin:    { backgroundColor: colors.green + '12', borderColor: colors.green + '44' },
  wlLoss:   { backgroundColor: colors.red   + '12', borderColor: colors.red   + '44' },
  wlLetter: { fontSize: 14, fontWeight: '900' },
  wlScore:  { fontSize: 9, fontWeight: '600', color: colors.grey },
  wlOpp:    { fontSize: 9, color: colors.grey, maxWidth: 46, textAlign: 'center' },

  // Last 5
  last5Block:   { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  last5Divider: { height: 1, backgroundColor: colors.border },
  last5Row:     { gap: spacing.sm },
  last5TeamRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  last5Team:    { fontSize: 12, fontWeight: '700', color: colors.grey, width: 36, textTransform: 'uppercase', letterSpacing: 0.5 },
  last5Record:  { fontSize: 11, color: colors.grey, opacity: 0.7 },
  last5Pills:   { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  streakBadge:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full, borderWidth: 1 },
  streakText:   { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  // H2H
  h2hBlock:    { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  h2hWinsRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: spacing.sm, marginBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  h2hWinsNum:  { fontSize: 28, fontWeight: '900', color: colors.offWhite, lineHeight: 30 },
  h2hWinsTeam: { fontSize: 10, fontWeight: '700', color: colors.grey, letterSpacing: 0.5, textTransform: 'uppercase' },
  h2hWinsLabel:{ fontSize: 10, fontWeight: '700', color: colors.grey, letterSpacing: 1, textTransform: 'uppercase' },
  h2hRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border + '44', gap: spacing.sm },
  h2hDate:     { fontSize: 11, color: colors.grey, width: 44 },
  h2hTeam:     { fontSize: 13, fontWeight: '600', color: colors.grey, flex: 1 },
  h2hWinner:   { color: colors.offWhite, fontWeight: '800' },
  h2hScore:    { fontSize: 13, fontWeight: '700', color: colors.offWhite, textAlign: 'center', minWidth: 52 },

  // Chalky analysis card
  chalkyCard:      { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.green + '33', gap: spacing.sm },
  chalkyHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chalkyBadge:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chalkyIcon:      { fontSize: 16 },
  chalkyBadgeText: { fontSize: 12, fontWeight: '700', color: colors.green, textTransform: 'uppercase', letterSpacing: 0.5 },
  pickTypePill:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full, backgroundColor: colors.green + '18', borderWidth: 1, borderColor: colors.green + '33' },
  pickTypeText:    { fontSize: 10, fontWeight: '700', color: colors.green, letterSpacing: 0.3 },
  chalkyPick:      { fontSize: 22, fontWeight: '900', color: colors.offWhite, letterSpacing: -0.5 },
  chalkyReason:    { fontSize: 14, color: colors.grey, lineHeight: 20 },
  chalkyAnalysis:  { fontSize: 13, color: colors.grey, lineHeight: 20, marginTop: 2 },
  confBarWrap:     { gap: 5, marginTop: 4 },
  confBarRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  confLabel:       { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  confPct:         { fontSize: 12, fontWeight: '800' },
  confTrack:       { height: 5, backgroundColor: colors.surfaceAlt, borderRadius: 3, overflow: 'hidden' },
  confFill:        { height: '100%', borderRadius: 3 },

  // Matchup bars
  matchupBlock:    { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: 2 },
  matchupHeader:   { flexDirection: 'row', alignItems: 'center', paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 4 },
  matchupTeamLbl:  { fontSize: 12, fontWeight: '800', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 },
  matchupStatLbl:  { fontSize: 10, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 1, flex: 1, textAlign: 'center' },
  matchupBar:      { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 },
  matchupVal:      { width: 40, fontSize: 13, fontWeight: '600', color: colors.grey },
  matchupValBetter:{ color: colors.offWhite, fontWeight: '800' },
  matchupCenter:   { flex: 1, gap: 3, alignItems: 'center' },
  matchupTrack:    { flexDirection: 'row', height: 5, width: '100%', borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  matchupFill:     { height: '100%' },
  matchupLabel:    { fontSize: 10, fontWeight: '600', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Key player matchup
  keyPlayerRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  playerCard:      { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, gap: 4 },
  playerName:      { fontSize: 13, fontWeight: '700', color: colors.offWhite, lineHeight: 17 },
  playerPos:       { fontSize: 10, fontWeight: '600', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.5 },
  playerStats:     { flexDirection: 'row', gap: spacing.xs, marginTop: 4 },
  playerStat:      { alignItems: 'center', flex: 1 },
  playerStatVal:   { fontSize: 14, fontWeight: '800', color: colors.offWhite },
  playerStatLabel: { fontSize: 9, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.3 },
  playerFG:        { fontSize: 11, color: colors.grey, marginTop: 2 },
  vsCircle:        { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  vsText:          { fontSize: 9, fontWeight: '800', color: colors.grey },

  // Odds tab
  pickSummary:      { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.green + '33', gap: 4 },
  pickSummaryLabel: { fontSize: 10, fontWeight: '700', color: colors.green, textTransform: 'uppercase', letterSpacing: 0.5 },
  pickSummaryValue: { fontSize: 22, fontWeight: '900', color: colors.offWhite, letterSpacing: -0.3 },
  oddsTable:        { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  oddsHeaderRow:    { backgroundColor: colors.surfaceAlt + '88' },
  oddsHdr:          { fontSize: 10, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.5 },
  oddsRow:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border + '55', gap: spacing.sm },
  oddsBestRow:      { backgroundColor: colors.green + '08' },
  oddsBookCell:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  oddsBook:         { fontSize: 14, fontWeight: '600', color: colors.offWhite },
  oddsValText:      { fontSize: 16, fontWeight: '800', color: colors.offWhite, width: 60, textAlign: 'right' },
  oddsBestText:     { color: colors.green },
  bestBadge:        { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full, backgroundColor: colors.green + '20', borderWidth: 1, borderColor: colors.green + '44' },
  bestBadgeText:    { fontSize: 9, fontWeight: '800', color: colors.green, letterSpacing: 0.5 },
  betBtn:           { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  betBtnBest:       { backgroundColor: colors.green, borderColor: colors.green },
  betBtnText:       { fontSize: 12, fontWeight: '700', color: colors.grey },
  betBtnTextBest:   { color: colors.background },
  ctaGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  ctaBtn:           { flex: 1, minWidth: '45%', paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 3 },
  ctaBtnBest:       { backgroundColor: colors.green, borderColor: colors.green },
  ctaBtnText:       { fontSize: 14, fontWeight: '700', color: colors.offWhite },
  ctaBtnTextBest:   { color: colors.background },
  ctaBtnSub:        { fontSize: 10, fontWeight: '600', color: colors.background, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Injuries tab
  injuryBlock:      { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  injuryCard:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border + '44', gap: spacing.sm },
  injuryDot:        { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  injuryContent:    { flex: 1, gap: 2 },
  injuryNameRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  injuryName:       { fontSize: 14, fontWeight: '700', color: colors.offWhite },
  impactBadge:      { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.red + '20', borderWidth: 1, borderColor: colors.red + '55' },
  impactText:       { fontSize: 9, fontWeight: '800', color: colors.red, letterSpacing: 0.5 },
  injuryDesc:       { fontSize: 12, color: colors.grey, lineHeight: 17 },
  injuryStatus:     { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, minWidth: 56, alignItems: 'center', flexShrink: 0 },
  injuryStatusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  // Pitcher / Goalie cards
  pitcherRow:       { flexDirection: 'row', gap: spacing.sm },
  pitcherVsDivider: { width: 1, backgroundColor: colors.border },
  pitcherCard:      { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, gap: 3 },
  pitcherTeam:      { fontSize: 10, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.5 },
  pitcherName:      { fontSize: 14, fontWeight: '800', color: colors.offWhite, lineHeight: 18 },
  pitcherHand:      { fontSize: 11, fontWeight: '600', color: colors.grey },
  pitcherStats:     { flexDirection: 'row', gap: spacing.xs, marginTop: 4 },
  pitcherStat:      { alignItems: 'center', flex: 1 },
  pitcherStatVal:   { fontSize: 13, fontWeight: '800', color: colors.offWhite },
  pitcherStatLbl:   { fontSize: 9, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.3 },
  pitcherRecord:    { fontSize: 10, color: colors.grey, marginTop: 2 },
  pitcherSub:       { fontSize: 11, color: colors.grey, fontStyle: 'italic' },

  // Weather widget
  weatherCard:       { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  weatherVenueRow:   { gap: 2 },
  weatherVenue:      { fontSize: 14, fontWeight: '700', color: colors.offWhite },
  weatherCity:       { fontSize: 12, color: colors.grey },
  parkFactorBadge:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1 },
  parkFactorText:    { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  parkFactorFactor:  { fontSize: 11, color: colors.grey },
  weatherIndoor:     { fontSize: 12, color: colors.grey, fontStyle: 'italic' },
  weatherConditions: { gap: 3 },
  weatherTemp:       { fontSize: 18, fontWeight: '700', color: colors.offWhite },
  weatherDetail:     { fontSize: 12, color: colors.grey },

  // Season series badge
  seriesBadge:  { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 3 },
  seriesText:   { fontSize: 14, fontWeight: '800', color: colors.offWhite },
  seriesSub:    { fontSize: 11, color: colors.grey },

  // Rest days row
  restRow:      { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  restBadge:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  restB2B:      { backgroundColor: colors.red + '18', borderColor: colors.red + '55' },
  restText:     { fontSize: 12, fontWeight: '600', color: colors.grey },
  restB2BText:  { color: colors.red, fontWeight: '800' },

  // NHL home/road split records
  splitRecordRow:   { flexDirection: 'row', gap: spacing.sm },
  splitRecordBlock: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 2 },
  splitRecordLabel: { fontSize: 10, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.5 },
  splitRecordValue: { fontSize: 18, fontWeight: '900', color: colors.offWhite },

  // Team Leaders section
  leadersBlock:   { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  leadersHeader:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceAlt + '66' },
  leadersTeam:    { flex: 1, fontSize: 12, fontWeight: '800', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.5 },
  leadersTitle:   { fontSize: 10, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' },
  leaderRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border + '44' },
  leaderSide:     { flex: 1, gap: 2 },
  leaderCenter:   { width: 72, alignItems: 'center', paddingHorizontal: 4 },
  leaderLabel:    { fontSize: 9, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'center' },
  leaderValue:    { fontSize: 16, fontWeight: '900', color: colors.offWhite, lineHeight: 19 },
  leaderUnit:     { fontSize: 11, fontWeight: '600', color: colors.grey },
  leaderName:     { fontSize: 11, color: colors.grey, lineHeight: 14 },
  leaderNA:       { fontSize: 14, color: colors.grey },

  // Chalky's Take card
  chalkyTakeCard:  { backgroundColor: '#0D2A1A', borderRadius: radius.md, borderLeftWidth: 3, borderLeftColor: colors.green, borderWidth: 1, borderColor: colors.green + '33', padding: spacing.md, gap: spacing.sm },
  chalkyTakeLabel: { fontSize: 10, fontWeight: '800', color: colors.green, textTransform: 'uppercase', letterSpacing: 1 },
  chalkyTakeBody:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  chalkyTakeIcon:  { fontSize: 18, marginTop: 1 },
  chalkyTakeText:  { flex: 1, fontSize: 15, fontWeight: '600', color: colors.offWhite, lineHeight: 22, fontStyle: 'italic' },

  // Live transition banner (absolutely positioned)
  liveBanner:     { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.green, paddingVertical: 14, shadowColor: colors.green, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 10 },
  liveBannerDot:  { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.background },
  liveBannerText: { fontSize: 16, fontWeight: '800', color: colors.background, letterSpacing: 0.5 },
});

// ════════════════════════════════════════════════════════════════════════════
// ── NHL-SPECIFIC COMPONENTS ───────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

// Strength indicator: PP | SH | EN — shown prominently in live NHL header
function NHLStrengthBadge({ strength }) {
  if (!strength) return null;
  const cfg = {
    PP: { label: 'POWER PLAY',   bg: '#FF660020', border: '#FF6600', color: '#FF6600' },
    SH: { label: 'SHORT HANDED', bg: colors.green + '20', border: colors.green, color: colors.green },
    EN: { label: 'EMPTY NET',    bg: colors.red + '20',   border: colors.red,   color: colors.red   },
  }[strength];
  if (!cfg) return null;
  return (
    <View style={nhlStyles.strengthBadge}>
      <View style={[nhlStyles.strengthPill, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
        <Text style={[nhlStyles.strengthText, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
    </View>
  );
}

// Period line score: P1 | P2 | P3 | OT | SO | F
function NHLPeriodLineScore({ periods, awayAbbr, homeAbbr, awayScore, homeScore }) {
  if (!periods || periods.length === 0) return null;
  const labels = periods.map(p => p.label);
  const awayRow = periods.map(p => p.away);
  const homeRow = periods.map(p => p.home);
  const awayWins = (awayScore || 0) > (homeScore || 0);
  const homeWins = (homeScore || 0) > (awayScore || 0);

  return (
    <View style={nhlStyles.lineScoreCard}>
      <View style={nhlStyles.lsRow}>
        <Text style={[nhlStyles.lsTeam, nhlStyles.lsHdr]} />
        {labels.map(l => <Text key={l} style={[nhlStyles.lsCell, nhlStyles.lsHdr]}>{l}</Text>)}
        <Text style={[nhlStyles.lsGoals, nhlStyles.lsHdr]}>F</Text>
      </View>
      <View style={nhlStyles.lsDivider} />
      <View style={nhlStyles.lsRow}>
        <Text style={nhlStyles.lsTeam}>{awayAbbr}</Text>
        {awayRow.map((s, i) => (
          <Text key={i} style={[nhlStyles.lsCell, s == null && nhlStyles.lsEmpty]}>
            {s != null ? s : '–'}
          </Text>
        ))}
        <Text style={[nhlStyles.lsGoals, awayWins && nhlStyles.lsWinner]}>{awayScore ?? '--'}</Text>
      </View>
      <View style={nhlStyles.lsRow}>
        <Text style={nhlStyles.lsTeam}>{homeAbbr}</Text>
        {homeRow.map((s, i) => (
          <Text key={i} style={[nhlStyles.lsCell, s == null && nhlStyles.lsEmpty]}>
            {s != null ? s : '–'}
          </Text>
        ))}
        <Text style={[nhlStyles.lsGoals, homeWins && nhlStyles.lsWinner]}>{homeScore ?? '--'}</Text>
      </View>
    </View>
  );
}

// Team stats comparison: SOG | PP | PIM | FO% | Hits | Blocked
function NHLTeamStatsBlock({ awayStats, homeStats, awayAbbr, homeAbbr }) {
  if (!awayStats || !homeStats) return null;
  return (
    <View style={styles.teamStatsBlock}>
      <View style={styles.teamStatsHeader}>
        <Text style={styles.teamStatsAbbr}>{awayAbbr}</Text>
        <Text style={styles.teamStatsTitle}>Team Stats</Text>
        <Text style={styles.teamStatsAbbr}>{homeAbbr}</Text>
      </View>
      <TeamStatBar label="SOG"     awayVal={awayStats.sog}     homeVal={homeStats.sog} />
      <TeamStatBar label="PP"      awayVal={awayStats.pp}      homeVal={homeStats.pp} />
      <TeamStatBar label="PIM"     awayVal={awayStats.pim}     homeVal={homeStats.pim} higherIsBetter={false} />
      <TeamStatBar label="FO%"     awayVal={awayStats.fo}      homeVal={homeStats.fo} />
      <TeamStatBar label="Hits"    awayVal={awayStats.hits}    homeVal={homeStats.hits} />
      <TeamStatBar label="Blocked" awayVal={awayStats.blocked} homeVal={homeStats.blocked} />
    </View>
  );
}

// Skater stats table — horizontally scrollable: G | A | PTS | +/- | PIM | SOG | TOI
function NHLSkaterTable({ skaters, teamName: tName, onPlayerPress }) {
  if (!skaters || skaters.length === 0) return null;
  return (
    <View style={nhlStyles.tableBlock}>
      <Text style={nhlStyles.tableTeamName}>{tName} — Skaters</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Header */}
          <View style={nhlStyles.sRow}>
            <Text style={[nhlStyles.sName, nhlStyles.sHdr]}>PLAYER</Text>
            <Text style={[nhlStyles.sPos,  nhlStyles.sHdr]}>POS</Text>
            <Text style={[nhlStyles.sSm,   nhlStyles.sHdr]}>G</Text>
            <Text style={[nhlStyles.sSm,   nhlStyles.sHdr]}>A</Text>
            <Text style={[nhlStyles.sSm,   nhlStyles.sHdr]}>PTS</Text>
            <Text style={[nhlStyles.sSm,   nhlStyles.sHdr]}>+/-</Text>
            <Text style={[nhlStyles.sSm,   nhlStyles.sHdr]}>PIM</Text>
            <Text style={[nhlStyles.sSm,   nhlStyles.sHdr]}>SOG</Text>
            <Text style={[nhlStyles.sTOI,  nhlStyles.sHdr]}>TOI</Text>
          </View>
          {skaters.map((p, i) => {
            const pmColor = p.pm > 0 ? colors.green : p.pm < 0 ? colors.red : colors.grey;
            return (
              <View key={i} style={[nhlStyles.sRow, i % 2 === 0 && nhlStyles.sRowAlt, p.isScorer && nhlStyles.sRowScorer]}>
                <View style={nhlStyles.sName}>
                  {p.isScorer && <View style={nhlStyles.scorerDot} />}
                  <TouchableOpacity onPress={() => onPlayerPress?.(p.name)} activeOpacity={0.7}>
                    <Text style={[nhlStyles.sNameText, nhlStyles.playerNameLink]} numberOfLines={1}>{p.name}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={nhlStyles.sPos}>{p.pos}</Text>
                <Text style={[nhlStyles.sSm, p.g > 0 && nhlStyles.goalHighlight]}>{p.g}</Text>
                <Text style={nhlStyles.sSm}>{p.a}</Text>
                <Text style={[nhlStyles.sSm, nhlStyles.ptsCell]}>{p.pts}</Text>
                <Text style={[nhlStyles.sSm, { color: pmColor }]}>{p.pm > 0 ? `+${p.pm}` : p.pm}</Text>
                <Text style={nhlStyles.sSm}>{p.pim}</Text>
                <Text style={nhlStyles.sSm}>{p.sog}</Text>
                <Text style={nhlStyles.sTOI}>{p.toi}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// Goalie stats table: SA | SV | GA | SV% | TOI
function NHLGoalieTable({ goalies, teamName: tName, onPlayerPress }) {
  if (!goalies || goalies.length === 0) return null;
  return (
    <View style={[nhlStyles.tableBlock, { marginBottom: 0 }]}>
      <Text style={nhlStyles.tableTeamName}>{tName} — Goaltending</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Header */}
          <View style={nhlStyles.sRow}>
            <Text style={[nhlStyles.gName,  nhlStyles.sHdr]}>GOALIE</Text>
            <Text style={[nhlStyles.sSm,    nhlStyles.sHdr]}>SA</Text>
            <Text style={[nhlStyles.sSm,    nhlStyles.sHdr]}>SV</Text>
            <Text style={[nhlStyles.sSm,    nhlStyles.sHdr]}>GA</Text>
            <Text style={[nhlStyles.gSvPct, nhlStyles.sHdr]}>SV%</Text>
            <Text style={[nhlStyles.sTOI,   nhlStyles.sHdr]}>TOI</Text>
          </View>
          {goalies.map((g, i) => {
            const decColor = g.decision === 'W' ? colors.green : g.decision === 'L' ? colors.red : colors.grey;
            return (
              <View key={i} style={[nhlStyles.sRow, g.isStarter && nhlStyles.starterRow]}>
                <View style={nhlStyles.gName}>
                  <TouchableOpacity onPress={() => onPlayerPress?.(g.name)} activeOpacity={0.7}>
                    <Text style={[nhlStyles.gNameText, g.isStarter && nhlStyles.starterText, nhlStyles.playerNameLink]} numberOfLines={1}>
                      {g.name}
                    </Text>
                  </TouchableOpacity>
                  {!!g.decision && (
                    <Text style={[nhlStyles.decisionBadge, { color: decColor }]}>{g.decision}</Text>
                  )}
                </View>
                <Text style={nhlStyles.sSm}>{g.sa}</Text>
                <Text style={nhlStyles.sSm}>{g.sv}</Text>
                <Text style={[nhlStyles.sSm, g.ga > 4 && { color: colors.red }]}>{g.ga}</Text>
                <Text style={nhlStyles.gSvPct}>{g.svPct}</Text>
                <Text style={nhlStyles.sTOI}>{g.toi}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// Full NHL box score tab
function NHLBoxScoreTab({ game, boxScore, loading, onPlayerPress }) {
  if (loading && !boxScore) {
    return (
      <View style={{ padding: spacing.md, gap: spacing.md }}>
        <SkeletonBar height={16} width="40%" />
        <SkeletonBar height={48} />
        <SkeletonBar height={16} width="40%" style={{ marginTop: spacing.md }} />
        {[...Array(5)].map((_, i) => <SkeletonBar key={i} height={38} />)}
      </View>
    );
  }

  if (!boxScore) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>🏒</Text>
        <Text style={styles.emptyText}>
          {game.status === 'upcoming' ? 'Box score available at puck drop' : 'Box score unavailable'}
        </Text>
      </View>
    );
  }

  const awayAbbr = game.awayTeam.abbr;
  const homeAbbr = game.homeTeam.abbr;
  const awayName = game.awayTeam.name;
  const homeName = game.homeTeam.name;

  return (
    <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
      {/* Period line score */}
      <Text style={styles.sectionLabel}>Line Score</Text>
      <NHLPeriodLineScore
        periods={boxScore.periods}
        awayAbbr={awayAbbr}
        homeAbbr={homeAbbr}
        awayScore={game.awayTeam.score}
        homeScore={game.homeTeam.score}
      />

      {/* Team stats */}
      {boxScore.teamStats && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Team Stats</Text>
          <NHLTeamStatsBlock
            awayStats={boxScore.teamStats.away}
            homeStats={boxScore.teamStats.home}
            awayAbbr={awayAbbr}
            homeAbbr={homeAbbr}
          />
        </>
      )}

      {/* Away skaters + goalies */}
      <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>{awayName}</Text>
      <NHLSkaterTable skaters={boxScore.away?.skaters} teamName={awayAbbr} onPlayerPress={onPlayerPress} />
      <View style={{ height: spacing.sm }} />
      <NHLGoalieTable goalies={boxScore.away?.goalies} teamName={awayAbbr} onPlayerPress={onPlayerPress} />

      {/* Home skaters + goalies */}
      <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>{homeName}</Text>
      <NHLSkaterTable skaters={boxScore.home?.skaters} teamName={homeAbbr} onPlayerPress={onPlayerPress} />
      <View style={{ height: spacing.sm }} />
      <NHLGoalieTable goalies={boxScore.home?.goalies} teamName={homeAbbr} onPlayerPress={onPlayerPress} />

      <View style={{ height: 40 }} />
    </View>
  );
}

// NHL play row: goals get big green highlight, penalties yellow, fights red
const NHL_PLAY_CONFIG = {
  goal:        { bg: colors.green + '22', border: colors.green + '55', label: 'GOAL',  labelColor: colors.green,  isGoal: true  },
  goal_pp:     { bg: colors.green + '22', border: colors.green + '55', label: 'PP',    labelColor: colors.green,  isGoal: true  },
  goal_sh:     { bg: colors.green + '33', border: colors.green,        label: 'SH',    labelColor: colors.green,  isGoal: true  },
  goal_en:     { bg: colors.green + '18', border: colors.green + '44', label: 'EN',    labelColor: colors.green,  isGoal: true  },
  penalty:     { bg: '#FF990012',         border: '#FF990033',         label: 'PEN',   labelColor: '#FF9900',     isGoal: false },
  fight:       { bg: colors.red + '18',   border: colors.red + '44',   label: 'FIGHT', labelColor: colors.red,    isGoal: false },
  goalie_pull: { bg: '#8888FF12',         border: '#8888FF44',         label: 'PULL',  labelColor: '#AAAAFF',     isGoal: false },
  shot:        { bg: 'transparent',       border: 'transparent',       label: 'SOG',   labelColor: colors.grey,   isGoal: false },
  normal:      { bg: 'transparent',       border: 'transparent',       label: '',      labelColor: colors.grey,   isGoal: false },
};

function NHLPlayRow({ play, isNew }) {
  const fadeIn = useRef(new Animated.Value(isNew ? 0 : 1)).current;
  useEffect(() => {
    if (isNew) Animated.timing(fadeIn, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const cfg = NHL_PLAY_CONFIG[play.category] || NHL_PLAY_CONFIG.normal;
  const hasScore = play.awayScore != null && play.homeScore != null;

  return (
    <Animated.View style={[
      nhlStyles.playRow,
      { backgroundColor: cfg.bg, opacity: fadeIn },
      cfg.isGoal && nhlStyles.goalRow,
    ]}>
      {/* Type badge */}
      {!!cfg.label && (
        <View style={[nhlStyles.typeBadge, { borderColor: cfg.border }]}>
          <Text style={[nhlStyles.typeText, { color: cfg.labelColor }]}>{cfg.label}</Text>
        </View>
      )}
      {/* Time */}
      <Text style={[nhlStyles.playTime, cfg.isGoal && { color: colors.green }]}>{play.time}</Text>
      {/* Description */}
      <Text style={[nhlStyles.playEvent, cfg.isGoal && nhlStyles.goalEvent]} numberOfLines={cfg.isGoal ? 4 : 2}>
        {play.event}
      </Text>
      {/* Running score */}
      {hasScore && (
        <Text style={[nhlStyles.playScore, cfg.isGoal && { color: colors.offWhite, fontWeight: '800' }]}>
          {play.awayScore}–{play.homeScore}
        </Text>
      )}
    </Animated.View>
  );
}

// Goalie matchup card for NHL Game Info tab
function NHLGoalieMatchup({ goalieMatchup, awayAbbr, homeAbbr }) {
  if (!goalieMatchup?.away && !goalieMatchup?.home) return null;
  const GoalieCard = ({ goalie, abbr }) => {
    if (!goalie) return <View style={{ flex: 1 }} />;
    return (
      <View style={nhlStyles.goalieCard}>
        <Text style={nhlStyles.goalieTeam}>{abbr}</Text>
        <Text style={nhlStyles.goalieName} numberOfLines={2}>{goalie.name}</Text>
        <View style={nhlStyles.goalieStats}>
          <View style={nhlStyles.goalieStat}>
            <Text style={nhlStyles.goalieStatVal}>{goalie.svPct}</Text>
            <Text style={nhlStyles.goalieStatLabel}>SV%</Text>
          </View>
          <View style={nhlStyles.goalieStat}>
            <Text style={nhlStyles.goalieStatVal}>{goalie.gaa}</Text>
            <Text style={nhlStyles.goalieStatLabel}>GAA</Text>
          </View>
          <View style={nhlStyles.goalieStat}>
            <Text style={nhlStyles.goalieStatVal}>{goalie.record}</Text>
            <Text style={nhlStyles.goalieStatLabel}>W-L-OT</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={nhlStyles.goalieMatchupRow}>
      <GoalieCard goalie={goalieMatchup.away} abbr={awayAbbr} />
      <View style={nhlStyles.goalieVsDivider}><Text style={nhlStyles.goalieVsText}>VS</Text></View>
      <GoalieCard goalie={goalieMatchup.home} abbr={homeAbbr} />
    </View>
  );
}

// ── NHL styles ─────────────────────────────────────────────────────────────────
const nhlStyles = StyleSheet.create({
  playerNameLink: {
    textDecorationLine: 'underline',
    textDecorationColor: '#3a3a3a',
    textDecorationStyle: 'solid',
  },

  // Strength badge
  strengthBadge: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  strengthPill: {
    paddingHorizontal: spacing.lg || 20,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1.5,
  },
  strengthText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // Period line score
  lineScoreCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
  },
  lsHdr: {
    color: colors.grey,
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'uppercase',
  },
  lsTeam: {
    width: 40,
    fontSize: 13,
    fontWeight: '700',
    color: colors.offWhite,
  },
  lsCell: {
    width: 28,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '500',
    color: colors.offWhite,
  },
  lsGoals: {
    width: 28,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: colors.grey,
  },
  lsWinner: {
    color: colors.offWhite,
    fontWeight: '900',
  },
  lsEmpty: {
    color: colors.grey,
  },
  lsDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },

  // Shared table block
  tableBlock: {
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tableTeamName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },

  // Skater row
  sRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '44',
  },
  sRowAlt: {
    backgroundColor: colors.surfaceAlt + '44',
  },
  sRowScorer: {
    backgroundColor: colors.green + '08',
  },
  starterRow: {
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
    paddingLeft: 4,
  },
  sHdr: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  sName: {
    width: 124,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingRight: 4,
  },
  sNameText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.offWhite,
    flex: 1,
  },
  starterText: {
    fontWeight: '700',
  },
  sPos: {
    width: 32,
    fontSize: 11,
    color: colors.grey,
    textAlign: 'center',
  },
  sSm: {
    width: 34,
    fontSize: 13,
    color: colors.offWhite,
    textAlign: 'center',
  },
  ptsCell: {
    fontWeight: '700',
  },
  goalHighlight: {
    color: colors.green,
    fontWeight: '800',
  },
  scorerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.green,
    flexShrink: 0,
  },
  sTOI: {
    width: 46,
    fontSize: 12,
    color: colors.grey,
    textAlign: 'right',
  },
  // Goalie columns
  gName: {
    width: 140,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingRight: 4,
  },
  gNameText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.offWhite,
    flex: 1,
  },
  gSvPct: {
    width: 50,
    fontSize: 12,
    color: colors.greyLight,
    textAlign: 'center',
  },
  decisionBadge: {
    fontSize: 11,
    fontWeight: '800',
  },

  // NHL play row
  playRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '33',
    gap: spacing.sm,
  },
  goalRow: {
    paddingVertical: 14,
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
  },
  typeBadge: {
    minWidth: 44,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    flexShrink: 0,
  },
  typeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  playTime: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.red,
    width: 40,
    flexShrink: 0,
  },
  playEvent: {
    flex: 1,
    fontSize: 12,
    color: colors.offWhite,
    lineHeight: 18,
  },
  goalEvent: {
    fontSize: 13,
    fontWeight: '600',
  },
  playScore: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.grey,
    width: 36,
    textAlign: 'right',
    flexShrink: 0,
  },

  // Goalie matchup
  goalieMatchupRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  goalieCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  goalieTeam: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  goalieName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.offWhite,
    lineHeight: 18,
  },
  goalieStats: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 4,
  },
  goalieStat: {
    alignItems: 'center',
    flex: 1,
  },
  goalieStatVal: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.offWhite,
  },
  goalieStatLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  goalieVsDivider: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  goalieVsText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.grey,
    letterSpacing: 1,
  },
});

// ── Game Hero ─────────────────────────────────────────────────────────────────

function GameHero({ game }) {
  const { awayTeam, homeTeam, status, clock, league } = game;
  const getLogo  = useTeamLogos();
  const isLive   = status === 'live';
  const isFinal  = status === 'final';
  const awayWon  = isFinal && awayTeam.score > homeTeam.score;
  const homeWon  = isFinal && homeTeam.score > awayTeam.score;

  return (
    <View style={styles.hero}>
      {/* Away team */}
      <View style={[styles.heroTeam, { alignItems: 'flex-start' }]}>
        <TeamLogo uri={getLogo(awayTeam.abbr, league)} abbr={awayTeam.abbr} size={56} />
        <Text style={[styles.heroAbbr, (awayWon || (isLive && awayTeam.score > homeTeam.score)) && styles.heroAbbrWin]}>
          {awayTeam.abbr}
        </Text>
        <Text style={styles.heroFullName} numberOfLines={2}>{awayTeam.name}</Text>
        <Text style={styles.heroSide}>Away</Text>
      </View>

      {/* Center: score / time */}
      <View style={styles.heroCenter}>
        {status === 'upcoming' ? (
          <>
            <Text style={styles.heroVS}>vs</Text>
            <Text style={styles.heroTipOff}>{clock}</Text>
          </>
        ) : (
          <View style={styles.heroScoreRow}>
            <FlashScore score={awayTeam.score} isLive={isLive}
              style={awayWon && styles.heroScoreWin} />
            <Text style={styles.heroScoreSep}>–</Text>
            <FlashScore score={homeTeam.score} isLive={isLive}
              style={homeWon && styles.heroScoreWin} />
          </View>
        )}

        {isLive && (
          <View style={styles.heroLive}>
            <PulsingDot />
            <Text style={styles.heroLiveText}>{clock}</Text>
          </View>
        )}
        {isFinal && (
          <Text style={styles.heroFinal}>Final</Text>
        )}
      </View>

      {/* Home team */}
      <View style={[styles.heroTeam, { alignItems: 'flex-end' }]}>
        <TeamLogo uri={getLogo(homeTeam.abbr, league)} abbr={homeTeam.abbr} size={56} />
        <Text style={[styles.heroAbbr, (homeWon || (isLive && homeTeam.score > awayTeam.score)) && styles.heroAbbrWin]}>
          {homeTeam.abbr}
        </Text>
        <Text style={[styles.heroFullName, { textAlign: 'right' }]} numberOfLines={2}>
          {homeTeam.name}
        </Text>
        <Text style={styles.heroSide}>Home</Text>
      </View>
    </View>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({ activeTab, onPress, tabs = TABS }) {
  const indicatorX = useRef(new Animated.Value(0)).current;
  const TAB_W = SCREEN_WIDTH / tabs.length;

  useEffect(() => {
    Animated.spring(indicatorX, {
      toValue: activeTab * TAB_W,
      tension: 280,
      friction: 28,
      useNativeDriver: true,
    }).start();
  }, [activeTab, TAB_W]);

  return (
    <View style={styles.tabBar}>
      <Animated.View
        style={[
          styles.tabIndicator,
          { width: TAB_W, transform: [{ translateX: indicatorX }] },
        ]}
      />
      {tabs.map((label, i) => (
        <TouchableOpacity
          key={label}
          style={[styles.tab, { width: TAB_W }]}
          onPress={() => onPress(i)}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, activeTab === i && styles.tabTextActive]}>
            {label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Chalky pick banner ────────────────────────────────────────────────────────

function ChalkBanner({ chalkPick }) {
  if (!chalkPick) return null;
  const isWin  = chalkPick.result === 'winning' || chalkPick.result === 'win';
  const isLoss = chalkPick.result === 'losing'  || chalkPick.result === 'loss';
  const resultLabel = isWin ? ' · Winning ✓' : isLoss ? ' · Losing' : '';

  return (
    <View style={[
      styles.chalkBanner,
      isWin  && styles.chalkBannerWin,
      isLoss && styles.chalkBannerLoss,
    ]}>
      <Text style={styles.chalkIcon}>🎯</Text>
      <Text style={[
        styles.chalkText,
        isWin  && { color: colors.green },
        isLoss && { color: colors.red },
      ]}>
        Chalky: {chalkPick.pick}{resultLabel}
      </Text>
    </View>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function GameDetailModal({ game, visible, onClose }) {
  const [activeTab,      setActiveTab]      = useState(0);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [boxScore,       setBoxScore]       = useState(null);
  const [plays,          setPlays]          = useState(null);
  const [gameInfo,       setGameInfo]       = useState(null);
  const [oddsData,       setOddsData]       = useState(null);
  const [mlbLiveState,   setMLBLiveState]   = useState(null);
  const [leadersData,    setLeadersData]    = useState(null);
  const [chalkyTake,     setChalkyTake]     = useState(null);
  const [bsLoading,      setBsLoading]      = useState(false);
  const [pbpLoading,     setPbpLoading]     = useState(false);
  const [infoLoading,    setInfoLoading]    = useState(false);
  const [oddsLoading,    setOddsLoading]    = useState(false);
  const [leadersLoading, setLeadersLoading] = useState(false);
  const [chalkyLoading,  setChalkyLoading]  = useState(false);
  const [showLiveBanner, setShowLiveBanner] = useState(false);
  const pollRef       = useRef(null);
  const prevStatusRef = useRef(null);

  const isMLB = game?.league === 'MLB';
  const isNHL = game?.league === 'NHL';

  const fetchAll = useCallback(async ({ silent = false } = {}) => {
    if (!game) return;
    const hasNBA = !!game.nbaGameId;
    const hasSD  = !!game.sdGameId && !!game.league;
    if (!hasNBA && !hasSD) return;

    if (!silent) {
      setBsLoading(true);
      setPbpLoading(true);
    }

    let bs  = null;
    let pbp = null;

    if (hasNBA) {
      [bs, pbp] = await Promise.all([
        fetchNBALiveBoxScore(game.nbaGameId),
        fetchNBAPlayByPlay(game.nbaGameId),
      ]);
    }
    if (!bs && hasSD) {
      [bs, pbp] = await Promise.all([
        fetchSportsBoxScore(game.league, game.sdGameId),
        fetchSportsPBP(game.league, game.sdGameId),
      ]);
    }

    setBoxScore(bs);
    setPlays(Array.isArray(pbp) ? pbp : []);
    if (!silent) {
      setBsLoading(false);
      setPbpLoading(false);
    }

    // MLB: also fetch live at-bat state
    if (isMLB && game.sdGameId && game.status === 'live') {
      const today = new Date().toISOString().split('T')[0];
      const live  = await fetchMLBLiveState(game.sdGameId, today);
      // Prefer live API state; fall back to liveState embedded in box score
      setMLBLiveState(live || bs?.liveState || null);
    }
  }, [game?.nbaGameId, game?.sdGameId, game?.league, game?.status, isMLB]);

  const fetchInfo = useCallback(async () => {
    if (!game?.league || !game?.awayTeam?.abbr || !game?.homeTeam?.abbr) return;
    setInfoLoading(true);
    // Use free-API endpoint (no sdGameId needed) — works for all games including ESPN-sourced
    const info = await fetchGameDetails(
      game.league,
      game.awayTeam.abbr,
      game.homeTeam.abbr,
    );
    // Fall back to SD.io endpoint if free APIs returned nothing useful
    if (!info || (!info.awayLast5?.length && !info.awayTeamStats && game?.sdGameId)) {
      const sdInfo = await fetchGameInfo(game.league, game.sdGameId, game.awayTeam.abbr, game.homeTeam.abbr);
      setGameInfo(sdInfo || info);
    } else {
      setGameInfo(info);
    }
    setInfoLoading(false);
  }, [game?.league, game?.awayTeam?.abbr, game?.homeTeam?.abbr, game?.sdGameId]);

  const fetchOdds = useCallback(async () => {
    if (!game?.league || !game?.awayTeam?.abbr || !game?.homeTeam?.abbr) return;
    setOddsLoading(true);
    const odds = await fetchGameOdds(
      game.league,
      game.awayTeam.abbr,
      game.homeTeam.abbr,
      game.awayTeam.name,
      game.homeTeam.name,
    );
    setOddsData(odds);
    setOddsLoading(false);
  }, [game?.league, game?.awayTeam?.abbr, game?.homeTeam?.abbr, game?.awayTeam?.name, game?.homeTeam?.name]);

  const fetchLeaders = useCallback(async () => {
    if (!game?.league || !game?.awayTeam?.abbr || !game?.homeTeam?.abbr) return;
    setLeadersLoading(true);
    const data = await fetchTeamLeaders(game.league, game.awayTeam.abbr, game.homeTeam.abbr);
    setLeadersData(data);
    setLeadersLoading(false);
  }, [game?.league, game?.awayTeam?.abbr, game?.homeTeam?.abbr]);

  const fetchChalky = useCallback(async () => {
    if (!game?.league || !game?.awayTeam?.abbr || !game?.homeTeam?.abbr) return;
    setChalkyLoading(true);
    // Build context from available data (oddsData may not be ready yet — that's OK)
    const ctx = {};
    if (oddsData?.spread?.[0]) {
      const sp = oddsData.spread[0];
      ctx.spread = sp.awayLine || '';
      ctx.total  = oddsData.total?.[0]?.line ?? '';
    }
    const take = await fetchChalkyTake(
      game.league,
      game.awayTeam.abbr,
      game.homeTeam.abbr,
      ctx,
    );
    setChalkyTake(take);
    setChalkyLoading(false);
  }, [game?.league, game?.awayTeam?.abbr, game?.homeTeam?.abbr, oddsData]);

  useEffect(() => {
    if (!visible) {
      setBoxScore(null);
      setPlays(null);
      setGameInfo(null);
      setOddsData(null);
      setMLBLiveState(null);
      setLeadersData(null);
      setChalkyTake(null);
      setActiveTab(0);
      setSelectedPlayer(null);
      setShowLiveBanner(false);
      prevStatusRef.current = null;
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    fetchAll();
    fetchInfo();
    if (game?.status === 'upcoming' || game?.status === 'scheduled') {
      fetchOdds();
      fetchLeaders();
    }

    if (game?.status === 'live') {
      pollRef.current = setInterval(() => fetchAll({ silent: true }), 30000);
    }

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [visible, fetchAll, fetchInfo, fetchOdds, fetchLeaders]);

  // Fetch Chalky's take once odds (and info) have loaded for upcoming games
  const isUpcomingGame = game?.status === 'upcoming' || game?.status === 'scheduled';
  useEffect(() => {
    if (!visible || !isUpcomingGame) return;
    if (!oddsData && !gameInfo) return; // wait for at least one data source
    if (chalkyTake || chalkyLoading) return; // already fetched
    fetchChalky();
  }, [visible, isUpcomingGame, oddsData, gameInfo, chalkyTake, chalkyLoading, fetchChalky]);

  // Detect upcoming → live transition
  useEffect(() => {
    if (!game?.status) return;
    const prev = prevStatusRef.current;
    if (prev === 'upcoming' && game.status === 'live') {
      setShowLiveBanner(true);
      setActiveTab(0);
      setTimeout(() => setShowLiveBanner(false), 3500);
    }
    prevStatusRef.current = game.status;
  }, [game?.status]);

  if (!game) return null;

  const { chalkPick, status, league } = game;
  const isLive     = status === 'live';
  const isUpcoming = status === 'upcoming' || status === 'scheduled';
  const activeTabs = isUpcoming ? PRE_TABS : (isMLB ? TABS : ['Box Score', 'Game Info']);

  // For MLB, derive live state from the box score if the poll hasn't returned yet
  const activeLiveState = mlbLiveState || (isMLB && boxScore?.liveState) || null;
  const weather         = isMLB ? (boxScore?.weather || null) : null;

  // NHL: derive current strength from the most recent play with a Strength annotation
  const nhlStrength = (() => {
    if (!isNHL || !plays || plays.length === 0) return null;
    const recent = plays[0];
    if (!recent?.strength) return null;
    const s = recent.strength.toLowerCase();
    if (s.includes('power play'))  return 'PP';
    if (s.includes('short hand'))  return 'SH';
    if (s.includes('empty net'))   return 'EN';
    return null;
  })();

  // Play by Play uses sport-specific renderers
  const renderPBPContent = () => {
    if (isNHL) {
      if (pbpLoading && (!plays || plays.length === 0)) {
        return (
          <View style={{ padding: spacing.md, gap: spacing.sm }}>
            {[...Array(6)].map((_, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: 10 }}>
                <SkeletonBar width={44} height={22} style={{ borderRadius: 5 }} />
                <SkeletonBar width={40} height={12} />
                <SkeletonBar width="55%" height={12} />
              </View>
            ))}
          </View>
        );
      }
      if (!plays || plays.length === 0) {
        return (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🏒</Text>
            <Text style={styles.emptyText}>Play-by-play available at puck drop</Text>
          </View>
        );
      }
      // Group by period
      const nhlGroups = [];
      let lastPeriod = null;
      for (const play of plays) {
        const period = play.quarter;
        const label = period <= 3 ? `Period ${period}` : period === 4 ? 'Overtime' : 'Shootout';
        if (period !== lastPeriod) {
          lastPeriod = period;
          nhlGroups.push({ label, plays: [] });
        }
        nhlGroups[nhlGroups.length - 1].plays.push(play);
      }
      return (
        <ScrollView showsVerticalScrollIndicator={false}>
          {isLive && (
            <View style={styles.pbpLiveHeader}>
              <PulsingDot />
              <Text style={styles.pbpLiveText}>Live Updates</Text>
            </View>
          )}
          {nhlGroups.map((g, gi) => (
            <View key={gi}>
              <View style={styles.pbpQHeader}>
                <Text style={styles.pbpQLabel}>{g.label}</Text>
              </View>
              {g.plays.map((play, pi) => (
                <NHLPlayRow
                  key={`${gi}-${pi}`}
                  play={play}
                  isNew={isLive && gi === 0 && pi < 2}
                />
              ))}
            </View>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      );
    }

    if (isMLB) {
      if (pbpLoading && (!plays || plays.length === 0)) {
        return (
          <View style={{ padding: spacing.md, gap: spacing.sm }}>
            {[...Array(6)].map((_, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: 8 }}>
                <SkeletonBar width={34} height={22} style={{ borderRadius: 5 }} />
                <SkeletonBar width={36} height={12} />
                <SkeletonBar width="55%" height={12} />
              </View>
            ))}
          </View>
        );
      }
      if (!plays || plays.length === 0) {
        return (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>⚾</Text>
            <Text style={styles.emptyText}>Play-by-play available at first pitch</Text>
          </View>
        );
      }
      // Group by inning+half
      const groups = [];
      let lastKey = null;
      for (const play of plays) {
        const key = `${play.quarter}${play.inningHalf || ''}`;
        const label = play.time?.split(' ').slice(0, 2).join(' ') || '';
        if (key !== lastKey) {
          lastKey = key;
          groups.push({ label, plays: [] });
        }
        groups[groups.length - 1].plays.push(play);
      }
      return (
        <ScrollView showsVerticalScrollIndicator={false}>
          {isLive && (
            <View style={styles.pbpLiveHeader}>
              <PulsingDot />
              <Text style={styles.pbpLiveText}>Live Updates</Text>
            </View>
          )}
          {groups.map((g, gi) => (
            <View key={gi}>
              <View style={styles.pbpQHeader}>
                <Text style={styles.pbpQLabel}>Inning {g.label}</Text>
              </View>
              {g.plays.map((play, pi) => (
                <MLBPlayRow
                  key={`${gi}-${pi}`}
                  play={play}
                  isNew={isLive && gi === 0 && pi < 2}
                />
              ))}
            </View>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      );
    }
    // Default (NBA/NHL/NFL)
    return (
      <PlayByPlayTab
        plays={plays}
        loading={pbpLoading}
        isLive={isLive}
        awayAbbr={game.awayTeam.abbr}
        homeAbbr={game.homeTeam.abbr}
      />
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <Text style={styles.leagueBadge}>{league}</Text>
            {isLive && (
              <View style={styles.liveChip}>
                <PulsingDot />
                <Text style={styles.liveChipText}>LIVE</Text>
              </View>
            )}
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Game hero */}
        <GameHero game={game} />

        {/* MLB live panel: inning + bases + BSO + pitcher/batter */}
        {isMLB && isLive && (
          <MLBLivePanel
            liveState={activeLiveState}
            awayAbbr={game.awayTeam.abbr}
            homeAbbr={game.homeTeam.abbr}
          />
        )}

        {/* NHL strength indicator during live games */}
        {isNHL && isLive && nhlStrength && (
          <NHLStrengthBadge strength={nhlStrength} />
        )}

        {/* Chalky pick */}
        <ChalkBanner chalkPick={chalkPick} />

        {/* Tabs */}
        <TabBar activeTab={activeTab} onPress={setActiveTab} tabs={activeTabs} />

        {/* Tab content */}
        {isUpcoming ? (
          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {activeTab === 0 && (
              <PreviewTab
                game={game}
                gameInfo={gameInfo}
                loading={infoLoading}
                leadersData={leadersData}
                chalkyTake={chalkyTake}
                leadersLoading={leadersLoading}
                chalkyLoading={chalkyLoading}
              />
            )}
            {activeTab === 1 && (
              <MatchupTab game={game} gameInfo={gameInfo} loading={infoLoading} />
            )}
            {activeTab === 2 && (
              <OddsTab game={game} oddsData={oddsData} loading={oddsLoading} />
            )}
            {activeTab === 3 && (
              <InjuriesTab game={game} gameInfo={gameInfo} loading={infoLoading} />
            )}
          </ScrollView>
        ) : (
          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {activeTab === 0 && (
              isMLB
                ? <MLBBoxScoreTab game={game} boxScore={boxScore} loading={bsLoading} onPlayerPress={(name) => setSelectedPlayer({ name, league: game.league })} />
                : isNHL
                  ? <NHLBoxScoreTab game={game} boxScore={boxScore} loading={bsLoading} onPlayerPress={(name) => setSelectedPlayer({ name, league: game.league })} />
                  : <BoxScoreTab    game={game} boxScore={boxScore} loading={bsLoading} onPlayerPress={(name) => setSelectedPlayer({ name, league: game.league })} />
            )}
            {activeTab === 1 && isMLB && (
              <View style={{ flex: 1, paddingHorizontal: 0 }}>
                {renderPBPContent()}
              </View>
            )}
            {(isMLB ? activeTab === 2 : activeTab === 1) && (
              <GameInfoTab
                game={game}
                gameInfo={gameInfo}
                loading={infoLoading}
                weather={weather}
                goalieMatchup={isNHL ? (gameInfo?.goalieMatchup || null) : null}
              />
            )}
          </ScrollView>
        )}

        {/* Live transition banner — slides in when game goes live */}
        <LiveTransitionBanner visible={showLiveBanner} />
      </SafeAreaView>

      <PlayerProfileModal
        visible={!!selectedPlayer}
        playerName={selectedPlayer?.name}
        playerLeague={selectedPlayer?.league || 'NBA'}
        onClose={() => setSelectedPlayer(null)}
      />
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  leagueBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.red + '18',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.red + '44',
  },
  liveChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.red,
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: colors.grey,
    fontSize: 13,
    fontWeight: '600',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.red,
  },

  // Game hero
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  heroTeam: {
    flex: 1,
    gap: 6,
  },
  heroAbbr: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.grey,
    marginTop: 6,
  },
  heroAbbrWin: {
    color: colors.offWhite,
  },
  heroFullName: {
    fontSize: 11,
    color: colors.grey,
    lineHeight: 15,
  },
  heroSide: {
    fontSize: 10,
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroCenter: {
    flex: 1.2,
    alignItems: 'center',
    paddingTop: 4,
    gap: 6,
  },
  heroScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heroScore: {
    fontSize: 44,
    fontWeight: '900',
    color: colors.grey,
    letterSpacing: -1,
  },
  heroScoreWin: {
    color: colors.offWhite,
  },
  heroScoreSep: {
    fontSize: 28,
    color: colors.grey,
    fontWeight: '300',
  },
  heroVS: {
    fontSize: 20,
    color: colors.grey,
    fontWeight: '300',
  },
  heroTipOff: {
    fontSize: 13,
    color: colors.grey,
    fontWeight: '600',
    textAlign: 'center',
  },
  heroLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  heroLiveText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.red,
    letterSpacing: 0.3,
  },
  heroFinal: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // Chalk banner
  chalkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chalkBannerWin: {
    backgroundColor: colors.green + '14',
    borderColor: colors.green + '33',
  },
  chalkBannerLoss: {
    backgroundColor: colors.red + '14',
    borderColor: colors.red + '33',
  },
  chalkIcon: {
    fontSize: 14,
  },
  chalkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey,
    flex: 1,
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginTop: spacing.sm,
    position: 'relative',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 2,
    backgroundColor: colors.green,
    borderRadius: 1,
  },
  tab: {
    paddingVertical: 11,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey,
  },
  tabTextActive: {
    color: colors.green,
  },

  // Scroll
  scroll: {
    flex: 1,
  },

  // Section labels
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },

  // Line score
  lineScoreCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
  },
  lsHeader: {
    color: colors.grey,
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'uppercase',
  },
  lsTeamCell: {
    width: 40,
    fontSize: 13,
    fontWeight: '700',
    color: colors.offWhite,
  },
  lsTeamLabel: {
    color: colors.offWhite,
  },
  lsQCell: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.offWhite,
    textAlign: 'center',
  },
  lsEmpty: {
    color: colors.grey,
  },
  lsTotalCell: {
    width: 32,
    fontSize: 14,
    fontWeight: '800',
    color: colors.grey,
    textAlign: 'right',
  },
  lsWinner: {
    color: colors.offWhite,
  },
  lsDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },

  // Team stats
  teamStatsBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  teamStatsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  teamStatsAbbr: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.offWhite,
    width: 44,
  },
  teamStatsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statBarVal: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.grey,
    width: 44,
  },
  statBarValBetter: {
    color: colors.offWhite,
  },
  statBarLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },

  // Player table
  playerBlock: {
    marginTop: spacing.lg,
  },
  blockLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.offWhite,
    marginBottom: spacing.sm,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '55',
    flexWrap: 'wrap',
  },
  playerRowHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 7,
  },
  playerRowTop: {
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
    paddingLeft: spacing.xs,
  },
  totalsRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 0,
    paddingTop: 10,
  },
  totalsLabel: {
    fontWeight: '700',
    color: colors.grey,
  },
  pHeaderText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  pName: {
    width: 110,
    fontSize: 13,
    fontWeight: '500',
    color: colors.offWhite,
    paddingRight: 4,
  },
  playerNameLink: {
    textDecorationLine: 'underline',
    textDecorationColor: '#3a3a3a',
    textDecorationStyle: 'solid',
  },
  pPos: {
    width: 28,
    fontSize: 11,
    color: colors.grey,
    textAlign: 'center',
  },
  pMin: {
    width: 30,
    fontSize: 12,
    color: colors.grey,
    textAlign: 'center',
  },
  pStat: {
    width: 34,
    fontSize: 13,
    color: colors.offWhite,
    textAlign: 'center',
  },
  pPTS: {
    fontWeight: '700',
  },
  pFG: {
    width: 48,
    fontSize: 11,
    color: colors.greyLight,
    textAlign: 'center',
  },
  pPM: {
    width: 32,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  advancedRow: {
    flexDirection: 'row',
    width: '100%',
    paddingTop: spacing.sm,
    paddingLeft: 4,
    gap: spacing.lg,
  },
  advancedItem: {
    alignItems: 'center',
    gap: 2,
  },
  advancedVal: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.offWhite,
  },
  advancedLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Play by play
  pbpLiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pbpLiveText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.red,
    letterSpacing: 0.5,
  },
  pbpQHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '66',
  },
  pbpQLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  pbpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '44',
    gap: spacing.sm,
  },
  pbpDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  pbpTime: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.green,
    width: 68,
    flexShrink: 0,
  },
  pbpEvent: {
    flex: 1,
    fontSize: 13,
    color: colors.offWhite,
    lineHeight: 19,
  },
  pbpScore: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.grey,
    width: 44,
    textAlign: 'right',
    flexShrink: 0,
  },

  // Game Info
  infoSection: {
    marginTop: spacing.lg,
  },
  infoSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  infoVal: {
    fontSize: 14,
    color: colors.offWhite,
    fontWeight: '500',
  },
  infoSubVal: {
    fontSize: 12,
    color: colors.grey,
    marginTop: 2,
  },
  last5Block: {
    marginBottom: spacing.sm,
  },
  last5TeamName: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.grey,
    marginBottom: spacing.sm,
  },
  last5Pills: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  last5Pill: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  last5Win: {
    backgroundColor: colors.green + '25',
    borderWidth: 1,
    borderColor: colors.green + '55',
  },
  last5Loss: {
    backgroundColor: colors.red + '20',
    borderWidth: 1,
    borderColor: colors.red + '44',
  },
  last5PillText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.offWhite,
  },
  last5Opp: {
    fontSize: 10,
    color: colors.grey,
    width: 32,
    textAlign: 'center',
  },
  last5Score: {
    fontSize: 10,
    color: colors.grey,
    width: 32,
    textAlign: 'center',
  },
  h2hRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '55',
  },
  h2hDate: {
    fontSize: 12,
    color: colors.grey,
    width: 60,
  },
  h2hResult: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  h2hTeam: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey,
    width: 40,
    textAlign: 'center',
  },
  h2hWinner: {
    color: colors.offWhite,
    fontWeight: '800',
  },
  h2hScoreText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.offWhite,
  },
  injuryTeamHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  injuryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '44',
    gap: spacing.sm,
  },
  injuryName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.offWhite,
  },
  injuryDesc: {
    fontSize: 11,
    color: colors.grey,
    marginTop: 2,
    lineHeight: 16,
  },
  injuryStatus: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  // Empty / loading states
  emptyState: {
    paddingTop: 60,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyIcon: {
    fontSize: 36,
  },
  emptyText: {
    fontSize: 14,
    color: colors.grey,
    textAlign: 'center',
  },
});
