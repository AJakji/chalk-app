/**
 * ChalkyOnboarding — First open intro modal.
 * Chalky introduces himself. Shows once, stored in AsyncStorage.
 */
import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, radius } from '../theme';

const CHALKY_PNG = require('../../assets/chalky.png');

const SEEN_KEY = '@chalky_intro_seen';
const { width } = Dimensions.get('window');

export default function ChalkyOnboarding() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY)
      .then((val) => { if (!val) setVisible(true); })
      .catch(() => setVisible(true)); // show if AsyncStorage unavailable
  }, []);

  const dismiss = async () => {
    try { await AsyncStorage.setItem(SEEN_KEY, 'true'); } catch {}
    setVisible(false);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Chalky hero image */}
          <View style={styles.avatarWrap}>
            <Image source={CHALKY_PNG} style={styles.heroImage} resizeMode="contain" />
          </View>

          {/* Name line */}
          <Text style={styles.name}>Chalky</Text>
          <View style={styles.verifiedRow}>
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedText}>OFFICIAL PICKS</Text>
            </View>
          </View>

          {/* Chalky's intro — his voice: terse, confident, mysterious */}
          <Text style={styles.line}>
            I study every line before you wake up.
          </Text>
          <Text style={styles.line}>
            I don't guess. I calculate.
          </Text>
          <Text style={styles.line}>
            Every pick you see is mine.{'\n'}
            Follow the chalk.
          </Text>

          {/* Subtle stat row */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>84%</Text>
              <Text style={styles.statLabel}>Last 30 days</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statNum, { color: colors.green }]}>5</Text>
              <Text style={styles.statLabel}>Win streak</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNum}>48.2K</Text>
              <Text style={styles.statLabel}>Following</Text>
            </View>
          </View>

          {/* CTA */}
          <TouchableOpacity style={styles.btn} onPress={dismiss} activeOpacity={0.85}>
            <Text style={styles.btnText}>Follow the chalk</Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            The edge has a name... Chalky.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: colors.border,
    gap: 14,
  },
  avatarWrap: {
    marginBottom: 4,
    alignItems: 'center',
  },
  heroImage: {
    width: 120,
    height: 120,
  },
  name: {
    fontSize: 30,
    fontWeight: '900',
    color: colors.offWhite,
    letterSpacing: -1,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  verifiedBadge: {
    backgroundColor: colors.green + '22',
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.green + '55',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  verifiedText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.green,
    letterSpacing: 1.2,
  },
  line: {
    fontSize: 16,
    color: colors.offWhite,
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 6,
    alignSelf: 'stretch',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNum: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.offWhite,
  },
  statLabel: {
    fontSize: 9,
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  btn: {
    backgroundColor: colors.green,
    borderRadius: 999,
    paddingVertical: 15,
    paddingHorizontal: spacing.xl,
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.background,
    letterSpacing: 0.2,
  },
  footnote: {
    fontSize: 11,
    color: colors.grey,
    letterSpacing: 0.3,
  },
});
