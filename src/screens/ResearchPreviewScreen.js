import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { usePaywall } from '../context/PaywallContext';

const SAMPLE_CONVERSATION = [
  {
    role: 'user',
    text: "What about the umpire for tonight's Yankees game?",
  },
  {
    role: 'chalky',
    text: "HP Ump: CB Bucknor. Tight zone — 13.8 K/game vs league avg 16.2. Runs/game: 10.1 (above average). Slight lean toward hitters tonight at Yankee Stadium.",
  },
  {
    role: 'user',
    text: "How has SGA been playing at home this season?",
  },
  {
    role: 'chalky',
    text: "SGA in home games this season (21 games): 32.8 PTS / 6.2 AST on 55.1% FG. On the road he drops to 29.4 PTS / 6.5 AST on 50.8% FG. Notably stronger at home — one of the bigger home/away splits in the league.",
  },
];

const FEATURES = [
  { icon: 'stats-chart', text: "Player splits — home/away, B2B, last 5 games" },
  { icon: 'people',      text: "Matchup breakdowns — pace, defense, style" },
  { icon: 'baseball',    text: "MLB context — umpire, weather, bullpen fatigue" },
  { icon: 'analytics',   text: "Historical matchups — how players perform vs specific opponents" },
];

export default function ResearchPreviewScreen() {
  const { openPaywall } = usePaywall();

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, []);

  const animStyle = { opacity: fadeAnim, transform: [{ translateY: slideAnim }] };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* Header */}
        <Animated.View style={[styles.header, animStyle]}>
          <View style={styles.titleRow}>
            <Ionicons name="search" size={22} color="#FFD700" />
            <Text style={styles.title}>Research</Text>
          </View>
          <Text style={styles.subtitle}>
            Your personal sports analyst. Ask anything about players, matchups, splits, and stats. Research is free during its early stages — we want your feedback to make it sharper.
          </Text>
        </Animated.View>

        {/* Sample conversation */}
        <Animated.View style={[styles.chatPreview, animStyle]}>
          <View style={styles.chatHeader}>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.livePillText}>SAMPLE CONVERSATION</Text>
            </View>
          </View>

          {SAMPLE_CONVERSATION.map((msg, i) => (
            <View
              key={i}
              style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.chalkyBubble]}
            >
              {msg.role === 'chalky' && <Text style={styles.chalkyLabel}>CHALKY</Text>}
              <Text style={[styles.bubbleText, msg.role === 'user' ? styles.userText : styles.chalkyText]}>
                {msg.text}
              </Text>
            </View>
          ))}

          {/* Fade-out at bottom to tease more */}
          <View style={styles.chatFade} pointerEvents="none" />
        </Animated.View>

        {/* Feature list */}
        <Animated.View style={[styles.featuresSection, { opacity: fadeAnim }]}>
          <Text style={styles.featuresTitle}>What you can ask Chalky</Text>
          {FEATURES.map((item, i) => (
            <View key={i} style={[styles.featureRow, i === FEATURES.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={styles.featureIcon}>
                <Ionicons name={item.icon} size={15} color="#00E87A" />
              </View>
              <Text style={styles.featureText}>{item.text}</Text>
            </View>
          ))}
        </Animated.View>

        {/* Upgrade CTA */}
        <Animated.View style={[styles.ctaSection, { opacity: fadeAnim }]}>
          <Text style={styles.ctaTitle}>Research is free right now</Text>
          <Text style={styles.ctaSub}>Get Chalky Pro and use Research free while we build it out together. Your questions help us make it better.</Text>

          <TouchableOpacity style={styles.ctaBtn} onPress={openPaywall} activeOpacity={0.85}>
            <Text style={styles.ctaBtnText}>Get Chalky Pro — $49.99/mo</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.seasonalBtn} onPress={openPaywall} activeOpacity={0.7}>
            <Text style={styles.seasonalText}>Or get the Summer Pass at $34.99/mo</Text>
          </TouchableOpacity>

          <Text style={styles.socialNote}>
            Follow <Text style={styles.handle}>@chalkyapp</Text> for free daily picks on Instagram, TikTok & X
          </Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#080808' },
  container: { flex: 1 },
  content:   { paddingBottom: 48 },

  header: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 20,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  title: {
    color: '#F5F5F0',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: '#888888',
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
  },

  // Chat preview
  chatPreview: {
    marginHorizontal: 20,
    backgroundColor: '#0f0f0f',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 16,
    marginBottom: 28,
    overflow: 'hidden',
  },
  chatHeader: { marginBottom: 14 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#141414',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  liveDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00E87A' },
  livePillText: { color: '#888888', fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },

  bubble: {
    marginBottom: 10,
    maxWidth: '88%',
    borderRadius: 14,
    padding: 12,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  chalkyBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#080808',
    borderWidth: 1,
    borderColor: '#00E87A22',
  },
  chalkyLabel: {
    color: '#00E87A',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 5,
  },
  bubbleText:  { fontSize: 13, lineHeight: 20 },
  userText:    { color: '#F5F5F0' },
  chalkyText:  { color: '#cccccc' },
  chatFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: 'transparent',
  },

  // Features
  featuresSection: { marginHorizontal: 20, marginBottom: 28 },
  featuresTitle: {
    color: '#888888',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 14,
    marginLeft: 2,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#111111',
  },
  featureIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { color: '#F5F5F0', fontSize: 14, flex: 1, lineHeight: 20 },

  // CTA
  ctaSection:  { marginHorizontal: 20, alignItems: 'center' },
  ctaTitle: {
    color: '#F5F5F0',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  ctaSub: {
    color: '#888888',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 22,
    lineHeight: 22,
  },
  ctaBtn: {
    backgroundColor: '#00E87A',
    borderRadius: 12,
    paddingVertical: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  ctaBtnText:   { color: '#080808', fontSize: 15, fontWeight: '800' },
  seasonalBtn:  { paddingVertical: 10, width: '100%', alignItems: 'center', marginBottom: 22 },
  seasonalText: { color: '#555555', fontSize: 13, textDecorationLine: 'underline' },
  socialNote:   { color: '#444444', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  handle:       { color: '#00E87A', fontWeight: '600' },
});
