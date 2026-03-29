/**
 * OnboardingScreen — 3 swipeable intro slides + sign-up screen.
 * Shown to new users before they authenticate.
 * Pressing Skip or Get Started marks onboarding as seen and moves to SignInScreen.
 */
import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Dimensions,
  Image,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';

const CHALKY_PNG = require('../../assets/chalky.png');
const GOLD = '#FFD700';
const { width, height } = Dimensions.get('window');

export const ONBOARDING_SEEN_KEY = 'onboarding_seen';

// ── Mock pick card for slide 2 ─────────────────────────────────────────────

function MockPickCard() {
  return (
    <View style={mock.card}>
      <View style={mock.header}>
        <View style={mock.leagueBadge}>
          <Text style={mock.leagueText}>NBA</Text>
        </View>
        <View style={mock.gameBadge}>
          <Text style={mock.gameBadgeText}>GAME PICK</Text>
        </View>
        <Text style={mock.gameTime}>7:30 PM ET</Text>
      </View>
      <Text style={mock.matchup}>BOS @ LAL</Text>
      <View style={mock.likeRow}>
        <Image source={CHALKY_PNG} style={mock.avatar} resizeMode="contain" />
        <Text style={mock.likes}>Chalky likes</Text>
        <View style={mock.badge}>
          <Text style={mock.badgeText}>HIGH CONFIDENCE</Text>
        </View>
      </View>
      <Text style={mock.pick}>Celtics -4.5</Text>
      <Text style={mock.reason}>Historic edge vs. Lakers at home + back-to-back fatigue</Text>
      <View style={mock.barTrack}>
        <View style={[mock.barFill, { width: '83%' }]} />
      </View>
      <Text style={mock.confLabel}>Confidence  <Text style={{ color: colors.green }}>83%</Text></Text>
    </View>
  );
}

// ── Mock chat bubbles for slide 3 ─────────────────────────────────────────

