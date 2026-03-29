import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, SafeAreaView, StatusBar,
  TouchableOpacity, ActivityIndicator, Animated, Modal, Pressable,
} from 'react-native';
import { colors, spacing, radius } from '../theme';
import { API_URL } from '../config';

const UFC_RED   = '#E8000A';
const UFC_GOLD  = '#C8A84B';

// ── helpers ───────────────────────────────────────────────────────────────────

function pct(v) { return Math.round((v || 0) * 100); }

function formatDate(ds) {
  if (!ds) return '';
  const d = new Date(ds);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function confColor(c) {
  if (c >= 75) return colors.green;
  if (c >= 65) return UFC_GOLD;
  return colors.grey;
}

// ── Fight detail modal ────────────────────────────────────────────────────────

function FightDetailModal({ visible, fight, projections, onClose }) {
  if (!fight) return null;

  const fa = fight.fighter_a;
  const fb = fight.fighter_b;

  const mlProj = projections.filter(p => p.prop_type === 'moneyline');
  const projA  = mlProj.find(p => p.fighter_name?.toLowerCase() === fa?.toLowerCase());
  const projB  = mlProj.find(p => p.fighter_name?.toLowerCase() === fb?.toLowerCase());

  const methodMap = { ko_tko: 'KO / TKO', submission: 'Submission', decision: 'Decision' };
  const roundMap  = { round_1: 'Round 1', round_2: 'Round 2', round_3_plus: 'Round 3+' };

  const methodProjs = projections.filter(p => p.prop_type in methodMap && p.fighter_name?.toLowerCase() === fa?.toLowerCase());
  const roundProjs  = projections.filter(p => p.prop_type in roundMap  && p.fighter_name?.toLowerCase() === fa?.toLowerCase());

  const sigA = projections.find(p => p.prop_type === 'sig_strikes' && p.fighter_name?.toLowerCase() === fa?.toLowerCase());
  const sigB = projections.find(p => p.prop_type === 'sig_strikes' && p.fighter_name?.toLowerCase() === fb?.toLowerCase());
  const tdA  = projections.find(p => p.prop_type === 'takedowns'   && p.fighter_name?.toLowerCase() === fa?.toLowerCase());
  const tdB  = projections.find(p => p.prop_type === 'takedowns'   && p.fighter_name?.toLowerCase() === fb?.toLowerCase());

  const factorsA = projA?.factors_json || {};
  const styleA   = factorsA.style || '';
  const styleB   = factorsA.style_b || projB?.factors_json?.style || '';

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={dm.backdrop}>
        <View style={dm.sheet}>
          {/* Handle */}
          <View style={dm.handle} />

          {/* Header */}
          <View style={dm.header}>
            <Text style={dm.weightClass}>{fight.weight_class || 'Bout'}</Text>
            {fight.is_main_event && <View style={dm.mainBadge}><Text style={dm.mainBadgeText}>MAIN EVENT</Text></View>}
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
            {/* Matchup header */}
            <View style={dm.matchupRow}>
              <View style={dm.fighterCol}>
                <Text style={dm.fighterName} numberOfLines={2}>{fa}</Text>
                {styleA ? <Text style={dm.styleTag}>{styleA.replace('_', ' ')}</Text> : null}
              </View>
              <View style={dm.vsCircle}><Text style={dm.vsText}>VS</Text></View>
              <View style={[dm.fighterCol, { alignItems: 'flex-end' }]}>
                <Text style={[dm.fighterName, { textAlign: 'right' }]} numberOfLines={2}>{fb}</Text>
                {styleB ? <Text style={dm.styleTag}>{styleB.replace('_', ' ')}</Text> : null}
              </View>
            </View>

            {/* Win probability */}
            {(projA || projB) && (
              <View style={dm.section}>
                <Text style={dm.sectionTitle}>WIN PROBABILITY</Text>
                <WinProbBar probA={projA?.proj_value || 0.5} probB={projB?.proj_value || 0.5} nameA={fa} nameB={fb} />
                <View style={dm.confRow}>
                  <Text style={[dm.confVal, { color: confColor(projA?.confidence_score) }]}>
                    {projA?.confidence_score || 0}% confidence
                  </Text>
                  <Text style={[dm.confVal, { color: confColor(projB?.confidence_score), textAlign: 'right' }]}>
                    {projB?.confidence_score || 0}% confidence
                  </Text>
                </View>
              </View>
            )}

            {/* Method breakdown */}
            {methodProjs.length > 0 && (
              <View style={dm.section}>
                <Text style={dm.sectionTitle}>FINISH METHOD</Text>
                {methodProjs.map(p => (
                  <View key={p.prop_type} style={dm.barRow}>
                    <Text style={dm.barLabel}>{methodMap[p.prop_type]}</Text>
                    <View style={dm.barTrack}>
                      <View style={[dm.barFill, { width: `${pct(p.proj_value)}%`, backgroundColor: p.prop_type === 'decision' ? colors.grey : UFC_RED }]} />
                    </View>
                    <Text style={dm.barPct}>{pct(p.proj_value)}%</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Round breakdown */}
            {roundProjs.length > 0 && (
              <View style={dm.section}>
                <Text style={dm.sectionTitle}>ROUND FINISH PROBABILITY</Text>
                {roundProjs.map(p => (
                  <View key={p.prop_type} style={dm.barRow}>
                    <Text style={dm.barLabel}>{roundMap[p.prop_type]}</Text>
                    <View style={dm.barTrack}>
                      <View style={[dm.barFill, { width: `${pct(p.proj_value)}%`, backgroundColor: UFC_GOLD }]} />
                    </View>
                    <Text style={dm.barPct}>{pct(p.proj_value)}%</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Projected stats */}
            {(sigA || sigB || tdA || tdB) && (
              <View style={dm.section}>
                <Text style={dm.sectionTitle}>PROJECTED STATS PER FIGHT</Text>
                <View style={dm.statsGrid}>
                  <StatBox label="Sig. Strikes" valA={sigA?.proj_value} valB={sigB?.proj_value} nameA={fa} nameB={fb} />
                  <StatBox label="Takedowns" valA={tdA?.proj_value} valB={tdB?.proj_value} nameA={fa} nameB={fb} />
                </View>
              </View>
            )}

            {/* Model factors */}
            {factorsA && factorsA.win_rate_l10 !== undefined && (
              <View style={dm.section}>
                <Text style={dm.sectionTitle}>MODEL FACTORS — {fa}</Text>
                <View style={dm.factorGrid}>
                  <FactorChip label="Win Rate L10" value={`${pct(factorsA.win_rate_l10)}%`} />
                  <FactorChip label="Finish Rate"  value={`${pct(factorsA.finish_rate)}%`} />
                  <FactorChip label="KO Rate"      value={`${pct(factorsA.ko_rate)}%`} />
                  <FactorChip label="Sub Rate"     value={`${pct(factorsA.sub_rate)}%`} />
                  <FactorChip label="Fights Used"  value={factorsA.fights_sampled || 0} />
                  <FactorChip label="Avg Sig Str"  value={Math.round(factorsA.avg_sig || 0)} />
                </View>
              </View>
            )}
          </ScrollView>

          <Pressable style={dm.closeBtn} onPress={onClose}>
            <Text style={dm.closeBtnText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function WinProbBar({ probA, probB, nameA, nameB }) {
  const pA = Math.round(probA * 100);
  const pB = 100 - pA;
  return (
    <View>
      <View style={dm.probTrack}>
        <View style={[dm.probFillA, { flex: probA }]} />
        <View style={[dm.probFillB, { flex: probB }]} />
      </View>
      <View style={dm.probLabels}>
        <Text style={[dm.probPct, { color: probA >= 0.5 ? colors.green : colors.grey }]}>{pA}%</Text>
        <Text style={[dm.probPct, { color: probB > probA ? colors.green : colors.grey, textAlign: 'right' }]}>{pB}%</Text>
      </View>
    </View>
  );
}

function StatBox({ label, valA, valB, nameA, nameB }) {
  return (
    <View style={dm.statBox}>
      <Text style={dm.statLabel}>{label}</Text>
      <View style={dm.statRow}>
        <View style={dm.statFighter}>
          <Text style={dm.statName} numberOfLines={1}>{nameA?.split(' ').pop()}</Text>
          <Text style={dm.statVal}>{(valA || 0).toFixed(1)}</Text>
        </View>
        <View style={dm.statDivider} />
        <View style={[dm.statFighter, { alignItems: 'flex-end' }]}>
          <Text style={[dm.statName, { textAlign: 'right' }]} numberOfLines={1}>{nameB?.split(' ').pop()}</Text>
          <Text style={dm.statVal}>{(valB || 0).toFixed(1)}</Text>
        </View>
      </View>
    </View>
  );
}

function FactorChip({ label, value }) {
  return (
    <View style={dm.chip}>
      <Text style={dm.chipLabel}>{label}</Text>
      <Text style={dm.chipVal}>{value}</Text>
    </View>
  );
}

// ── Fight card row ─────────────────────────────────────────────────────────────

function FightRow({ fight, projections, index, onPress }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity,     { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.timing(translateY,  { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start();
    }, index * 80);
    return () => clearTimeout(t);
  }, []);

  const fa = fight.fighter_a;
  const fb = fight.fighter_b;

  const projA = projections.find(p =>
    p.prop_type === 'moneyline' && p.fighter_name?.toLowerCase() === fa?.toLowerCase()
  );
  const projB = projections.find(p =>
    p.prop_type === 'moneyline' && p.fighter_name?.toLowerCase() === fb?.toLowerCase()
  );

  const winnerA = projA && projB ? projA.proj_value >= projB.proj_value : null;

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <TouchableOpacity style={[fr.card, fight.is_main_event && fr.mainCard]} onPress={onPress} activeOpacity={0.75}>
        {fight.is_main_event && (
          <View style={fr.mainBanner}><Text style={fr.mainBannerText}>MAIN EVENT</Text></View>
        )}

        <View style={fr.top}>
          <Text style={fr.weightClass}>{fight.weight_class || 'Bout'}</Text>
          <Text style={fr.cardPos}>#{fight.card_position}</Text>
        </View>

        <View style={fr.matchup}>
          {/* Fighter A */}
          <View style={fr.fighter}>
            <Text style={[fr.name, winnerA === true && fr.nameWinner]} numberOfLines={2}>{fa}</Text>
            {projA && (
              <View style={fr.probBadge}>
                <Text style={[fr.probText, { color: winnerA ? colors.green : colors.grey }]}>
                  {pct(projA.proj_value)}%
                </Text>
              </View>
            )}
          </View>

          {/* VS divider */}
          <View style={fr.vsDivider}>
            <View style={fr.vsLine} />
            <Text style={fr.vsLabel}>VS</Text>
            <View style={fr.vsLine} />
          </View>

          {/* Fighter B */}
          <View style={[fr.fighter, { alignItems: 'flex-end' }]}>
            <Text style={[fr.name, { textAlign: 'right' }, winnerA === false && fr.nameWinner]} numberOfLines={2}>{fb}</Text>
            {projB && (
              <View style={fr.probBadge}>
                <Text style={[fr.probText, { color: !winnerA ? colors.green : colors.grey }]}>
                  {pct(projB.proj_value)}%
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Probability bar */}
        {projA && projB && (
          <View style={fr.barRow}>
            <View style={[fr.barA, { flex: projA.proj_value }]} />
            <View style={[fr.barB, { flex: projB.proj_value }]} />
          </View>
        )}

        <Text style={fr.tapHint}>Tap for full analysis</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function UFCScreen() {
  const [event, setEvent]             = useState(null);
  const [fights, setFights]           = useState([]);
  const [projsByFight, setProjsByFight] = useState({});
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [selectedFight, setSelectedFight] = useState(null);
  const [modalVisible, setModalVisible]   = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/ufc/event`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!data.event) {
        setEvent(null);
        setFights([]);
        setLoading(false);
        return;
      }

      setEvent(data.event);
      const fightList = data.fights || [];
      setFights(fightList);

      // Load projections for all fights in parallel
      const projResults = await Promise.all(
        fightList.map(f => fetch(`${API_URL}/api/ufc/projections/${f.id}`).then(r => r.json()).catch(() => []))
      );

      const map = {};
      fightList.forEach((f, i) => { map[f.id] = projResults[i] || []; });
      setProjsByFight(map);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function openFight(fight) {
    setSelectedFight(fight);
    setModalVisible(true);
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={UFC_RED} />
          <Text style={s.loadingText}>Loading fight card...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <Text style={s.errorText}>Failed to load event</Text>
          <TouchableOpacity style={s.retryBtn} onPress={loadData}>
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <Text style={s.screenTitle}>UFC</Text>
        </View>
        <View style={s.center}>
          <Text style={s.emptyText}>No upcoming UFC events found.</Text>
          <Text style={s.emptySubtext}>Check back closer to fight week.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />

      {/* Screen header */}
      <View style={s.header}>
        <Text style={s.screenTitle}>UFC</Text>
        <View style={s.liveDot} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Event banner */}
        <View style={s.eventBanner}>
          {event.is_ppv && <View style={s.ppvBadge}><Text style={s.ppvText}>PAY-PER-VIEW</Text></View>}
          <Text style={s.eventName}>{event.event_name}</Text>
          <Text style={s.eventDate}>{formatDate(event.event_date)}</Text>
          {event.location && <Text style={s.eventLocation}>{event.location}</Text>}
          <View style={s.fightCount}>
            <Text style={s.fightCountText}>{fights.length} fights · AI projections powered by Chalky</Text>
          </View>
        </View>

        {/* Fight card */}
        <Text style={s.sectionLabel}>FIGHT CARD</Text>
        {fights.map((fight, i) => (
          <FightRow
            key={fight.id}
            fight={fight}
            projections={projsByFight[fight.id] || []}
            index={i}
            onPress={() => openFight(fight)}
          />
        ))}

        {fights.length === 0 && (
          <Text style={s.emptyText}>Fight card not yet available.</Text>
        )}
      </ScrollView>

      <FightDetailModal
        visible={modalVisible}
        fight={selectedFight}
        projections={selectedFight ? (projsByFight[selectedFight.id] || []) : []}
        onClose={() => setModalVisible(false)}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.background },
  header:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  screenTitle:   { fontSize: 22, fontWeight: '800', color: colors.offWhite, letterSpacing: 0.5, flex: 1 },
  liveDot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: UFC_RED },
  scroll:        { padding: spacing.md, paddingBottom: 32 },

  eventBanner:   { backgroundColor: '#1A0A0A', borderWidth: 1, borderColor: '#3A1010', borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  ppvBadge:      { backgroundColor: UFC_RED, borderRadius: radius.sm, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, marginBottom: spacing.sm },
  ppvText:       { fontSize: 10, fontWeight: '800', color: '#FFF', letterSpacing: 1 },
  eventName:     { fontSize: 20, fontWeight: '800', color: colors.offWhite, marginBottom: 4 },
  eventDate:     { fontSize: 14, color: colors.green, fontWeight: '600', marginBottom: 2 },
  eventLocation: { fontSize: 13, color: colors.grey, marginBottom: spacing.sm },
  fightCount:    { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: '#3A1010' },
  fightCountText:{ fontSize: 12, color: colors.grey },

  sectionLabel:  { fontSize: 11, fontWeight: '700', color: colors.grey, letterSpacing: 1.2, marginBottom: spacing.sm },

  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  loadingText:   { color: colors.grey, marginTop: spacing.md, fontSize: 14 },
  errorText:     { color: colors.red, fontSize: 16, fontWeight: '600', marginBottom: spacing.md },
  retryBtn:      { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText:     { color: colors.offWhite, fontWeight: '600' },
  emptyText:     { color: colors.grey, fontSize: 16, textAlign: 'center' },
  emptySubtext:  { color: colors.grey, fontSize: 13, marginTop: 6, textAlign: 'center' },
});

const fr = StyleSheet.create({
  card:           { backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  mainCard:       { borderColor: UFC_RED + '60', backgroundColor: '#160A0A' },
  mainBanner:     { backgroundColor: UFC_RED, borderRadius: radius.sm, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, marginBottom: spacing.sm },
  mainBannerText: { fontSize: 9, fontWeight: '800', color: '#FFF', letterSpacing: 1 },
  top:            { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  weightClass:    { fontSize: 11, color: colors.grey, fontWeight: '600', letterSpacing: 0.5 },
  cardPos:        { fontSize: 11, color: colors.grey },
  matchup:        { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  fighter:        { flex: 1, alignItems: 'flex-start' },
  name:           { fontSize: 15, fontWeight: '700', color: colors.offWhite, marginBottom: 4 },
  nameWinner:     { color: colors.green },
  probBadge:      { },
  probText:       { fontSize: 20, fontWeight: '800' },
  vsDivider:      { width: 40, alignItems: 'center', gap: 4 },
  vsLine:         { width: 1, height: 20, backgroundColor: colors.border },
  vsLabel:        { fontSize: 10, fontWeight: '700', color: colors.grey, letterSpacing: 1 },
  barRow:         { flexDirection: 'row', height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 8 },
  barA:           { backgroundColor: colors.green },
  barB:           { backgroundColor: UFC_RED },
  tapHint:        { fontSize: 11, color: colors.grey, textAlign: 'center' },
});

const dm = StyleSheet.create({
  backdrop:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet:          { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '88%', paddingHorizontal: spacing.md, paddingTop: 12 },
  handle:         { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 12 },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  weightClass:    { fontSize: 13, color: colors.grey, fontWeight: '600', letterSpacing: 0.5 },
  mainBadge:      { backgroundColor: UFC_RED, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  mainBadgeText:  { fontSize: 9, fontWeight: '800', color: '#FFF', letterSpacing: 1 },

  matchupRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  fighterCol:     { flex: 1 },
  fighterName:    { fontSize: 18, fontWeight: '800', color: colors.offWhite, marginBottom: 4 },
  styleTag:       { fontSize: 11, color: UFC_GOLD, fontWeight: '600', letterSpacing: 0.4 },
  vsCircle:       { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center', marginHorizontal: 8 },
  vsText:         { fontSize: 10, fontWeight: '800', color: colors.grey, letterSpacing: 1 },

  section:        { marginBottom: spacing.lg },
  sectionTitle:   { fontSize: 10, fontWeight: '700', color: colors.grey, letterSpacing: 1.2, marginBottom: spacing.sm },

  probTrack:      { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 6 },
  probFillA:      { backgroundColor: colors.green },
  probFillB:      { backgroundColor: UFC_RED },
  probLabels:     { flexDirection: 'row', justifyContent: 'space-between' },
  probPct:        { fontSize: 22, fontWeight: '800' },
  confRow:        { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  confVal:        { fontSize: 12, fontWeight: '600' },

  barRow:         { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  barLabel:       { fontSize: 13, color: colors.offWhite, width: 110 },
  barTrack:       { flex: 1, height: 6, backgroundColor: '#2A2A2A', borderRadius: 3, overflow: 'hidden', marginHorizontal: 8 },
  barFill:        { height: '100%', borderRadius: 3 },
  barPct:         { fontSize: 13, color: colors.offWhite, fontWeight: '700', width: 38, textAlign: 'right' },

  statsGrid:      { gap: spacing.sm },
  statBox:        { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
  statLabel:      { fontSize: 11, color: colors.grey, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 },
  statRow:        { flexDirection: 'row', alignItems: 'center' },
  statFighter:    { flex: 1 },
  statName:       { fontSize: 12, color: colors.grey },
  statVal:        { fontSize: 24, fontWeight: '800', color: colors.offWhite },
  statDivider:    { width: 1, height: 32, backgroundColor: colors.border, marginHorizontal: spacing.sm },

  factorGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:           { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, minWidth: 90 },
  chipLabel:      { fontSize: 10, color: colors.grey, marginBottom: 2 },
  chipVal:        { fontSize: 15, fontWeight: '700', color: colors.offWhite },

  closeBtn:       { backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.md },
  closeBtnText:   { fontSize: 15, fontWeight: '700', color: colors.offWhite },
});
