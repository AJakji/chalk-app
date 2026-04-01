import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal,
  ScrollView, StyleSheet, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ── Data ──────────────────────────────────────────────────────────────────────

const SCHEDULE_STEPS = [
  {
    time: '12:00 AM',
    title: 'Data Collection Begins',
    desc: "Game logs, player stats, team performance, and injury reports are pulled for every player in tonight's games across NBA, NHL, and MLB.",
  },
  {
    time: '1:00 AM',
    title: 'Advanced Metrics Computed',
    desc: "Position defense ratings, league averages, pace factors, and matchup data are calculated fresh for today's slate.",
  },
  {
    time: '4:00 AM',
    title: 'Live Lines Fetched',
    desc: 'Sportsbooks post their prop lines overnight. Chalky pulls every available line across DraftKings, FanDuel, and more the moment they are posted.',
  },
  {
    time: '4:30 AM',
    title: 'Projection Models Run',
    desc: 'The full projection model runs for every player in every game. Projected values are compared against the live market lines to find edges.',
  },
  {
    time: '5:30 AM',
    title: 'Edge Detection',
    desc: "Only projections that clear Chalky's minimum edge threshold survive. Most projections are filtered out here. No edge means no pick.",
  },
  {
    time: '6:45 AM',
    title: 'Verification',
    desc: 'A final check confirms picks are valid, lines are current, and all data is accurate before release.',
  },
  {
    time: '7:00 AM',
    title: '🎯 Picks Go Live',
    desc: 'The sharpest picks from across every sport are ready in the app. Every morning. Without fail.',
  },
];

