/**
 * ChalkyMenuButton — hamburger icon that opens a left-side slide drawer.
 * Contains "Chalky's Textbook" and "Profile" as full-screen modals.
 */
import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Modal,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Linking,
  Pressable,
  Switch,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native';
import { colors, spacing, radius } from '../theme';
import { AFFILIATE_LINKS } from '../config';
import ChalkyLogo from './ChalkyLogo';

const CHALKY_PNG = require('../../assets/chalky.png');

// ─── Drawer Icons (green, view-based — no icon library needed) ───────────────

function BookIcon({ size = 20 }) {
  const c = colors.green;
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View style={{
        width: size * 0.82,
        height: size * 0.68,
        borderWidth: 1.8,
        borderColor: c,
        borderRadius: 1,
        justifyContent: 'center',
        alignItems: 'center',
      }}>
        {/* Spine */}
        <View style={{ position: 'absolute', width: 1.8, top: 0, bottom: 0, backgroundColor: c }} />
        {/* Lines */}
        <View style={{ position: 'absolute', top: '33%', left: '55%', right: '10%', height: 1.5, backgroundColor: c, opacity: 0.6 }} />
        <View style={{ position: 'absolute', top: '58%', left: '55%', right: '10%', height: 1.5, backgroundColor: c, opacity: 0.6 }} />
      </View>
    </View>
  );
}

function PersonIcon({ size = 20 }) {
  const c = colors.green;
  const headSize = size * 0.4;
  const bodyW = size * 0.68;
  const bodyH = size * 0.3;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', gap: size * 0.06 }}>
      <View style={{
        width: headSize, height: headSize, borderRadius: headSize / 2,
        borderWidth: 1.8, borderColor: c,
      }} />
      <View style={{
        width: bodyW, height: bodyH,
        borderTopLeftRadius: bodyW / 2, borderTopRightRadius: bodyW / 2,
        borderWidth: 1.8, borderColor: c, borderBottomWidth: 0,
      }} />
    </View>
  );
}
const DRAWER_WIDTH = 280;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SPORTSBOOKS = [
  {
    key: 'draftkings',
    name: 'DraftKings',
    quote: 'Deep markets, fast payouts on NBA and MLB. This is the move.',
    promo: 'Bet $5, Get $200 in Bonus Bets',
    bestFor: 'NBA spreads & same-game parlays',
    accentColor: '#1B5E3B',
  },
  {
    key: 'fanduel',
    name: 'FanDuel',
    quote: "Best live betting interface on the market. When the line moves, I'm here.",
    promo: 'No Sweat First Bet up to $1,000',
    bestFor: 'Live betting & NBA props',
    accentColor: '#1C3E8E',
  },
  {
    key: 'betmgm',
    name: 'BetMGM',
    quote: 'Widest prop markets. When I need an edge on player stats, BetMGM delivers.',
    promo: 'First Bet Offer up to $1,500',
    bestFor: 'Player props & alternate lines',
    accentColor: '#B29560',
  },
  {
    key: 'bet365',
    name: 'bet365',
    quote: 'Soccer is my territory. No one covers the global game better.',
    promo: 'Bet $1, Get $365 in Bonus Bets',
    bestFor: 'Soccer & international markets',
    accentColor: '#007A3D',
  },
];

// ─── Textbook Modal ──────────────────────────────────────────────────────────

function TextbookModal({ visible, onClose }) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.modalSafeArea}>
        <View style={styles.modalTopBar}>
          <View>
            <Text style={styles.modalTitle}>Chalky's Textbook</Text>
            <Text style={styles.modalSubtitle}>Where Chalky puts his money.</Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {SPORTSBOOKS.map((book) => (
            <View
              key={book.key}
              style={[styles.bookCard, { borderLeftColor: book.accentColor }]}
            >
              <View style={styles.bookHeader}>
                <View
                  style={[
                    styles.bookBadge,
                    { backgroundColor: book.accentColor + '22', borderColor: book.accentColor + '55' },
                  ]}
                >
                  <Text style={[styles.bookBadgeText, { color: book.accentColor }]}>
                    {book.name}
                  </Text>
                </View>
                <View style={styles.bookBestFor}>
                  <Text style={styles.bookBestForLabel}>Best for</Text>
                  <Text style={styles.bookBestForValue}>{book.bestFor}</Text>
                </View>
              </View>

              <View style={styles.chalkyQuoteRow}>
                <Image source={CHALKY_PNG} style={styles.quoteIcon} resizeMode="cover" />
                <Text style={styles.chalkyQuote}>"{book.quote}"</Text>
              </View>

              <View style={styles.promoRow}>
                <Text style={styles.promoLabel}>Current offer</Text>
                <Text style={styles.promoText}>{book.promo}</Text>
              </View>

              <TouchableOpacity
                style={styles.getStartedBtn}
                onPress={() => Linking.openURL(AFFILIATE_LINKS[book.key] || '#')}
                activeOpacity={0.8}
              >
                <Text style={styles.getStartedText}>Get Started →</Text>
              </TouchableOpacity>
            </View>
          ))}

          <Text style={styles.textbookDisclaimer}>
            Not Financial Advice, Bet Responsibly
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Profile Modal ───────────────────────────────────────────────────────────

