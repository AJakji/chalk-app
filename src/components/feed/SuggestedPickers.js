import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import StreakBadge from './StreakBadge';
import Last10Bar from './Last10Bar';
import ChalkyAvatar from '../ChalkyAvatar';

export default function SuggestedPickers({ users }) {
  const [followed, setFollowed] = useState({});

  const toggle = (id) =>
    setFollowed((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Who to Follow</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {users.map((user) => (
          <View key={user.id} style={[styles.card, user.isChalky && styles.chalkyCard]}>
            {/* Avatar + streak */}
            <View style={styles.avatarRow}>
              {user.isChalky ? (
                <ChalkyAvatar size={40} showGlow />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{user.avatar}</Text>
                </View>
              )}
              <StreakBadge streak={user.streak} type={user.streakType} />
            </View>

            {/* Name */}
            <View style={styles.nameRow}>
              <Text style={styles.displayName} numberOfLines={1}>
                {user.displayName}
              </Text>
              {user.isChalky && (
                <View style={styles.chalkyBadge}>
                  <Text style={styles.chalkyBadgeText}>AI</Text>
                </View>
              )}
            </View>
            <Text style={styles.username}>@{user.username}</Text>

            {/* Last 10 */}
            <View style={styles.last10Row}>
              <Text style={styles.last10Label}>Last 10</Text>
              <Last10Bar record={user.record} />
            </View>

            {/* Followers */}
            <Text style={styles.followers}>
              {user.followers.toLocaleString()} followers
            </Text>

            {/* Follow button */}
            <TouchableOpacity
              style={[styles.followBtn, followed[user.id] && styles.followBtnActive]}
              onPress={() => toggle(user.id)}
              activeOpacity={0.8}
            >
              <Text style={[styles.followBtnText, followed[user.id] && styles.followBtnTextActive]}>
                {followed[user.id] ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  heading: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  card: {
    width: 160,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarText: { fontSize: 20 },
  displayName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.offWhite,
  },
  username: {
    fontSize: 11,
    color: colors.grey,
  },
  last10Row: {
    gap: 4,
  },
  last10Label: {
    fontSize: 10,
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  followers: {
    fontSize: 11,
    color: colors.grey,
  },
  followBtn: {
    marginTop: 4,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.offWhite,
    alignItems: 'center',
  },
  followBtnActive: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  followBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.background,
  },
  followBtnTextActive: {
    color: colors.grey,
  },
  chalkyCard: {
    borderColor: colors.green + '44',
    borderWidth: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chalkyBadge: {
    backgroundColor: colors.green + '22',
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.green + '55',
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  chalkyBadgeText: {
    fontSize: 8,
    fontWeight: '700',
    color: colors.green,
    letterSpacing: 1,
  },
});
