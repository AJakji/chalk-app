import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { colors, spacing, radius } from '../theme';
import ProfileHeader from '../components/profile/ProfileHeader';
import RecentPickRow from '../components/profile/RecentPickRow';
import useProfile from '../hooks/useProfile';

const TABS = ['Picks', 'Following', 'Followers'];

// Mock follow lists
const mockFollowing = [
  { id: 'u1', username: 'sharpangle', displayName: 'Sharp Angle', avatar: '🎯', streak: 7, streakType: 'hot', followers: 4821 },
  { id: 'u2', username: 'lockoftheday', displayName: 'Lock of the Day', avatar: '🔒', streak: 3, streakType: 'hot', followers: 11203 },
  { id: 'u4', username: 'analyticsedge', displayName: 'Analytics Edge', avatar: '📈', streak: 5, streakType: 'hot', followers: 2347 },
];
const mockFollowers = [
  { id: 'u5', username: 'nbainsider', displayName: 'NBA Insider', avatar: '🏀', streak: 1, streakType: 'cold', followers: 6612 },
  { id: 'u3', username: 'fadetheworld', displayName: 'Fade The World', avatar: '🌊', streak: 2, streakType: 'cold', followers: 893 },
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
        onPress={() => setFollowing((v) => !v)}
        activeOpacity={0.8}
      >
        <Text style={[styles.smallFollowBtnText, following && styles.smallFollowBtnTextActive]}>
          {following ? 'Following' : 'Follow'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ProfileScreen() {
  const [activeTab, setActiveTab] = useState(0);
  const { signOut } = useAuth();
  const { profile, loading, refresh } = useProfile();

  function confirmSignOut() {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
      ]
    );
  }

  const renderContent = () => {
    if (!profile) return null;
    if (activeTab === 0) {
      if (!profile.recentPicks || profile.recentPicks.length === 0) {
        return (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🎯</Text>
            <Text style={styles.emptyText}>No picks posted yet</Text>
          </View>
        );
      }
      return profile.recentPicks.map((pick) => (
        <RecentPickRow key={pick.id} pick={pick} />
      ));
    }
    if (activeTab === 1) {
      return mockFollowing.map((user) => <UserRow key={user.id} user={user} />);
    }
    if (activeTab === 2) {
      return mockFollowers.map((user) => <UserRow key={user.id} user={user} />);
    }
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
        ListHeaderComponent={
          <>
            {/* Top nav */}
            <View style={styles.topNav}>
              <Text style={styles.topNavTitle}>Profile</Text>
              <TouchableOpacity style={styles.settingsBtn} onPress={confirmSignOut}>
                <Text style={styles.settingsIcon}>⚙️</Text>
              </TouchableOpacity>
            </View>

            {/* Profile header */}
            {profile && (
              <ProfileHeader
                profile={profile}
                isOwnProfile={true}
                isFollowing={false}
                onFollowToggle={() => {}}
              />
            )}

            {/* Tab bar */}
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
                  {i === 1 && profile && (
                    <Text style={styles.tabCount}> {profile.following}</Text>
                  )}
                  {i === 2 && profile && (
                    <Text style={styles.tabCount}> {profile.followers}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Tab content */}
            <View style={styles.tabContent}>
              {renderContent()}
            </View>
          </>
        }
        showsVerticalScrollIndicator={false}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  settingsBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsIcon: { fontSize: 16 },
  // Tab bar
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
  tabActive: {
    borderBottomColor: colors.green,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey,
  },
  tabTextActive: {
    color: colors.green,
  },
  tabCount: {
    fontSize: 12,
    color: colors.grey,
  },
  tabContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  // User row (following/followers)
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '66',
    gap: spacing.sm,
  },
  userRowAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  userRowAvatarText: { fontSize: 22 },
  userRowInfo: { flex: 1 },
  userRowName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.offWhite,
  },
  userRowHandle: {
    fontSize: 11,
    color: colors.grey,
    marginTop: 2,
  },
  smallFollowBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.offWhite,
  },
  smallFollowBtnActive: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallFollowBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.background,
  },
  smallFollowBtnTextActive: {
    color: colors.grey,
  },
  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
    gap: spacing.md,
  },
  emptyIcon: { fontSize: 40 },
  emptyText: {
    fontSize: 15,
    color: colors.grey,
  },
});
