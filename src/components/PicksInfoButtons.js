import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal,
  ScrollView, StyleSheet, SafeAreaView,
  LayoutAnimation, Platform, UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ChalkyMascot from './ChalkyMascot';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental &&
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ── Schedule data ─────────────────────────────────────────────────────────────

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
    title: 'Picks Go Live',
    desc: 'The sharpest picks from across every sport are ready in the app. Every morning. Without fail.',
  },
];

// ── Model data ────────────────────────────────────────────────────────────────

const MODEL_DATA = {
  NBA: {
    player: {
      intro: 'Every NBA player projection is the product of a multi-factor formula — not a single stat, not a gut call. The formula runs identically for every player in every game on the slate. Most outputs never become picks.',
      note: 'On any given night the model evaluates every player in every NBA game. Most projections do not clear the threshold. The ones that do have a genuine mathematical edge — not a guess.',
      sections: [
        {
          icon: '📊',
          title: 'The Weighted Base',
          items: [
            'The base projection starts with a rolling weighted average across the last 5, 10, and 20 games. The 5-game window carries the highest coefficient because recent form is more predictive than season totals — but outlier games are dampened using a trimmed mean so one 50-point explosion does not permanently inflate the output.',
            'Home and away splits are computed separately and applied as a home/road factor clamped between 0.88 and 1.12 — wide enough to matter, narrow enough to prevent a single environment from dominating the formula.',
            'Rest factor is a multiplier applied per day of rest: same-day back-to-back carries a 0.91 coefficient, second-night back-to-back is 0.94, standard rest is 1.0, and three-plus days of rest bumps to 1.03.',
          ],
        },
        {
          icon: '🏀',
          title: 'Contextual Multipliers',
          items: [
            'Position Defense Factor (PDF): every team is rated on points, rebounds, and assists allowed to each of the five positions specifically — not overall defense. A team can rank 28th against centers and 4th against guards simultaneously. The PDF is recalculated nightly and applied as a positional multiplier to the base projection.',
            'Pace Factor: possessions per 48 minutes for tonight\'s matchup is computed and compared to league average. A pace delta above +3 possessions applies an upward multiplier to all counting stats on both sides. A pace delta below -3 applies a downward multiplier.',
            'Game Script Factor: the spread is used to estimate blow-out probability. When a team is favored by 12+ points the model applies a compression factor to starters\' minutes projections — garbage time reduces counting stats and the formula accounts for it.',
          ],
        },
        {
          icon: '⚡',
          title: 'How the Formula Runs',
          items: [
            'Injury adjustments run first: when a starter is out their usage share is redistributed proportionally across remaining players based on historical backup usage patterns. The redistribution is applied before any other factor so it flows through every subsequent multiplier.',
            'The base × PDF × Pace × Rest × Game Script produces the raw projection. That number is then tested against an efficiency deviation — the player\'s true shooting percentage versus league average is used to adjust the points component without double-counting usage.',
            'Combo props (e.g. points + rebounds + assists) apply a correlation discount to the combined projection. High-point games often mean fewer assist opportunities — the formula reduces the combined projection by a measured correlation coefficient rather than summing the individual projections directly.',
          ],
        },
        {
          icon: '🎯',
          title: 'Edge and Confidence',
          items: [
            'Live lines are pulled from multiple books at 4 AM. The projection is compared against tonight\'s line — not yesterday\'s closing number. Edge = projection minus line.',
            'Each stat has its own minimum edge threshold based on measured variance: Points requires +1.5, Rebounds requires +0.8, Assists requires +0.7. Anything below threshold is filtered. No edge means no pick.',
            'Confidence is a ratio of edge size to the minimum threshold for that stat type. A 74% confidence pick has roughly 2.5× the minimum required edge. An 87% pick has 4×. The percentage is derived from the ratio — it is not a subjective score.',
          ],
        },
      ],
    },
    team: {
      intro: 'Spread and total picks run both teams through the full projection model independently. The outputs are compared against each other and against the market line. The market has to be meaningfully wrong for a pick to qualify.',
      note: 'Both teams run through the same formula independently. The market has to be wrong by a minimum margin before a pick qualifies — most games do not produce one.',
      sections: [
        {
          icon: '📊',
          title: 'The Weighted Base',
          items: [
            'Each team\'s offensive output is projected using the same weighted rolling window as player props — 5, 10, and 20-game coefficients with outlier dampening. A team on a 5-game scoring run is treated differently than their season average suggests.',
            'Home court factor is applied as a multiplier derived from the team\'s own home/road differential over the current season — league-average home advantage is not assumed, it is measured per team.',
            'Rest factor applies at the team level using the same coefficient structure: back-to-back, standard rest, extended rest.',
          ],
        },
        {
          icon: '🛡️',
          title: 'Contextual Multipliers',
          items: [
            'Opponent defensive rating (points allowed per 100 possessions) is updated nightly and applied to reduce the attacking team\'s projected output. A defense ranked in the bottom 10 over the last 10 games is treated as more vulnerable than their season rank suggests.',
            'Pace delta between the two teams drives the total projection — a fast team hosting a slow team produces a pace estimate that is lower than the fast team\'s average but higher than the slow team\'s average, and both offensive projections adjust accordingly.',
            'Pace suppression factor: teams with elite defensive ratings historically reduce opponent pace. This is measured and applied as a secondary downward multiplier on total projections.',
          ],
        },
        {
          icon: '🎯',
          title: 'Edge and Confidence',
          items: [
            'Projected margin (home projection minus away projection) is compared directly to the spread. A projected margin of +6 against a spread of -3.5 is a +2.5 edge on the cover.',
            'Spread picks require a minimum 1.5-point edge. Total picks require the projected combined score to differ from the over/under by at least 2 points.',
            'Confidence for team picks uses the same ratio structure as player props — edge size divided by the minimum threshold, converted to a percentage and clamped between 60% and 95%.',
          ],
        },
      ],
    },
  },
  NHL: {
    player: {
      intro: 'NHL player props are the hardest to model in any sport. Ice time shifts without warning, line combinations rotate daily, and one goalie decision changes every shooter projection on the opposite team. The formula handles all of it — but it only runs after the starting goalie is confirmed.',
      note: 'NHL is unpredictable by design. The model is built for it. Every factor is clamped so volatility does not produce false confidence — and no projection runs until the goalie is confirmed.',
      sections: [
        {
          icon: '📊',
          title: 'The Weighted Base',
          items: [
            'Even strength and power play production are tracked as completely separate data streams. A player who generates 70% of his points on the power play is a fundamentally different projection than one who produces primarily at even strength — the formula does not combine these until the final output.',
            'Time on ice is projected per game based on the last 10 appearances, adjusted for line combination changes detected in morning skate reports. The TOI projection feeds directly into the counting stat formula — more ice time means proportionally higher shot and point ceilings.',
            'Linemate quality factor: being on a line with a top-6 forward increases shot and point production by a measured coefficient. The formula detects line combination changes and adjusts accordingly before the model runs at 4:30 AM.',
          ],
        },
        {
          icon: '🥅',
          title: 'Goalie Intelligence',
          items: [
            'No projection runs until the starting goalie is confirmed from morning skate reports. An unconfirmed starter is too risky to model around — if confirmation has not come by 4:00 AM the game is excluded from that morning\'s slate.',
            'Each starting goalie\'s save percentage is compared to league average (.910) to produce a Goals Against Factor. A goalie at .895 applies a 1.08 multiplier to the opposing team\'s goal projection. A goalie at .925 applies a 0.93 factor. The multiplier is clamped to prevent outlier seasons from producing unrealistic outputs.',
            'Backup confirmation triggers an automatic upward adjustment to all shooter props on the opposing team. Books are consistently slow to reprice lines when a backup is confirmed — that gap is where the edge comes from.',
          ],
        },
        {
          icon: '🎯',
          title: 'Edge and Confidence',
          items: [
            'Shots on goal uses a 0.8 minimum edge — a tighter threshold than point props because shot volume is more volatile and the variance requires a larger cushion to produce reliable picks.',
            'Goals and assists use a 0.3 minimum edge — lower threshold because the lines are already low integers and even a 0.3 delta represents a meaningful percentage edge over the market.',
            'Lines are pulled live at 4 AM and the model runs at 4:30 AM after goalie confirmation. The 30-minute window catches any late line movement before the projection is finalized.',
          ],
        },
      ],
    },
    team: {
      intro: 'Puck line and total picks run the same formula as player props but at the team level — goalie quality on both sides, offensive depth, and pace of play all combine into a single projected goal total for each team.',
      note: 'Goalie quality is the single biggest driver of NHL team picks. When a backup is confirmed and the line has not moved, that is where the edge lives.',
      sections: [
        {
          icon: '📊',
          title: 'The Weighted Base',
          items: [
            'Each team\'s offensive output is projected independently using goals scored per game over the last 5 and 10 games with weighted coefficients. Recent form carries more weight than the season total — a team on a 4-game cold stretch is modeled as weaker than their season goals-for average suggests.',
            'Home and away splits are tracked separately. NHL home ice advantage is statistically significant and the formula measures it per team rather than applying a league-average assumption.',
            'The combined projected total is derived from both teams\' offensive projections — not from historical over/under data. Each team\'s number feeds the total independently.',
          ],
        },
        {
          icon: '🥅',
          title: 'Goalie Factor',
          items: [
            'The goalie Goals Against Factor from the player model is applied directly to the team model — the same save percentage calculation reduces or increases the opposing team\'s projected goal output.',
            'The factor is clamped between 0.88 and 1.14. Even the worst goalie in the league cannot multiply the projection beyond 1.14× — this prevents one catastrophic goalie performance from generating unrealistic total projections.',
            'Backup confirmation automatically adjusts both the total and the puck line projection. When a backup starts the model assumes a larger goal differential is possible — this flows into both the over/under pick and the puck line edge calculation.',
          ],
        },
        {
          icon: '🎯',
          title: 'Edge and Confidence',
          items: [
            'Projected goal differential (home minus away) is compared to the puck line (-1.5). A team projected to win by 2.1 goals has a +0.6 edge on the puck line — that clears the minimum threshold of 0.4.',
            'Total picks require a 0.8-goal edge over the over/under. NHL totals are typically set between 5.5 and 6.5 goals — a 0.8-goal delta represents a meaningful edge at that scale.',
            'Confidence is computed the same way as player props: edge divided by minimum threshold, converted to percentage, clamped between 60% and 95%.',
          ],
        },
      ],
    },
  },
  MLB: {
    player: {
      intro: 'Baseball is the most data-rich sport in the model. Every projection pulls from Statcast pitch-level data, umpire zone tendencies, live weather readings, ballpark coefficients, and platoon splits that most bettors never think about.',
      note: 'Baseball has the richest data in sports. More inputs means more edges — and more places for books to be wrong.',
      sections: [
        {
          icon: '⚾',
          title: 'The Weighted Base',
          items: [
            'The base uses ISO (Isolated Power = slugging minus batting average) rather than raw slugging to measure true power output without inflating for singles contact. ISO is weighted across the last 15 and 30 games with recent form carrying a higher coefficient.',
            'BABIP (Batting Average on Balls In Play) is tracked to separate luck from skill. A batter with a BABIP well above his career average is likely due to regression — the formula detects this and moderates the base projection so the model is not chasing a hot streak the market has already priced in.',
            'Platoon splits are applied as a hard multiplier: every batter\'s historical performance against same-handed and opposite-handed pitching is computed separately and the correct split is used for tonight\'s matchup.',
          ],
        },
        {
          icon: '🔥',
          title: 'Pitcher and Matchup Factors',
          items: [
            'FIP (Fielding Independent Pitching) is used instead of ERA for pitcher evaluation. ERA includes defensive support which the pitcher does not control — FIP isolates strikeouts, walks, and home runs allowed, which are the outcomes the pitcher actually determines.',
            'Pitch mix analysis: fastball velocity trend over the last 5 starts, breaking ball usage rate, and whiff rate per pitch type are all measured. The specific batter\'s historical whiff rate against that pitch type is applied as a multiplier — some hitters are genuinely elite against breaking balls and terrible against velocity.',
            'The matchup produces a projected strikeout rate and hits-allowed rate for the pitcher, which directly drives the opposing batter\'s hit and total bases projections.',
          ],
        },
        {
          icon: '🌤️',
          title: 'Environmental Coefficients',
          items: [
            'Wind speed and direction are pulled from tonight\'s venue forecast. Wind blowing out at 15+ mph applies a home run multiplier derived from historical run environment data at that specific park. The coefficient of restitution of a baseball changes with temperature and the formula accounts for it.',
            'Temperature factor: cold games below 50°F apply a downward multiplier to all offensive projections based on measured historical differences in ball carry at temperature — derived from Statcast exit velocity data segmented by game-time temperature.',
            'Umpire zone tendencies: every active umpire has a measured called-strike-rate vs league average. A tight-zone umpire directly suppresses strikeout props for starting pitchers. The umpire factor is applied as a multiplier to all pitcher strikeout projections before edge detection.',
          ],
        },
        {
          icon: '🎯',
          title: 'Edge and Confidence',
          items: [
            'Each stat has a minimum edge threshold set by its variance: Hits +0.3, Total Bases +0.5, Home Runs +0.2, Strikeouts (pitcher) +0.8. The strikeout threshold is highest because variance is highest — a single bad inning can move the total by 2 or 3 units.',
            'All lines are pulled live at 4 AM before the model runs. Overnight line movement from sharp action is captured — a line that has moved significantly from open is flagged and the edge is recalculated against the current number.',
            'Confidence follows the same ratio structure: edge divided by minimum threshold, converted to percentage, clamped between 60% and 95%.',
          ],
        },
      ],
    },
    team: {
      intro: 'Run line and total picks combine starting pitcher quality, bullpen depth, offensive run scoring rate, and environmental factors into a projected final score for each team. The market sets the line — the model has to beat it by a minimum margin to generate a pick.',
      note: 'Most games produce no qualifying team picks. The model runs all of them — the threshold filters everything else out.',
      sections: [
        {
          icon: '📊',
          title: 'The Weighted Base',
          items: [
            'Starting pitcher FIP drives the opposing team\'s run projection. A pitcher with a recent FIP of 3.1 is a meaningfully stronger suppressor than one at 4.4 — the formula weights both the season FIP and the last-5-starts FIP with a recency coefficient.',
            'Bullpen fatigue is tracked at the individual reliever level — a closer or setup man who threw 30+ pitches yesterday has a reduced availability and effectiveness coefficient for tonight. The team\'s bullpen depth rating is adjusted dynamically.',
            'Team runs scored per game uses the same weighted rolling window as player props — 5 and 15-game windows with recent form carrying a higher coefficient.',
          ],
        },
        {
          icon: '🌤️',
          title: 'Park and Environment',
          items: [
            'Every MLB ballpark has a run factor coefficient built into the model — Coors Field at elevation projects 12-15% more runs than the same matchup at Petco Park or Oracle Park. The coefficient is derived from multi-year run environment data at each venue.',
            'Wind and temperature are applied to the total projection for tonight specifically. A hot game at a hitter-friendly park with wind blowing out produces a different total than the same matchup on a cold night with wind in.',
            'Umpire run environment tendencies are applied at the game level. Some umpires consistently produce high or low scoring environments across their career — these are measured and applied as a multiplier to the total projection.',
          ],
        },
        {
          icon: '🎯',
          title: 'Edge and Confidence',
          items: [
            'Projected run margin versus the run line (-1.5): minimum 0.5-run edge required. A team projected to win by 2.3 runs has a +0.8 edge — that clears the threshold.',
            'Projected combined total versus the over/under: minimum 1.0-run edge required. Baseball total variance is high enough that anything inside 1 run is indistinguishable from noise.',
            'Most games produce no qualifying team picks. The model runs every game and produces projections for all of them — but the vast majority sit too close to the line to qualify.',
          ],
        },
      ],
    },
  },
};