function MockChat() {
  return (
    <View style={chat.wrap}>
      <View style={chat.userBubble}>
        <Text style={chat.userText}>Is McDavid on the power play tonight?</Text>
      </View>
      <View style={chat.botRow}>
        <Image source={CHALKY_PNG} style={chat.avatar} resizeMode="contain" />
        <View style={chat.botBubble}>
          <Text style={chat.botText}>
            Yes — McDavid logged 3:24 PP TOI last game. EDM PP is clicking at 28.6% this month. That's a strong lean.
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── Slides data ───────────────────────────────────────────────────────────

const SLIDES = [
  {
    id: 's1',
    icon: null, // uses chalky image
    title: 'You found the edge.',
    subtitle: 'AI-powered picks across NBA, MLB, NHL and the World Cup. Real projections. Real lines. Every day at 10 AM.',
    content: null,
  },
  {
    id: 's2',
    icon: null,
    title: "Chalky's Model Does the Work",
    subtitle: 'Real stats, real lines, real edge. Every pick is ranked by confidence — so you know exactly where to look.',
    content: 'mockPick',
  },
  {
    id: 's3',
    icon: null,
    title: 'Ask Chalky Anything',
    subtitle: 'Injuries, line moves, player props, matchup history. Chalky answers it all with Pro.',
    content: 'mockChat',
  },
];

// ── Single slide ──────────────────────────────────────────────────────────

function Slide({ item }) {
  return (
    <View style={[styles.slide, { width }]}>
      {item.content === 'mockPick' ? (
        <MockPickCard />
      ) : item.content === 'mockChat' ? (
        <MockChat />
      ) : (
        <View style={styles.heroImageWrap}>
          <Image source={CHALKY_PNG} style={styles.heroImage} resizeMode="contain" />
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>AI PICKS</Text>
          </View>
        </View>
      )}
      <Text style={styles.slideTitle}>{item.title}</Text>
      <Text style={styles.slideSubtitle}>{item.subtitle}</Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────

export default function OnboardingScreen({ onComplete }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatRef = useRef(null);

  const markSeenAndContinue = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
    } catch {}
    onComplete();
  };

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      const next = currentIndex + 1;
      flatRef.current?.scrollToIndex({ index: next, animated: true });
      setCurrentIndex(next);
    } else {
      markSeenAndContinue();
    }
  };

  const isLast = currentIndex === SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />

      {/* Skip button */}
      <TouchableOpacity style={styles.skipBtn} onPress={markSeenAndContinue} activeOpacity={0.7}>
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      {/* Slides */}
      <FlatList
        ref={flatRef}
        data={SLIDES}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <Slide item={item} />}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={true}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / width);
          setCurrentIndex(idx);
        }}
        style={styles.flatList}
        contentContainerStyle={{ flexGrow: 1 }}
      />

      {/* Bottom area */}
      <View style={styles.bottomArea}>
        {/* Dot indicators */}
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === currentIndex ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        {/* Next / Get Started button */}
        <TouchableOpacity style={styles.nextBtn} onPress={handleNext} activeOpacity={0.85}>
          <Text style={styles.nextBtnText}>
            {isLast ? 'Get Started' : 'Next'}
          </Text>
          <Ionicons
            name={isLast ? 'arrow-forward-circle' : 'chevron-forward'}
            size={18}
            color={colors.background}
          />
        </TouchableOpacity>

        <Text style={styles.legal}>Not financial advice. Bet responsibly.</Text>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  skipBtn: {
    position: 'absolute',
    top: 56,
    right: spacing.lg,
    zIndex: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey,
  },
  flatList: {
    flex: 1,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 40,
    paddingBottom: 20,
    gap: 20,
  },
  heroImageWrap: {
    alignItems: 'center',
    marginBottom: 8,
  },
  heroImage: {
    width: 160,
    height: 160,
  },
  heroBadge: {
    backgroundColor: colors.green + '22',
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.green + '55',
    paddingHorizontal: 14,
    paddingVertical: 5,
    marginTop: -12,
  },
  heroBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.green,
    letterSpacing: 1.5,
  },
  slideTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.offWhite,
    textAlign: 'center',
    letterSpacing: -0.8,
  },
  slideSubtitle: {
    fontSize: 15,
    color: colors.grey,
    textAlign: 'center',
    lineHeight: 22,
  },
  bottomArea: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
    gap: 14,
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 7,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 24,
    backgroundColor: colors.green,
  },
  dotInactive: {
    width: 6,
    backgroundColor: colors.border,
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.green,
    borderRadius: radius.full,
    paddingVertical: 16,
    alignSelf: 'stretch',
  },
  nextBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.background,
    letterSpacing: 0.2,
  },
  legal: {
    fontSize: 11,
    color: colors.grey + '88',
  },
});

// Mock pick card styles
const mock = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  leagueBadge: {
    backgroundColor: '#C9082A',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  leagueText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },
  gameBadge: {
    backgroundColor: '#1E3A5F',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flex: 1,
  },
  gameBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#6B9FD4',
    letterSpacing: 0.6,
  },
  gameTime: {
    fontSize: 11,
    color: colors.grey,
  },
  matchup: {
    fontSize: 13,
    color: colors.greyLight,
  },
  likeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
  },
  avatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  likes: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.green,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  badge: {
    backgroundColor: '#0D2A1A',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.green + '55',
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: colors.green,
    letterSpacing: 0.5,
  },
  pick: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.offWhite,
  },
  reason: {
    fontSize: 12,
    color: colors.grey,
    lineHeight: 17,
  },
  barTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 2,
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.green,
    borderRadius: 2,
  },
  confLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});

// Mock chat styles
const chat = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    gap: 10,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.green,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '80%',
  },
  userText: {
    fontSize: 14,
    color: colors.background,
    fontWeight: '500',
  },
  botRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    flexShrink: 0,
  },
  botBubble: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  botText: {
    fontSize: 14,
    color: colors.offWhite,
    lineHeight: 20,
  },
});
