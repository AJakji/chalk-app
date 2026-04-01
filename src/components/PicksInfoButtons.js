import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal,
  ScrollView, StyleSheet, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ── Schedule data (unchanged) ─────────────────────────────────────────────────

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

// ── Model data (tabbed) ───────────────────────────────────────────────────────

const MODEL_DATA = {
  NBA: {
    player: {
      intro: 'Every NBA player prop runs through a full projection before it reaches the app.',
      sections: [
        {
          icon: '📊',
          title: 'Recent Form',
          items: [
            'Weighted average across last 5, 10, and 20 games',
            'Full season baseline for stability',
            'Home and away splits',
          ],
        },
        {
          icon: '🏀',
          title: 'Matchup',
          items: [
            "Opponent's position defense rating — how many points, rebounds, assists that position allows per game",
            'Pace of play — faster games create more opportunities',
            'Rest and back-to-back adjustments',
          ],
        },
        {
          icon: '⚡',
          title: 'Player Context',
          items: [
            'Usage and efficiency trends',
            'Teammate absences that shift usage',
            'Minutes projection for tonight',
          ],
        },
        {
          icon: '📈',
          title: 'Market Analysis',
          items: [
            'Live line pulled from multiple sportsbooks',
            'Edge = projection minus the posted line',
            'Only picks clearing the minimum edge threshold reach the app',
          ],
        },
      ],
    },
    team: {
      intro: 'Spread and total picks are built on team-level projection models.',
      sections: [
        {
          icon: '📊',
          title: 'Offensive Output',
          items: [
            'Team points per game weighted by recent form',
            'Pace and possessions per game',
            'Home court advantage adjustment',
          ],
        },
        {
          icon: '🛡️',
          title: 'Defensive Matchup',
          items: [
            'Opponent defensive rating',
            'Points allowed per 100 possessions',
            'Pace suppression tendencies',
          ],
        },
        {
          icon: '📈',
          title: 'Market Analysis',
          items: [
            'Projected margin vs the spread',
            'Projected total vs the posted over/under',
            'Edge must clear 1.5 points for spread picks',
          ],
        },
      ],
    },
  },
  NHL: {
    player: {
      intro: 'NHL player props account for ice time, line combinations, and goalie quality.',
      sections: [
        {
          icon: '📊',
          title: 'Recent Form',
          items: [
            'Last 5 games weighted most heavily',
            'Even strength vs power play production split',
            'Time on ice trends',
          ],
        },
        {
          icon: '🥅',
          title: 'Goalie Matchup',
          items: [
            'Confirmed starter pulled from morning skate',
            'Goalie save percentage vs league average',
            'Backup detected — shooter props get a confidence boost',
          ],
        },
        {
          icon: '🏒',
          title: 'Team Context',
          items: [
            'Linemate quality — team goals per game',
            'Opponent goals allowed per game',
            'Home and away splits',
          ],
        },
        {
          icon: '📈',
          title: 'Market Analysis',
          items: [
            'Live prop line across major books',
            'Minimum edge of 0.3 goals for player props',
            'Shots on goal minimum edge of 0.8',
          ],
        },
      ],
    },
    team: {
      intro: 'Puck line and total picks are built on team goal projection models.',
      sections: [
        {
          icon: '📊',
          title: 'Goal Projection',
          items: [
            'Team goals scored and allowed per game',
            'Home and away splits',
            'Recent form weighting',
          ],
        },
        {
          icon: '🥅',
          title: 'Goalie Factor',
          items: [
            "Starting goalie save percentage vs league",
            "Backup goalie detection boosts opposing team's goal projection",
            'Goalie factor capped to prevent outliers',
          ],
        },
        {
          icon: '📈',
          title: 'Market Analysis',
          items: [
            'Projected goal differential vs the puck line',
            'Projected total vs the over/under',
            'Minimum edge of 0.4 goals for puck line picks',
          ],
        },
      ],
    },
  },
  MLB: {
    player: {
      intro: 'MLB props factor in pitching matchups, ballpark conditions, and lineup context.',
      sections: [
        {
          icon: '⚾',
          title: 'Batter Analysis',
          items: [
            'Season batting average, slugging, and on-base percentage',
            'Platoon splits — performance vs left and right-handed pitching',
            'Hard hit rate and exit velocity from Statcast',
          ],
        },
        {
          icon: '🔥',
          title: 'Pitcher Matchup',
          items: [
            "Starting pitcher's strikeout rate and recent form",
            'Pitch arsenal — fastball velocity, breaking ball usage',
            'Opponent batting average vs that pitch type',
          ],
        },
        {
          icon: '🌤️',
          title: 'Game Environment',
          items: [
            'Wind speed and direction — affects home run props',
            'Temperature — cold weather suppresses offense',
            'Umpire tendencies — strike zone size affects strikeout totals',
            'Ballpark dimensions and altitude',
          ],
        },
        {
          icon: '📈',
          title: 'Market Analysis',
          items: [
            'Live prop line from major sportsbooks',
            'Minimum edge of 0.3 hits, 0.5 total bases',
            'Pitcher strikeouts minimum edge of 0.8',
          ],
        },
      ],
    },
    team: {
      intro: 'Run line and total picks combine pitching quality, offense, and park factors.',
      sections: [
        {
          icon: '📊',
          title: 'Run Projection',
          items: [
            'Team runs scored and allowed per game',
            'Starting pitcher ERA and recent form',
            'Bullpen fatigue and usage patterns',
          ],
        },
        {
          icon: '🌤️',
          title: 'Game Environment',
          items: [
            'Ballpark run factor — some parks suppress scoring significantly',
            'Wind and temperature adjustments',
            'Umpire run environment tendencies',
          ],
        },
        {
          icon: '📈',
          title: 'Market Analysis',
          items: [
            'Projected run margin vs the run line (-1.5)',
            'Projected total vs the over/under',
            'Minimum edge of 0.5 runs for run line picks',
          ],
        },
      ],
    },
  },
};

