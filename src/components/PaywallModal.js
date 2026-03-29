import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ScrollView,
  SafeAreaView,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';

const CHALKY_PNG = require('../../assets/chalky.png');

const GOLD = '#FFD700';
const GOLD_DIM = '#FFD70022';
const GOLD_BORDER = '#FFD70055';

function CheckRow({ text }) {
  return (
    <View style={styles.checkRow}>
      <View style={styles.checkCircle}>
        <Ionicons name="checkmark" size={13} color={colors.background} />
      </View>
      <Text style={styles.checkText}>{text}</Text>
    </View>
  );
}

export default function PaywallModal({ visible, onClose }) {
  const slideAnim = useRef(new Animated.Value(600)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(600);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 600,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <Animated.View style={[styles.overlay, { opacity: opacityAnim }]}>
        <TouchableOpacity style={styles.overlayTap} activeOpacity={1} onPress={handleClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <SafeAreaView style={styles.safeArea}>
            {/* Close button */}
            <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color={colors.grey} />
            </TouchableOpacity>

            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {/* Glow + avatar */}
              <View style={styles.heroSection}>
                <View style={styles.glowRing}>
                  <Image source={CHALKY_PNG} style={styles.avatar} resizeMode="contain" />
                </View>
                <View style={styles.lockBadge}>
                  <Ionicons name="lock-closed" size={11} color={GOLD} />
                  <Text style={styles.lockBadgeText}>PRO</Text>
                </View>
              </View>

              <Text style={styles.headline}>Unlock Chalky Pro</Text>
              <Text style={styles.subheadline}>
                You found the edge. Now use it.
              </Text>

              {/* Feature list */}
              <View style={styles.featureList}>
                <CheckRow text="All 5 of Chalky's top daily picks — including his best bets" />
                <CheckRow text="Unlimited questions in the Research tab" />
                <CheckRow text="Deep stats, injury intel, and line movement alerts" />
              </View>

              {/* Pricing cards */}
              <View style={styles.pricingRow}>
                {/* Seasonal — BEST VALUE */}
                <View style={[styles.pricingCard, styles.pricingCardBest]}>
                  <View style={styles.bestValueBadge}>
                    <Text style={styles.bestValueText}>BEST VALUE</Text>
                  </View>
                  <Text style={styles.pricingAmount}>$49.99</Text>
                  <Text style={styles.pricingPeriod}>/ season</Text>
                  <Text style={styles.pricingSavings}>Save 29%</Text>
                </View>

                {/* Monthly */}
                <View style={styles.pricingCard}>
                  <Text style={styles.pricingAmount}>$9.99</Text>
                  <Text style={styles.pricingPeriod}>/ month</Text>
                  <Text style={[styles.pricingSavings, { color: 'transparent' }]}>—</Text>
                </View>
              </View>

              {/* CTA */}
              <TouchableOpacity style={styles.ctaBtn} activeOpacity={0.85}>
                <Text style={styles.ctaText}>Start Chalky Pro</Text>
              </TouchableOpacity>

              <Text style={styles.freeTierNote}>
                Free plan: top 2 picks per day, limited research queries
              </Text>

              <Text style={styles.legalNote}>
                Cancel anytime. 18+ only. Bet responsibly.
              </Text>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  overlayTap: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: GOLD_BORDER,
    maxHeight: '88%',
  },
  safeArea: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    paddingTop: 36,
    paddingBottom: 40,
    paddingHorizontal: spacing.lg,
    gap: 16,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 4,
  },
  glowRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: GOLD_DIM,
    borderWidth: 2,
    borderColor: GOLD_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 72,
    height: 72,
  },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: GOLD_DIM,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: -10,
  },
  lockBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: GOLD,
    letterSpacing: 1.2,
  },
  headline: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.offWhite,
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  subheadline: {
    fontSize: 14,
    color: colors.grey,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: -4,
  },
  featureList: {
    alignSelf: 'stretch',
    gap: 12,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  checkText: {
    fontSize: 13,
    color: colors.offWhite,
    lineHeight: 20,
    flex: 1,
  },
  pricingRow: {
    flexDirection: 'row',
    gap: 12,
    alignSelf: 'stretch',
  },
  pricingCard: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  pricingCardBest: {
    borderColor: GOLD_BORDER,
    backgroundColor: GOLD_DIM,
    paddingTop: 28,
  },
  bestValueBadge: {
    position: 'absolute',
    top: -11,
    backgroundColor: GOLD,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  bestValueText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.background,
    letterSpacing: 0.8,
  },
  pricingAmount: {
    fontSize: 24,
    fontWeight: '900',
    color: colors.offWhite,
    letterSpacing: -0.5,
  },
  pricingPeriod: {
    fontSize: 12,
    color: colors.grey,
    fontWeight: '600',
  },
  pricingSavings: {
    fontSize: 11,
    color: colors.green,
    fontWeight: '700',
    marginTop: 2,
  },
  ctaBtn: {
    backgroundColor: colors.green,
    borderRadius: radius.full,
    paddingVertical: 16,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.background,
    letterSpacing: 0.2,
  },
  freeTierNote: {
    fontSize: 12,
    color: colors.grey,
    textAlign: 'center',
    marginTop: -4,
  },
  legalNote: {
    fontSize: 11,
    color: colors.grey + '88',
    textAlign: 'center',
    marginTop: -8,
  },
});
