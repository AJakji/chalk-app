import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { colors, spacing, radius } from '../theme';
import PickPost from '../components/feed/PickPost';
import SuggestedPickers from '../components/feed/SuggestedPickers';
import { mockPosts, mockUsers, suggestedPickers } from '../data/mockFeed';

const TABS = ['For You', 'Top'];

// Map userId → user object
const userMap = Object.fromEntries(mockUsers.map((u) => [u.id, u]));

// "Top" tab sorts by total tails
const topPosts = [...mockPosts].sort((a, b) => b.tails - a.tails);

export default function FeedScreen() {
  const [activeTab, setActiveTab] = useState(0);
  const [showSuggested, setShowSuggested] = useState(true);

  const posts = activeTab === 0 ? mockPosts : topPosts;

  const renderHeader = () => (
    <>
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
          </TouchableOpacity>
        ))}
      </View>

      {/* Suggested pickers — shown once until dismissed */}
      {showSuggested && activeTab === 0 && (
        <View>
          <SuggestedPickers users={suggestedPickers} />
          <TouchableOpacity
            style={styles.dismissSuggested}
            onPress={() => setShowSuggested(false)}
          >
            <Text style={styles.dismissText}>Hide suggestions</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Section label */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>
          {activeTab === 0 ? 'Latest Picks' : 'Most Tailed Today'}
        </Text>
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Top header */}
      <View style={styles.header}>
        <Text style={styles.title}>Feed</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.postBtn}>
            <Text style={styles.postBtnText}>+ Post Pick</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id + activeTab}
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) => (
          <PickPost post={item} user={userMap[item.userId]} />
        )}
        contentContainerStyle={styles.listContent}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.offWhite,
    letterSpacing: -0.5,
  },
  headerRight: {},
  postBtn: {
    backgroundColor: colors.green,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
  },
  postBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.background,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  tab: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: colors.green,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.grey,
  },
  tabTextActive: {
    color: colors.green,
  },
  dismissSuggested: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  dismissText: {
    fontSize: 12,
    color: colors.grey,
    textDecorationLine: 'underline',
  },
  sectionHeader: {
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
});