// ── ModelContent subcomponent ─────────────────────────────────────────────────

function ModelContent({ league, type }) {
  const data = MODEL_DATA[league]?.[type];
  if (!data) return null;

  return (
    <View style={styles.contentWrapper}>
      <Text style={styles.intro}>{data.intro}</Text>

      {data.sections.map((section, i) => (
        <View key={i} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>{section.icon}</Text>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
          {section.items.map((item, j) => (
            <View key={j} style={styles.itemRow}>
              <View style={styles.dot} />
              <Text style={styles.itemText}>{item}</Text>
            </View>
          ))}
        </View>
      ))}

      <View style={styles.edgeNote}>
        <Text style={styles.edgeNoteIcon}>🎯</Text>
        <Text style={styles.edgeNoteText}>
          Most projections never become picks. Only the ones with a genuine edge make it through.
        </Text>
      </View>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PicksInfoButtons() {
  const [scheduleVisible, setScheduleVisible] = useState(false);
  const [modelVisible, setModelVisible] = useState(false);
  const [league, setLeague] = useState('NBA');
  const [propType, setPropType] = useState('player');

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

          {/* League switcher */}
          <View style={styles.leagueSwitcher}>
            {['NBA', 'NHL', 'MLB'].map((l) => (
              <TouchableOpacity
                key={l}
                style={[styles.leagueBtn, league === l && styles.leagueBtnActive]}
                onPress={() => setLeague(l)}
                activeOpacity={0.75}
              >
                <Text style={[styles.leagueBtnText, league === l && styles.leagueBtnTextActive]}>
                  {l}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Player / Team toggle */}
          <View style={styles.typeToggle}>
            <TouchableOpacity
              style={[styles.typeBtn, propType === 'player' && styles.typeBtnActive]}
              onPress={() => setPropType('player')}
              activeOpacity={0.75}
            >
              <Text style={[styles.typeBtnText, propType === 'player' && styles.typeBtnTextActive]}>
                Player Props
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, propType === 'team' && styles.typeBtnActive]}
              onPress={() => setPropType('team')}
              activeOpacity={0.75}
            >
              <Text style={[styles.typeBtnText, propType === 'team' && styles.typeBtnTextActive]}>
                Team Picks
              </Text>
            </TouchableOpacity>
          </View>

          {/* Dynamic content */}
          <ScrollView style={styles.contentArea} showsVerticalScrollIndicator={false}>
            <ModelContent league={league} type={propType} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Buttons
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

  // League switcher
  leagueSwitcher: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  leagueBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  leagueBtnActive: {
    backgroundColor: '#00E87A',
    borderColor: '#00E87A',
  },
  leagueBtnText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  leagueBtnTextActive: {
    color: '#080808',
  },

  // Player / Team toggle
  typeToggle: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: '#0f0f0f',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 3,
    marginBottom: 4,
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  typeBtnActive: {
    backgroundColor: '#1a1a1a',
  },
  typeBtnText: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
  },
  typeBtnTextActive: {
    color: '#F5F5F0',
    fontWeight: '700',
  },

  // Content area
  contentArea: {
    flex: 1,
  },
  contentWrapper: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  intro: {
    color: '#888888',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionIcon: {
    fontSize: 16,
  },
  sectionTitle: {
    color: '#F5F5F0',
    fontSize: 14,
    fontWeight: '700',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 7,
  },
  dot: {
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
  edgeNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 14,
    marginTop: 8,
  },
  edgeNoteIcon: {
    fontSize: 16,
  },
  edgeNoteText: {
    flex: 1,
    color: '#888888',
    fontSize: 13,
    lineHeight: 20,
  },

  bottomPad: {
    height: 40,
  },
});