function ProfileModal({ visible, onClose }) {
  const [notifications, setNotifications] = useState(false);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.modalSafeArea}>
        <View style={styles.modalTopBar}>
          <Text style={styles.modalTitle}>Profile</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.profileHero}>
            <View style={styles.profileAvatarCircle}>
              <Text style={styles.profileAvatarEmoji}>👤</Text>
            </View>
            <Text style={styles.profileName}>Guest</Text>
            <Text style={styles.profileSub}>Sign in to follow Chalky's picks</Text>
          </View>

          <Text style={styles.settingsSectionLabel}>Preferences</Text>
          <View style={styles.settingsRow}>
            <Text style={styles.settingsRowText}>Push Notifications</Text>
            <Switch
              value={notifications}
              onValueChange={setNotifications}
              trackColor={{ false: colors.border, true: colors.green + '88' }}
              thumbColor={notifications ? colors.green : colors.grey}
            />
          </View>

          <Text style={[styles.settingsSectionLabel, { marginTop: spacing.lg }]}>About</Text>
          <TouchableOpacity style={styles.settingsRowBtn} activeOpacity={0.75}>
            <Text style={styles.settingsRowText}>Privacy Policy</Text>
            <Text style={styles.settingsRowArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsRowBtn} activeOpacity={0.75}>
            <Text style={styles.settingsRowText}>Terms of Service</Text>
            <Text style={styles.settingsRowArrow}>→</Text>
          </TouchableOpacity>
          <View style={styles.settingsRow}>
            <Text style={styles.settingsRowText}>Version</Text>
            <Text style={styles.settingsRowValue}>1.0.0</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export default function ChalkyMenuButton() {
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [textbookOpen, setTextbookOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  const openDrawer = () => {
    setDrawerVisible(true);
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 65,
        friction: 9,
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnim, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const closeDrawer = (callback) => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -DRAWER_WIDTH,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setDrawerVisible(false);
      callback?.();
    });
  };

  // Swipe left to close
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dx < -8 && Math.abs(g.dy) < 40,
      onPanResponderMove: (_, g) => {
        if (g.dx < 0) {
          slideAnim.setValue(Math.max(g.dx, -DRAWER_WIDTH));
          overlayAnim.setValue(Math.max(0, 1 + g.dx / DRAWER_WIDTH));
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -60 || g.vx < -0.5) {
          closeDrawer();
        } else {
          Animated.parallel([
            Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true }),
            Animated.spring(overlayAnim, { toValue: 1, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  const openTextbook = () => {
    closeDrawer(() => setTimeout(() => setTextbookOpen(true), 100));
  };

  const openProfile = () => {
    closeDrawer(() => setTimeout(() => setProfileOpen(true), 100));
  };

  return (
    <>
      {/* Hamburger button */}
      <TouchableOpacity
        style={styles.hamburgerBtn}
        onPress={openDrawer}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <View style={styles.hamburgerLine} />
        <View style={styles.hamburgerLine} />
        <View style={styles.hamburgerLine} />
      </TouchableOpacity>

      {/* Drawer */}
      <Modal
        visible={drawerVisible}
        transparent
        animationType="none"
        onRequestClose={() => closeDrawer()}
        statusBarTranslucent
      >
        {/* Dark overlay */}
        <Animated.View
          style={[
            styles.overlay,
            { opacity: overlayAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.65] }) },
          ]}
          pointerEvents="none"
        />

        {/* Tap overlay to close */}
        <Pressable
          style={styles.overlayPressable}
          onPress={() => closeDrawer()}
        />

        {/* Drawer panel */}
        <Animated.View
          style={[
            styles.drawer,
            { transform: [{ translateX: slideAnim }] },
          ]}
          {...panResponder.panHandlers}
        >
          <SafeAreaView style={styles.drawerSafeArea}>
            {/* Header */}
            <View style={styles.drawerHeader}>
              <ChalkyLogo size={28} />
              <Text style={styles.drawerTagline}>You found the edge.</Text>
            </View>

            <View style={styles.drawerDivider} />

            {/* Menu items */}
            <TouchableOpacity
              style={styles.drawerItem}
              onPress={openTextbook}
              activeOpacity={0.75}
            >
              <BookIcon />
              <View style={styles.drawerItemText}>
                <Text style={styles.drawerItemLabel}>Chalky's Textbook</Text>
                <Text style={styles.drawerItemSub}>Where to bet</Text>
              </View>
              <Text style={styles.drawerItemArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.drawerItem}
              onPress={openProfile}
              activeOpacity={0.75}
            >
              <PersonIcon />
              <View style={styles.drawerItemText}>
                <Text style={styles.drawerItemLabel}>Profile</Text>
                <Text style={styles.drawerItemSub}>Settings & preferences</Text>
              </View>
              <Text style={styles.drawerItemArrow}>›</Text>
            </TouchableOpacity>

          </SafeAreaView>
        </Animated.View>
      </Modal>

      <TextbookModal visible={textbookOpen} onClose={() => setTextbookOpen(false)} />
      <ProfileModal visible={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  // Hamburger button
  hamburgerBtn: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 3,
  },
  hamburgerLine: {
    height: 2,
    backgroundColor: colors.white,
    borderRadius: 2,
    width: '100%',
  },

  // Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  overlayPressable: {
    position: 'absolute',
    top: 0,
    left: DRAWER_WIDTH,
    right: 0,
    bottom: 0,
  },

  // Drawer
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: colors.background,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 8, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 16,
  },
  drawerSafeArea: {
    flex: 1,
  },

  // Drawer header
  drawerHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
    alignItems: 'flex-start',
  },
  drawerName: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.offWhite,
    letterSpacing: -0.5,
  },
  drawerTagline: {
    fontSize: 12,
    color: colors.grey,
    marginTop: 2,
  },
  drawerDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },

  // Drawer items
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
    gap: spacing.md,
  },
  drawerItemIcon: {
    fontSize: 18,
    width: 24,
    textAlign: 'center',
  },
  drawerItemText: {
    flex: 1,
  },
  drawerItemLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.green,
  },
  drawerItemSub: {
    fontSize: 12,
    color: colors.grey,
    marginTop: 1,
  },
  drawerItemArrow: {
    fontSize: 20,
    color: colors.green,
    fontWeight: '300',
  },

  // Drawer footer
  drawerFooter: {
    position: 'absolute',
    bottom: spacing.xxl,
    left: spacing.lg,
    right: spacing.lg,
  },
  drawerFooterText: {
    fontSize: 11,
    color: colors.grey,
    fontStyle: 'italic',
  },

  // ── Modal shared ───────────────────────────────────────────────────────────
  modalSafeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalTopBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.offWhite,
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    fontSize: 12,
    color: colors.grey,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: colors.grey,
    fontSize: 14,
    fontWeight: '600',
  },
  modalScroll: { flex: 1 },
  modalScrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },

  // ── Textbook ───────────────────────────────────────────────────────────────
  bookCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    gap: spacing.md,
  },
  bookHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  bookBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  bookBadgeText: {
    fontSize: 13,
    fontWeight: '800',
  },
  bookBestFor: { alignItems: 'flex-end' },
  bookBestForLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bookBestForValue: {
    fontSize: 11,
    color: colors.greyLight,
    textAlign: 'right',
    marginTop: 2,
  },
  chalkyQuoteRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  quoteIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    flexShrink: 0,
    marginTop: 2,
  },
  chalkyQuote: {
    fontSize: 14,
    color: colors.offWhite,
    lineHeight: 21,
    fontStyle: 'italic',
    flex: 1,
  },
  promoRow: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  promoLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  promoText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.green,
  },
  getStartedBtn: {
    backgroundColor: colors.green,
    borderRadius: radius.full,
    paddingVertical: 10,
    alignItems: 'center',
  },
  getStartedText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.background,
    letterSpacing: 0.2,
  },
  textbookDisclaimer: {
    fontSize: 11,
    color: colors.grey,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 18,
  },

  // ── Profile ────────────────────────────────────────────────────────────────
  profileHero: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  profileAvatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarEmoji: { fontSize: 32 },
  profileName: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.offWhite,
    letterSpacing: -0.3,
  },
  profileSub: {
    fontSize: 13,
    color: colors.grey,
  },
  settingsSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsRowText: {
    fontSize: 15,
    color: colors.offWhite,
  },
  settingsRowArrow: {
    fontSize: 15,
    color: colors.grey,
  },
  settingsRowValue: {
    fontSize: 13,
    color: colors.grey,
  },
});
