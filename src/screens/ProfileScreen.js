import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useUser, useAuth } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import ProfileHeader from '../components/profile/ProfileHeader';
import RecentPickRow from '../components/profile/RecentPickRow';
import useProfile from '../hooks/useProfile';
import { useProStatus } from '../hooks/useProStatus';

const TABS = ['Picks', 'Following', 'Followers'];

const mockFollowing = [
  { id: 'u1', username: 'sharpangle',    displayName: 'Sharp Angle',     avatar: '🎯', streak: 7, streakType: 'hot',  followers: 4821  },
  { id: 'u2', username: 'lockoftheday',  displayName: 'Lock of the Day', avatar: '🔒', streak: 3, streakType: 'hot',  followers: 11203 },
  { id: 'u4', username: 'analyticsedge', displayName: 'Analytics Edge',  avatar: '📈', streak: 5, streakType: 'hot',  followers: 2347  },
];
const mockFollowers = [
  { id: 'u5', username: 'nbainsider',   displayName: 'NBA Insider',      avatar: '🏀', streak: 1, streakType: 'cold', followers: 6612 },
  { id: 'u3', username: 'fadetheworld', displayName: 'Fade The World',   avatar: '🌊', streak: 2, streakType: 'cold', followers: 893  },
];

function UserRow({ user }) {
  const [following, setFollowing] = useState(true);
  return (
    <View style={styles.userRow}>
      <View style={styles.userRowAvatar}>
        <Text style={styles.userRowAvatarText}>{user.avatar}</Text>
      </View>
      <View style={styles.userRowInfo}>
        <Text style={styles.userRowName}>{user.displayName}</Text>
        <Text style={styles.userRowHandle}>@{user.username} · {user.followers.toLocaleString()} followers</Text>
      </View>
      <TouchableOpacity
        style={[styles.smallFollowBtn, following && styles.smallFollowBtnActive]}
        onPress={() => setFollowing(v => !v)}
        activeOpacity={0.8}
      >
        <Text style={[styles.smallFollowBtnText, following && styles.smallFollowBtnTextActive]}>
          {following ? 'Following' : 'Follow'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function InfoRow({ icon, label, value, valueStyle }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoRowLeft}>
        <Ionicons name={icon} size={17} color={colors.grey} />
        <Text style={styles.infoRowLabel}>{label}</Text>
      </View>
      <Text style={[styles.infoRowValue, valueStyle]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function SupportRow({ icon, label, onPress }) {
  return (
    <TouchableOpacity style={styles.infoRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.infoRowLeft}>
        <Ionicons name={icon} size={17} color={colors.grey} />
        <Text style={styles.infoRowLabel}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color="#3a3a3a" />
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const [activeTab, setActiveTab]   = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  const { user }    = useUser();
  const { signOut } = useAuth();
  const { isPro }   = useProStatus();
  const { profile, loading, refresh } = useProfile();

  const initials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('');

  const getMemberSince = () => {
    if (!user?.createdAt) return '—';
    return new Date(user.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' });
  };

  const getSubLabel = () => {
    const sub = user?.publicMetadata?.subscription;
    if (sub === 'pro')      return 'Chalky Pro';
    if (sub === 'seasonal') return 'Summer Pass';
    return 'Free';
  };

  const getSubColor = () => isPro ? '#FFD700' : colors.grey;

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
            await signOut();
          },
        },
      ]
    );
  };

  const renderTabContent = () => {
    if (!profile) return null;
    if (activeTab === 0) {
      if (!profile.recentPicks?.length) {
        return (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🎯</Text>
            <Text style={styles.emptyText}>No picks posted yet</Text>
          </View>
        );
      }
      return profile.recentPicks.map(pick => <RecentPickRow key={pick.id} pick={pick} />);
    }
    if (activeTab === 1) return mockFollowing.map(u => <UserRow key={u.id} user={u} />);
    if (activeTab === 2) return mockFollowers.map(u => <UserRow key={u.id} user={u} />);
  };

  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.green} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      <FlatList
        data={[]}
        keyExtractor={() => ''}
        renderItem={null}
        onRefresh={refresh}
        refreshing={loading}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* Top nav */}
            <View style={styles.topNav}>
              <Text style={styles.topNavTitle}>Profile</Text>
            </View>

            {/* Profile header — with Clerk avatar */}
            {profile && (
              <ProfileHeader
                profile={profile}
                isOwnProfile
                isFollowing={false}
                onFollowToggle={() => {}}
                imageUrl={user?.imageUrl || null}
                initials={initials}
              />
            )}

            {/* Tabs */}
            <View style={styles.tabBar}>
              {TABS.map((tab, i) => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tab, activeTab === i && styles.tabActive]}
                  onPress={() => setActiveTab(i)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.tabText, activeTab === i && styles.tabTextActive]}>
                    {tab}
                  </Text>
                  {i === 1 && profile && <Text style={styles.tabCount}> {profile.following}</Text>}
                  {i === 2 && profile && <Text style={styles.tabCount}> {profile.followers}</Text>}
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.tabContent}>{renderTabContent()}</View>

            {/* ── Account section ── */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Account</Text>
              <View style={styles.card}>
                <InfoRow
                  icon="mail-outline"
                  label="Email"
                  value={user?.primaryEmailAddress?.emailAddress || '—'}
                />
                <View style={styles.divider} />
                <InfoRow
                  icon="calendar-outline"
                  label="Member since"
                  value={getMemberSince()}
                />
                <View style={styles.divider} />
                <InfoRow
                  icon="trophy-outline"
                  label="Plan"
                  value={getSubLabel()}
                  valueStyle={{ color: getSubColor(), fontWeight: '700' }}
                />
              </View>
            </View>

            {/* Upgrade card — free users only */}
            {!isPro && (
              <View style={styles.section}>
                <View style={styles.upgradeCard}>
                  <View style={styles.upgradeLeft}>
                    <Text style={styles.upgradeTitle}>Unlock Chalky Pro</Text>
                    <Text style={styles.upgradeSub}>All picks. Unlimited Research. $49.99/mo</Text>
                  </View>
                  <TouchableOpacity style={styles.upgradeBtn} activeOpacity={0.85}>
                    <Text style={styles.upgradeBtnText}>Upgrade</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── Support section ── */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Support</Text>
              <View style={styles.card}>
                <SupportRow icon="help-circle-outline" label="Help Center"       onPress={() => {}} />
                <View style={styles.divider} />
                <SupportRow icon="document-text-outline" label="Terms of Service" onPress={() => {}} />
                <View style={styles.divider} />
                <SupportRow icon="shield-outline"       label="Privacy Policy"   onPress={() => {}} />
              </View>
            </View>

            {/* ── Sign out ── */}
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.signOutBtn}
                onPress={handleSignOut}
                disabled={signingOut}
                activeOpacity={0.8}
              >
                <Ionicons name="log-out-outline" size={18} color={colors.red} />
                <Text style={styles.signOutText}>
                  {signingOut ? 'Signing out…' : 'Sign Out'}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.version}>Chalky v1.0.0</Text>
          </>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topNav: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  topNavTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.offWhite,
    letterSpacing: -0.5,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive:     { borderBottomColor: colors.green },
  tabText:       { fontSize: 13, fontWeight: '600', color: colors.grey },
  tabTextActive: { color: colors.green },
  tabCount:      { fontSize: 12, color: colors.grey },
  tabContent: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  // User rows
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '66',
    gap: spacing.sm,
  },
  userRowAvatar: {
    width: 44, height: 44, borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  userRowAvatarText: { fontSize: 22 },
  userRowInfo:   { flex: 1 },
  userRowName:   { fontSize: 14, fontWeight: '700', color: colors.offWhite },
  userRowHandle: { fontSize: 11, color: colors.grey, marginTop: 2 },
  smallFollowBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.offWhite,
  },
  smallFollowBtnActive: {
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
  },
  smallFollowBtnText:       { fontSize: 12, fontWeight: '700', color: colors.background },
  smallFollowBtnTextActive: { color: colors.grey },
  // Empty state
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl, gap: spacing.md },
  emptyIcon:  { fontSize: 40 },
  emptyText:  { fontSize: 15, color: colors.grey },
  // Sections
  section: {
    paddingHorizontal: spacing.md,
    marginBottom: 24,
  },
  sectionTitle: {
    color: colors.grey,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  infoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoRowLabel: { color: colors.offWhite, fontSize: 15, fontWeight: '500' },
  infoRowValue: { color: colors.grey, fontSize: 14, maxWidth: '55%', textAlign: 'right' },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 45,
  },
  // Upgrade
  upgradeCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFD700',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  upgradeLeft:  { flex: 1, marginRight: 12 },
  upgradeTitle: { color: colors.offWhite, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  upgradeSub:   { color: colors.grey, fontSize: 12, lineHeight: 18 },
  upgradeBtn: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  upgradeBtnText: { color: '#080808', fontSize: 13, fontWeight: '800' },
  // Sign out
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
  },
  signOutText: { color: colors.red, fontSize: 15, fontWeight: '600' },
  version: {
    color: '#3a3a3a',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 40,
  },
});