const MODEL_SECTIONS = [
  {
    sport: 'NBA',
    color: '#C9082A',
    categories: [
      {
        title: 'Player Performance',
        items: [
          'Weighted game log average (L5, L10, L20, full season)',
          'Home vs away splits',
          'Back-to-back and rest day adjustments',
          'Minutes and usage trends',
          'True shooting efficiency',
        ],
      },
      {
        title: 'Matchup Factors',
        items: [
          'Opponent position defense rating — how many points, rebounds, assists that position allows per game',
          'Pace of play adjustment — faster games mean more possessions and more stats',
          'Game total and projected score environment',
          'Injury impact — teammate absences shift usage',
        ],
      },
      {
        title: 'Market Analysis',
        items: [
          'Live prop line from multiple sportsbooks',
          'Edge = projection minus line',
          'Minimum edge threshold per prop type',
          'Confidence score tied directly to edge size',
        ],
      },
    ],
  },
  {
    sport: 'NHL',
    color: '#003087',
    categories: [
      {
        title: 'Player Performance',
        items: [
          'Even strength vs power play production splits',
          'Time on ice trends',
          'Linemate quality and line combinations',
          'Recent form (L5 games)',
        ],
      },
      {
        title: 'Matchup Factors',
        items: [
          'Opposing goalie — save percentage and recent form',
          'Opponent goals allowed per game',
          'Home vs away performance',
          'Back-to-back fatigue adjustment',
        ],
      },
      {
        title: 'Goalie Detection',
        items: [
          'Confirmed starter pulled from morning skate reports',
          'Backup goalie detected — confidence boosted automatically on shooter props',
          'Goalie stats vs league average save percentage',
        ],
      },
    ],
  },
  {
    sport: 'MLB',
    color: '#002D72',
    categories: [
      {
        title: 'Batter Analysis',
        items: [
          'Platoon splits — left vs right handed pitcher',
          'Season batting average, slugging, and OBP',
          'Hard hit rate and exit velocity from Statcast',
          'Ballpark factors — dimensions and altitude',
          'Recent form vs historical baseline',
        ],
      },
      {
        title: 'Pitcher Analysis',
        items: [
          'Pitch arsenal — fastball velocity, breaking ball usage, and effectiveness',
          'Strikeout rate and walk rate trends',
          'Opponent batting average vs specific pitch types',
          'Bullpen fatigue and usage patterns',
        ],
      },
      {
        title: 'Game Context',
        items: [
          'Weather — wind speed, direction, and temperature',
          'Umpire tendencies — strike zone size affects strikeout totals',
          'Home vs away splits',
          'Day vs night game performance history',
        ],
      },
    ],
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function PicksInfoButtons() {
  const [scheduleVisible, setScheduleVisible] = useState(false);
  const [modelVisible, setModelVisible] = useState(false);

  return (
    <>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.infoBtn}
          onPress={() => setScheduleVisible(true)}
          activeOpacity={0.75}
        >
          <Ionicons name="time-outline" size={14} color="#888888" />
          <Text style={styles.infoBtnText}>How picks are made</Text>
          <Ionicons name="chevron-forward" size={12} color="#3a3a3a" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.infoBtn}
          onPress={() => setModelVisible(true)}
          activeOpacity={0.75}
        >
          <Ionicons name="analytics-outline" size={14} color="#888888" />
          <Text style={styles.infoBtnText}>What goes into a pick</Text>
          <Ionicons name="chevron-forward" size={12} color="#3a3a3a" />
        </TouchableOpacity>
      </View>

      {/* ── Schedule Modal ─────────────────────────────────────────────────── */}
      <Modal
        visible={scheduleVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setScheduleVisible(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Chalky's Overnight Process</Text>
            <TouchableOpacity onPress={() => setScheduleVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#888888" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalIntro}>
              While you sleep Chalky runs a full projection pipeline across every sport. By 7 AM the sharpest picks are ready.
            </Text>

            {SCHEDULE_STEPS.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepLeft}>
                  <Text style={styles.stepTime}>{step.time}</Text>
                  {i < SCHEDULE_STEPS.length - 1 && <View style={styles.stepLine} />}
                </View>
                <View style={styles.stepRight}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepDesc}>{step.desc}</Text>
                </View>
              </View>
            ))}

            <View style={styles.bottomPad} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ── Model Modal ────────────────────────────────────────────────────── */}
      <Modal
        visible={modelVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModelVisible(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>What Goes Into a Pick</Text>
            <TouchableOpacity onPress={() => setModelVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#888888" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalIntro}>
              Every pick is the result of dozens of data points running through Chalky's projection model. Here is what actually gets analyzed.
            </Text>

            {MODEL_SECTIONS.map((section, i) => (
              <View key={i} style={styles.modelSection}>
                <View style={styles.modelSectionHeader}>
                  <View style={[styles.sportDot, { backgroundColor: section.color }]} />
                  <Text style={styles.modelSportLabel}>{section.sport}</Text>
                </View>

                {section.categories.map((cat, j) => (
                  <View key={j} style={styles.categoryBlock}>
                    <Text style={styles.categoryTitle}>{cat.title}</Text>
                    {cat.items.map((item, k) => (
                      <View key={k} style={styles.itemRow}>
                        <View style={styles.itemDot} />
                        <Text style={styles.itemText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ))}

            <View style={styles.bottomNote}>
              <Ionicons name="shield-checkmark-outline" size={16} color="#00E87A" />
              <Text style={styles.bottomNoteText}>
                Every pick must clear a minimum edge threshold before it reaches the app. Most projections never become picks.
              </Text>
            </View>

            <View style={styles.bottomPad} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  infoBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  infoBtnText: {
    flex: 1,
    color: '#888888',
    fontSize: 11,
    fontWeight: '500',
  },

  // Modal shell
  modal: {
    flex: 1,
    backgroundColor: '#080808',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  modalTitle: {
    color: '#F5F5F0',
    fontSize: 18,
    fontWeight: '800',
  },
  modalScroll: {
    flex: 1,
    paddingHorizontal: 20,
  },
  modalIntro: {
    color: '#888888',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 20,
    marginBottom: 28,
  },

  // Schedule timeline
  stepRow: {
    flexDirection: 'row',
    gap: 16,
  },
  stepLeft: {
    alignItems: 'center',
    width: 64,
  },
  stepTime: {
    color: '#00E87A',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  stepLine: {
    width: 1,
    flex: 1,
    backgroundColor: '#1e1e1e',
    minHeight: 24,
  },
  stepRight: {
    flex: 1,
    paddingBottom: 24,
  },
  stepTitle: {
    color: '#F5F5F0',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  stepDesc: {
    color: '#888888',
    fontSize: 13,
    lineHeight: 20,
  },

  // Model sections
  modelSection: {
    marginBottom: 32,
  },
  modelSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sportDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  modelSportLabel: {
    color: '#F5F5F0',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1,
  },
  categoryBlock: {
    marginBottom: 20,
  },
  categoryTitle: {
    color: '#F5F5F0',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  itemDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3a3a3a',
    marginTop: 8,
    flexShrink: 0,
  },
  itemText: {
    flex: 1,
    color: '#888888',
    fontSize: 13,
    lineHeight: 20,
  },

  // Bottom note
  bottomNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#00E87A',
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  bottomNoteText: {
    flex: 1,
    color: '#888888',
    fontSize: 13,
    lineHeight: 20,
  },
  bottomPad: {
    height: 40,
  },
});
