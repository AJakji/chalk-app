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
  Alert,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native';
import { useUser, useAuth } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { AFFILIATE_LINKS } from '../config';
import ChalkyLogo from './ChalkyLogo';
import { useProStatus } from '../hooks/useProStatus';
import { navigate } from '../navigationRef';

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
  const { user } = useUser();
  const { signOut } = useAuth();
  const { isPro } = useProStatus();
  const [signingOut, setSigningOut] = useState(false);

  const initials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('');

  const getMemberSince = () => {
    if (!user?.createdAt) return '—';
    return new Date(user.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' });
  };

  const getSubLabel = () => {
    const sub = user?.publicMetadata?.subscription;
    if (sub === 'pro') return 'Chalky Pro';
    if (sub === 'seasonal') return 'Summer Pass';
    return 'Free';
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            onClose();
            await signOut();
          },
        },
      ]
    );
  };

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
          {/* Avatar + name */}
          <View style={styles.profileHero}>
            <View style={styles.profileAvatarCircle}>
              {initials ? (
                <Text style={styles.profileAvatarInitials}>{initials}</Text>
              ) : (
                <Text style={styles.profileAvatarEmoji}>😎</Text>
              )}
            </View>
            <Text style={styles.profileName}>
              {user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'Chalky User'}
            </Text>
            <Text style={styles.profileSub}>
              {user?.primaryEmailAddress?.emailAddress || ''}
            </Text>
          </View>

          {/* Account card */}
          <Text style={styles.settingsSectionLabel}>Account</Text>
          <View style={styles.profileCard}>
            <View style={styles.profileInfoRow}>
              <View style={styles.profileInfoLeft}>
                <Ionicons name="calendar-outline" size={16} color={colors.grey} />
                <Text style={styles.settingsRowText}>Member since</Text>
              </View>
              <Text style={styles.settingsRowValue}>{getMemberSince()}</Text>
            </View>
            <View style={styles.profileCardDivider} />
            <View style={styles.profileInfoRow}>
              <View style={styles.profileInfoLeft}>
                <Ionicons name="trophy-outline" size={16} color={colors.grey} />
                <Text style={styles.settingsRowText}>Plan</Text>
              </View>
              <Text style={[styles.settingsRowValue, { color: isPro ? '#FFD700' : colors.grey, fontWeight: '700' }]}>
                {getSubLabel()}
              </Text>
            </View>
          </View>

          {/* Upgrade banner — free users only */}
          {!isPro && (
            <>
              <Text style={[styles.settingsSectionLabel, { marginTop: spacing.lg }]}>Upgrade</Text>
              <View style={styles.upgradeCard}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={styles.upgradeTitle}>Unlock Chalky Pro</Text>
                  <Text style={styles.upgradeSub}>All picks. Unlimited Research. $49.99/mo</Text>
                </View>
                <TouchableOpacity style={styles.upgradeBtn} activeOpacity={0.85}>
                  <Text style={styles.upgradeBtnText}>Upgrade</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Support */}
          <Text style={[styles.settingsSectionLabel, { marginTop: spacing.lg }]}>Support</Text>
          <View style={styles.profileCard}>
            <TouchableOpacity style={styles.profileInfoRow} activeOpacity={0.75}>
              <View style={styles.profileInfoLeft}>
                <Ionicons name="document-text-outline" size={16} color={colors.grey} />
                <Text style={styles.settingsRowText}>Terms of Service</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color="#3a3a3a" />
            </TouchableOpacity>
            <View style={styles.profileCardDivider} />
            <TouchableOpacity style={styles.profileInfoRow} activeOpacity={0.75}>
              <View style={styles.profileInfoLeft}>
                <Ionicons name="shield-outline" size={16} color={colors.grey} />
                <Text style={styles.settingsRowText}>Privacy Policy</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color="#3a3a3a" />
            </TouchableOpacity>
          </View>

          {/* Sign out */}
          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={handleSignOut}
            disabled={signingOut}
            activeOpacity={0.8}
          >
            <Ionicons name="log-out-outline" size={18} color={colors.red} />
            <Text style={styles.signOutText}>{signingOut ? 'Signing out…' : 'Sign Out'}</Text>
          </TouchableOpacity>

          <Text style={styles.versionText}>Chalky v1.0.0</Text>
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

  const openSupport = () => {
    closeDrawer(() => setTimeout(() => navigate('SupportSuggestions'), 300));
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

            <TouchableOpacity
              style={styles.drawerItem}
              onPress={openSupport}
              activeOpacity={0.75}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.green} />
              <View style={styles.drawerItemText}>
                <Text style={styles.drawerItemLabel}>Support & Suggestions</Text>
                <Text style={styles.drawerItemSub}>Report issues or share ideas</Text>
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
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarInitials: { fontSize: 30, fontWeight: '700', color: colors.offWhite },
  profileAvatarEmoji: { fontSize: 34 },
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
  profileCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  profileInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  profileInfoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileCardDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 42,
  },
  settingsRowText: {
    fontSize: 15,
    color: colors.offWhite,
    fontWeight: '500',
  },
  settingsRowValue: {
    fontSize: 14,
    color: colors.grey,
  },
  upgradeCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFD700',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  upgradeTitle: { color: colors.offWhite, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  upgradeSub: { color: colors.grey, fontSize: 12, lineHeight: 18 },
  upgradeBtn: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  upgradeBtnText: { color: '#080808', fontSize: 13, fontWeight: '800' },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    marginTop: spacing.lg,
  },
  signOutText: { color: colors.red, fontSize: 15, fontWeight: '600' },
  versionText: {
    color: '#3a3a3a',
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
});