// ── Accordion section ─────────────────────────────────────────────────────────

function AccordionSection({ section, isOpen, onToggle }) {
  return (
    <View style={acc.wrapper}>
      <TouchableOpacity style={acc.header} onPress={onToggle} activeOpacity={0.7}>
        <View style={acc.headerLeft}>
          <Text style={acc.icon}>{section.icon}</Text>
          <Text style={acc.title}>{section.title}</Text>
        </View>
        <Text style={[acc.chevron, isOpen && acc.chevronOpen]}>›</Text>
      </TouchableOpacity>

      {isOpen && (
        <View style={acc.content}>
          {section.items.map((item, i) => (
            <View key={i} style={acc.itemRow}>
              <View style={acc.dot} />
              <Text style={acc.itemText}>{item}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={acc.divider} />
    </View>
  );
}

// ── ModelContent subcomponent ─────────────────────────────────────────────────

function ModelContent({ league, type }) {
  const [openIndex, setOpenIndex] = useState(null);

  useEffect(() => {
    setOpenIndex(null);
  }, [league, type]);

  const data = MODEL_DATA[league]?.[type];
  if (!data) return null;

  const handleToggle = (index) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <View style={acc.container}>
      <Text style={acc.intro}>{data.intro}</Text>

      {data.sections.map((section, i) => (
        <AccordionSection
          key={i}
          section={section}
          isOpen={openIndex === i}
          onToggle={() => handleToggle(i)}
        />
      ))}

      <View style={acc.note}>
        <View style={acc.mascotWrap}>
          <ChalkyMascot size={100} />
        </View>
        <View style={acc.noteBody}>
          <Text style={acc.noteText}>
            <Text style={acc.noteQuote}>{'\u201C '}</Text>
            {data.note}
            <Text style={acc.noteQuote}>{' \u201D'}</Text>
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── Accordion styles ──────────────────────────────────────────────────────────

const acc = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
  },
  intro: {
    color: '#888888',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 16,
  },
  wrapper: {},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  icon: {
    fontSize: 16,
    width: 24,
    textAlign: 'center',
  },
  title: {
    color: '#F5F5F0',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  chevron: {
    color: '#00E87A',
    fontSize: 20,
    fontWeight: '300',
    marginLeft: 8,
    lineHeight: 22,
  },
  chevronOpen: {
    transform: [{ rotate: '90deg' }],
  },
  content: {
    paddingLeft: 34,
    paddingBottom: 14,
    paddingRight: 4,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2a2a2a',
    marginTop: 8,
    flexShrink: 0,
  },
  itemText: {
    flex: 1,
    color: '#888888',
    fontSize: 13,
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: '#141414',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 14,
    marginTop: 20,
  },
  mascotWrap: {
    width: 80,
    alignItems: 'center',
    flexShrink: 0,
  },
  noteBody: {
    flex: 1,
    flexShrink: 1,
  },
  noteText: {
    color: '#888888',
    fontSize: 12,
    lineHeight: 18,
  },
  noteQuote: {
    color: '#00E87A',
    fontSize: 16,
    fontWeight: '800',
  },
});

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

  bottomPad: {
    height: 40,
  },
});
