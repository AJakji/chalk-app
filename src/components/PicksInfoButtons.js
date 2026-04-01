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
      intro: 'Before a single NBA prop pick reaches the app it has passed through dozens of data checks. Most projections never make it. The ones that do have a real, measurable edge over the line the book posted.',
      sections: [
        {
          icon: '📊',
          title: 'Game Log Analysis',
          items: [
            'Every game from the last 5, 10, and 20 appearances is weighted differently — recent games matter more but outliers are dampened so one big game does not inflate the projection',
            'Home and away splits are tracked separately — some players perform 15-20% differently depending on the court',
            'Back-to-back fatigue is factored in — players on the second night of a back-to-back historically underperform their lines',
          ],
        },
        {
          icon: '🏀',
          title: 'Opponent Defense',
          items: [
            'Every team is rated on how many points, rebounds, and assists they allow to each specific position — not just overall defense. A team can be great against guards and terrible against centers.',
            'These ratings update nightly so a team on a defensive slide gets reflected in tonight\'s projection',
            'Pace of play is measured per matchup — some teams force faster games which directly inflates counting stats for both sides',
          ],
        },
        {
          icon: '⚡',
          title: 'Contextual Factors',
          items: [
            'When a starter is out their usage gets redistributed across teammates — the model detects this and adjusts projections for everyone in the lineup',
            'Minutes projections are adjusted for game script — a team expected to lose big will rest starters early, compressing stats',
            'Efficiency is measured against league average — only the deviation from average is applied so the base projection is never double-counted',
          ],
        },
        {
          icon: '🎯',
          title: 'Edge Detection',
          items: [
            'The projection is compared against the live line pulled from multiple sportsbooks at 4 AM — not yesterday\'s closing line',
            'Each prop type has its own minimum edge requirement. Points needs at least 1.5 above the line. Rebounds needs 0.8. The threshold exists because smaller edges have too much variance to be reliable.',
            'Confidence is mathematically tied to edge size — a 74% confidence pick has roughly 2.5x the minimum required edge. An 87% pick has 4x. The number is not a feeling — it is a ratio.',
          ],
        },
      ],
    },
    team: {
      intro: 'Spread and total picks are built on full team projection models that run every game on tonight\'s slate. Both sides of every matchup are projected independently then compared to the market line.',
      sections: [
        {
          icon: '📊',
          title: 'Team Offensive Output',
          items: [
            'Points per game weighted by recent form — a team on a hot streak is treated differently than their season average suggests',
            'Pace and possessions per game — a fast team playing a slow team creates a total that is different from both teams\' averages',
            'Home court adjustment — home teams historically outperform their road numbers by a measurable margin across the league',
          ],
        },
        {
          icon: '🛡️',
          title: 'Defensive Matchup',
          items: [
            'Opponent defensive rating updated nightly — how many points allowed per 100 possessions in recent games',
            'Pace suppression tendencies — elite defenses slow games down which directly affects over/under projections',
            'Home and away defensive splits tracked separately',
          ],
        },
        {
          icon: '🎯',
          title: 'Edge Detection',
          items: [
            'Projected margin compared directly to the spread — if the model says home team wins by 6 and the spread is -3.5, that is a +2.5 edge on the cover',
            'Minimum edge of 1.5 points required for spread picks — anything tighter is too close to call reliably',
            'Total picks require the projected combined score to differ from the line by at least 2 points',
          ],
        },
      ],
    },
  },
  NHL: {
    player: {
      intro: 'NHL props are harder to model than any other sport — ice time changes, line combinations shift, and a single goalie decision can change everything. Chalky tracks all of it.',
      sections: [
        {
          icon: '📊',
          title: 'Player Performance',
          items: [
            'Even strength and power play production are tracked completely separately — a player who scores almost entirely on the power play is a very different bet than one who produces at even strength',
            'Time on ice is projected for tonight based on recent usage — coaches adjust lines constantly and those shifts directly affect counting stats',
            'Linemate quality is measured — being on a line with elite players increases shot and point production significantly',
          ],
        },
        {
          icon: '🥅',
          title: 'Goalie Intelligence',
          items: [
            'Starting goalie is confirmed from morning skate reports before the model runs at 4:30 AM — no projection is built on an unconfirmed starter',
            'Each goalie\'s save percentage is compared to league average — a goalie 3% below average allows measurably more goals and that flows directly into shooter prop projections',
            'When a backup goalie is confirmed the model automatically boosts confidence on shooter props for the opposing team — backups allow significantly more goals historically',
          ],
        },
        {
          icon: '🎯',
          title: 'Edge Detection',
          items: [
            'Shots on goal requires a minimum 0.8 edge over the line — this is a tighter threshold because shot volume is more volatile than point production',
            'Goals and assists require 0.3 minimum edge — lower threshold because the lines are already low and small edges are meaningful',
            'Live lines pulled from books at 4 AM before the model runs',
          ],
        },
      ],
    },
    team: {
      intro: 'Puck line and total picks combine goalie quality, team offense, and the specific matchup dynamic to project how many goals get scored and by whom.',
      sections: [
        {
          icon: '📊',
          title: 'Goal Projection',
          items: [
            'Each team\'s offensive output is projected independently using recent goals scored per game weighted by form',
            'The combined projection is then adjusted for goalie quality on both sides — an elite goalie matchup suppresses totals meaningfully',
            'Home and away splits tracked separately — NHL home ice advantage is statistically significant',
          ],
        },
        {
          icon: '🥅',
          title: 'Goalie Factor',
          items: [
            'Starting goalie save percentage vs league average is applied as a multiplier to the opposing team\'s goal projection',
            'The goalie factor is capped to prevent one outlier goalie performance from swinging projections unrealistically',
            'Backup detection automatically adjusts the total upward when confirmed — books are often slow to move lines for backup starters, creating real edges',
          ],
        },
        {
          icon: '🎯',
          title: 'Edge Detection',
          items: [
            'Projected goal differential vs the puck line (-1.5) — a team projected to win by 2.1 goals has a +0.6 edge on the puck line',
            'Minimum 0.4 goal edge required for puck line picks',
            'Total picks need 0.8 goal edge over the over/under',
          ],
        },
      ],
    },
  },
  MLB: {
    player: {
      intro: 'Baseball props are the most data-rich picks in the app. The model pulls from Statcast pitch-level data, umpire tendencies, weather readings, and ballpark factors that most bettors never think about.',
      sections: [
        {
          icon: '⚾',
          title: 'Batter Analysis',
          items: [
            'Platoon splits are applied for every batter — how they historically perform against left and right-handed pitching matters enormously and books often misprice these edges',
            'Exit velocity and hard hit rate from Statcast tell the model how well a batter is actually making contact regardless of recent luck',
            'Season baseline is weighted against recent form — a hot start inflates lines and a slump creates opportunities',
          ],
        },
        {
          icon: '🔥',
          title: 'Pitcher Arsenal',
          items: [
            'Each starting pitcher\'s pitch mix is analyzed — fastball velocity trends, breaking ball usage rate, and how effective each pitch has been recently',
            'The batter\'s historical performance against that specific pitch type is factored in — some batters are genuinely elite against breaking balls but weak against velocity',
            'Pitcher strikeout rate and walk rate trends drive pitcher prop projections',
          ],
        },
        {
          icon: '🌤️',
          title: 'Game Environment',
          items: [
            'Wind speed and direction are pulled for tonight\'s game — wind blowing out at 15+ mph at Wrigley materially increases home run probability and that shows up in projections',
            'Temperature affects how far the ball travels — cold games suppress offense and the model adjusts accordingly',
            'Umpire tendencies are tracked — some umpires run tight zones that increase walks and suppress strikeouts. This directly affects pitcher strikeout props.',
            'Ballpark dimensions and altitude are applied — Coors Field at elevation plays very differently from every other park in baseball',
          ],
        },
        {
          icon: '🎯',
          title: 'Edge Detection',
          items: [
            'Hit props need a minimum 0.3 edge. Total bases need 0.5. Home runs need 0.2. Each threshold was set based on the variance of that stat — lower variance stats need bigger edges to be reliable.',
            'Pitcher strikeout minimum edge of 0.8 — strikeout props have high variance so the model requires a larger cushion to qualify',
            'All lines pulled live at 4 AM before the model runs',
          ],
        },
      ],
    },
    team: {
      intro: 'Run line and total picks combine pitching quality, offensive depth, bullpen fatigue, and environmental factors into a single projected score for each team.',
      sections: [
        {
          icon: '📊',
          title: 'Run Projection',
          items: [
            'Starting pitcher ERA and recent form drives the opposing team\'s run projection — a pitcher on a hot streak suppresses offense measurably',
            'Bullpen fatigue is tracked — a team that burned their best relievers yesterday is more vulnerable in tight games tonight',
            'Team runs scored per game weighted by recent form on both sides of the ball',
          ],
        },
        {
          icon: '🌤️',
          title: 'Park and Weather',
          items: [
            'Every ballpark has a run factor that adjusts the projected total — a game at Coors projects higher than the same matchup at Petco Park',
            'Wind and temperature applied to the total projection for tonight specifically — not a seasonal average',
            'Umpire run environment tendencies factored in — some umpires consistently produce high or low scoring games based on zone tendencies',
          ],
        },
        {
          icon: '🎯',
          title: 'Edge Detection',
          items: [
            'Projected run margin vs the run line (-1.5) — minimum 0.5 run edge required to generate a pick',
            'Projected total vs the over/under — minimum 1.0 run edge required',
            'Most games produce no qualifying team picks. When one does appear it has a real, data-backed reason behind it.',
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
          On a typical night the model runs projections for hundreds of players and games across all three sports. A fraction of those become picks. The ones that do have passed every filter and cleared a real minimum edge. That is the only reason they are here.
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
