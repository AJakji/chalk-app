import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import StreakBadge from '../feed/StreakBadge';

// Full-width last-10 visualiser — larger squares than the mini feed version
function Last10Visualiser({ record }) {
  const picks = record?.last10 ?? [];
  const wins = picks.filter((p) => p === 1).length;
  const losses = picks.filter((p) => p === 0).length;

  return (
    <View style={styles.last10Container}>
      <View style={styles.last10Header}>
        <Text style={styles.last10Title}>Last 10 Picks</Text>
        <View style={styles.last10Legend}>
          <View style={[styles.legendDot, { backgroundColor: colors.green }]} />
          <Text style={styles.legendText}>{wins}W</Text>
          <View style={[styles.legendDot, { backgroundColor: colors.red }]} />
          <Text style={styles.legendText}>{losses}L</Text>
        </View>
      </View>
      <View style={styles.last10Row}>
        {picks.map((r, i) => (
          <View
            key={i}
            style={[
              styles.last10Square,
              r === 1 && styles.squareWin,
              r === 0 && styles.squareLoss,
              r === null && styles.squarePending,
            ]}
          >
            <Text style={styles.squareLabel}>
              {r === 1 ? 'W' : r === 0 ? 'L' : '—'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function ProfileHeader({ profile, isOwnProfile, isFollowing, onFollowToggle, imageUrl, initials }) {
  const { avatar, displayName, username, bio, streak, streakType, followers, following, record } = profile;

  return (
    <View style={styles.container}>
      {/* Avatar + follow button row */}
      <View style={styles.avatarRow}>
        <View style={styles.avatarWrap}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.avatarImage} />
          ) : initials ? (
            <Text style={styles.avatarInitials}>{initials}</Text>
          ) : (
            <Text style={styles.avatarText}>{avatar}</Text>
          )}
        </View>
        {!isOwnProfile && (
          <TouchableOpacity
            style={[styles.followBtn, isFollowing && styles.followBtnActive]}
            onPress={onFollowToggle}
            activeOpacity={0.8}
          >
            <Text style={[styles.followBtnText, isFollowing && styles.followBtnTextActive]}>
              {isFollowing ? 'Following' : 'Follow'}
            </Text>
          </TouchableOpacity>
        )}
        {isOwnProfile && (
          <TouchableOpacity style={styles.editBtn} activeOpacity={0.8}>
            <Text style={styles.editBtnText}>Edit Profile</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Name + streak — or setup prompt if profile not configured */}
      {displayName ? (
        <>
          <View style={styles.nameRow}>
            <Text style={styles.displayName}>{displayName}</Text>
            <StreakBadge streak={streak} type={streakType} />
          </View>
          <Text style={styles.username}>@{username}</Text>
          {bio ? <Text style={styles.bio}>{bio}</Text> : null}
        </>
      ) : (
        <View style={styles.setupPrompt}>
          <Text style={styles.setupTitle}>Set up your profile</Text>
          <Text style={styles.setupSub}>Add your name and handle so others can find and follow you.</Text>
          <View style={styles.setupCta}>
            <Text style={styles.setupCtaText}>Complete profile →</Text>
          </View>
        </View>
      )}

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{followers.toLocaleString()}</Text>
          <Text style={styles.statLabel}>Followers</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{following.toLocaleString()}</Text>
          <Text style={styles.statLabel}>Following</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statNum, { color: streakType === 'hot' ? colors.green : colors.red }]}>
            {streak}
          </Text>
          <Text style={styles.statLabel}>
            {streakType === 'hot' ? '🔥 Streak' : '🧊 Streak'}
          </Text>
        </View>
      </View>

      {/* Last 10 visualiser */}
      <Last10Visualiser record={record} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatarWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  avatarImage: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
  },
  avatarInitials: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.offWhite,
  },
  avatarText: { fontSize: 36 },
  followBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.full,
    backgroundColor: colors.offWhite,
  },
  followBtnActive: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  followBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.background,
  },
  followBtnTextActive: {
    color: colors.grey,
  },
  editBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.offWhite,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  displayName: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.offWhite,
  },
  username: {
    fontSize: 14,
    color: colors.grey,
    marginTop: -4,
  },
  bio: {
    fontSize: 14,
    color: colors.greyLight,
    lineHeight: 20,
  },
  setupPrompt: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.green + '44',
    gap: 4,
  },
  setupTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.offWhite,
    letterSpacing: -0.3,
  },
  setupSub: {
    fontSize: 13,
    color: colors.grey,
    lineHeight: 18,
  },
  setupCta: {
    marginTop: 6,
  },
  setupCtaText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.green,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNum: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.offWhite,
  },
  statLabel: {
    fontSize: 11,
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  // Last 10
  last10Container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  last10Header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  last10Title: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  last10Legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.grey,
    marginRight: 4,
  },
  last10Row: {
    flexDirection: 'row',
    gap: 6,
  },
  last10Square: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 44,
  },
  squareWin: { backgroundColor: colors.green },
  squareLoss: { backgroundColor: colors.red },
  squarePending: { backgroundColor: colors.border },
  squareLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.background,
  },
});
