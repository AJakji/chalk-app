import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import StreakBadge from './StreakBadge';
import Last10Bar from './Last10Bar';
import ReactionBar from './ReactionBar';
import TailFadeButtons from './TailFadeButtons';

const LEAGUE_COLORS = {
  NBA: '#C9082A',
  NFL: '#013369',
  MLB: '#002D72',
  NHL: '#000000',
  Soccer: '#00A859',
};

export default function PickPost({ post, user }) {
  const [reactions, setReactions] = useState(post.reactions);
  const [userReaction, setUserReaction] = useState(post.userReaction);

  const handleReact = (key) => {
    const isToggleOff = userReaction === key;
    setReactions((prev) => {
      const next = { ...prev };
      if (userReaction && !isToggleOff) {
        next[userReaction] = Math.max(0, (next[userReaction] ?? 0) - 1);
      }
      next[key] = Math.max(0, (next[key] ?? 0) + (isToggleOff ? -1 : 1));
      return next;
    });
    setUserReaction(isToggleOff ? null : key);
  };

  const leagueColor = LEAGUE_COLORS[post.league] || colors.grey;
  const isWin = post.result === 'win';
  const isLoss = post.result === 'loss';

  return (
    <View style={styles.card}>
      {/* User row */}
      <View style={styles.userRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user.avatar}</Text>
        </View>
        <View style={styles.userInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.displayName}>{user.displayName}</Text>
            <StreakBadge streak={user.streak} type={user.streakType} />
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.username}>@{user.username}</Text>
            <Text style={styles.dot}>·</Text>
            <Last10Bar record={user.record} />
            <Text style={styles.dot}>·</Text>
            <Text style={styles.timeAgo}>{post.createdAt}</Text>
          </View>
        </View>
      </View>

      {/* Pick card */}
      <View style={[styles.pickCard, isWin && styles.pickCardWin, isLoss && styles.pickCardLoss]}>
        <View style={styles.pickCardTop}>
          <View style={[styles.leagueBadge, { backgroundColor: leagueColor }]}>
            <Text style={styles.leagueText}>{post.league}</Text>
          </View>
          <Text style={styles.pickType}>{post.pickType}</Text>
          <Text style={styles.gameTime}>{post.gameTime}</Text>
        </View>
        <Text style={styles.gameText}>{post.game}</Text>
        <View style={styles.pickValueRow}>
          <Text style={styles.pickValue}>{post.pick}</Text>
          <View style={styles.oddsChip}>
            <Text style={styles.oddsText}>{post.odds}</Text>
          </View>
          {isWin && (
            <View style={[styles.resultBadge, styles.resultWin]}>
              <Text style={styles.resultText}>WIN ✓</Text>
            </View>
          )}
          {isLoss && (
            <View style={[styles.resultBadge, styles.resultLoss]}>
              <Text style={styles.resultText}>LOSS</Text>
            </View>
          )}
        </View>
        {post.finalScore && (
          <Text style={styles.finalScore}>{post.finalScore}</Text>
        )}
        {/* Confidence bar */}
        <View style={styles.confRow}>
          <Text style={styles.confLabel}>Confidence</Text>
          <Text style={[styles.confPct, { color: post.confidence >= 80 ? colors.green : post.confidence >= 65 ? '#FFB800' : colors.red }]}>
            {post.confidence}%
          </Text>
        </View>
        <View style={styles.confTrack}>
          <View style={[
            styles.confFill,
            {
              width: `${post.confidence}%`,
              backgroundColor: post.confidence >= 80 ? colors.green : post.confidence >= 65 ? '#FFB800' : colors.red,
            },
          ]} />
        </View>
      </View>

      {/* Caption */}
      {post.caption ? (
        <Text style={styles.caption}>{post.caption}</Text>
      ) : null}

      {/* Tail / Fade */}
      <TailFadeButtons
        tails={post.tails}
        fades={post.fades}
        affiliateLinks={post.affiliateLinks}
        result={post.result}
      />

      {/* Reactions */}
      <View style={styles.reactionsRow}>
        <ReactionBar
          reactions={reactions}
          userReaction={userReaction}
          onReact={handleReact}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
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
  userInfo: { flex: 1 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  displayName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.offWhite,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
    flexWrap: 'wrap',
  },
  username: {
    fontSize: 11,
    color: colors.grey,
  },
  dot: {
    fontSize: 10,
    color: colors.grey,
  },
  timeAgo: {
    fontSize: 11,
    color: colors.grey,
  },
  // Pick card
  pickCard: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 5,
  },
  pickCardWin: {
    borderColor: colors.green + '55',
    backgroundColor: colors.green + '08',
  },
  pickCardLoss: {
    borderColor: colors.red + '44',
    backgroundColor: colors.red + '08',
  },
  pickCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  leagueBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  leagueText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.4,
  },
  pickType: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    flex: 1,
  },
  gameTime: {
    fontSize: 10,
    color: colors.grey,
  },
  gameText: {
    fontSize: 12,
    color: colors.grey,
  },
  pickValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pickValue: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.offWhite,
    flex: 1,
  },
  oddsChip: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  oddsText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.greyLight,
  },
  resultBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  resultWin: { backgroundColor: colors.green },
  resultLoss: { backgroundColor: colors.red },
  resultText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.4,
  },
  finalScore: {
    fontSize: 11,
    color: colors.grey,
    fontStyle: 'italic',
  },
  confRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  confLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  confPct: {
    fontSize: 10,
    fontWeight: '700',
  },
  confTrack: {
    height: 3,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  confFill: {
    height: '100%',
    borderRadius: radius.full,
  },
  caption: {
    fontSize: 14,
    color: colors.offWhite,
    lineHeight: 20,
  },
  reactionsRow: {
    marginTop: 2,
  },
});
