import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, radius } from '../theme';
import PickPost from '../components/feed/PickPost';
import SuggestedPickers from '../components/feed/SuggestedPickers';
import PostPickModal from '../components/feed/PostPickModal';
import useFeed from '../hooks/useFeed';
import { suggestedPickers } from '../data/mockFeed';

const TABS = ['For You', 'Top'];

export default function FeedScreen() {
  const [activeTab, setActiveTab] = useState(0);
  const [showSuggested, setShowSuggested] = useState(true);
  const [showPostModal, setShowPostModal] = useState(false);

  const { forYouPosts, topPosts, loading, load, react, tail, fade } = useFeed();

  // Load on mount
  useEffect(() => { load(); }, [load]);

  const posts = activeTab === 0 ? forYouPosts : topPosts;

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

      {/* Suggested pickers */}
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
        <TouchableOpacity style={styles.postBtn} onPress={() => setShowPostModal(true)}>
          <Text style={styles.postBtnText}>+ Post Pick</Text>
        </TouchableOpacity>
      </View>

      {/* Initial loading spinner */}
      {loading && posts.length === 0 && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.green} />
          <Text style={styles.loadingText}>Loading feed...</Text>
        </View>
      )}

      {!loading || posts.length > 0 ? (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id + activeTab}
          ListHeaderComponent={renderHeader}
          onRefresh={load}
          refreshing={loading}
          renderItem={({ item }) => (
            <PickPost
              post={item}
              user={item.user}
              onReact={react}
              onTail={tail}
              onFade={fade}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyText}>No picks posted yet</Text>
            </View>
          }
        />
      ) : null}

      <PostPickModal
        visible={showPostModal}
        onClose={() => setShowPostModal(false)}
        onPosted={load}
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
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: 80,
  },
  loadingText: {
    fontSize: 14,
    color: colors.grey,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    gap: spacing.md,
  },
  emptyIcon: { fontSize: 40 },
  emptyText: {
    fontSize: 15,
    color: colors.grey,
  },
});
