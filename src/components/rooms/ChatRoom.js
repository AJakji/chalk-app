import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Modal,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { simulatedMessages } from '../../data/mockRooms';
import TeamLogo from '../TeamLogo';
import { useTeamLogos } from '../../context/TeamLogosContext';

const LEAGUE_COLORS = {
  NBA: '#C9082A',
  MLB: '#002D72',
  NHL: '#000000',
  Soccer: '#00A859',
};

function ChatBubble({ message }) {
  const { isOwn, isChalk, avatar, username, text, timestamp } = message;

  if (isChalk) {
    return (
      <View style={styles.chalkBubble}>
        <Text style={styles.chalkBubbleText}>{text}</Text>
      </View>
    );
  }

  if (isOwn) {
    return (
      <View style={styles.ownRow}>
        <View style={styles.ownBubble}>
          <Text style={styles.ownText}>{text}</Text>
        </View>
        <Text style={styles.bubbleTime}>{timestamp}</Text>
      </View>
    );
  }

  return (
    <View style={styles.otherRow}>
      <View style={styles.avatarSmall}>
        <Text style={styles.avatarSmallText}>{avatar}</Text>
      </View>
      <View style={styles.otherContent}>
        <Text style={styles.otherUsername}>{username}</Text>
        <View style={styles.otherBubble}>
          <Text style={styles.otherText}>{text}</Text>
        </View>
        <Text style={styles.bubbleTime}>{timestamp}</Text>
      </View>
    </View>
  );
}

export default function ChatRoom({ room, visible, onClose }) {
  const [messages, setMessages] = useState(room?.messages ?? []);
  const [input, setInput] = useState('');
  const [activeUsers, setActiveUsers] = useState(room?.activeUsers ?? 0);
  const listRef = useRef(null);
  const simIdxRef = useRef(0);

  // Reset messages when room changes (e.g. user opens a different room)
  useEffect(() => {
    if (room) {
      setMessages(room.messages ?? []);
      setActiveUsers(room.activeUsers ?? 0);
      simIdxRef.current = 0;
    }
  }, [room?.id]);

  // Simulate incoming real-time messages for live rooms
  useEffect(() => {
    if (!room || room.status !== 'live') return;
    const pool = simulatedMessages[room.id] ?? [];
    if (pool.length === 0) return;

    const interval = setInterval(() => {
      const msg = pool[simIdxRef.current % pool.length];
      simIdxRef.current += 1;
      const newMsg = {
        ...msg,
        id: `sim_${Date.now()}`,
        timestamp: 'just now',
        isOwn: false,
      };
      setMessages((prev) => [...prev, newMsg]);
      // Small fluctuation in active users
      setActiveUsers((prev) => prev + Math.floor(Math.random() * 5) - 2);
    }, 4000);

    return () => clearInterval(interval);
  }, [room]);

  // Scroll to bottom when new message arrives
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const newMsg = {
      id: `own_${Date.now()}`,
      userId: 'u_me',
      username: 'you',
      avatar: '😎',
      text,
      timestamp: 'just now',
      isOwn: true,
    };
    setMessages((prev) => [...prev, newMsg]);
    setInput('');
  }, [input]);

  if (!room) return null;

  const { league, title, status, clock, awayTeam, homeTeam, chalkPick } = room;
  const getLogo = useTeamLogos();
  const isLive = status === 'live';
  const leagueColor = LEAGUE_COLORS[league] || colors.grey;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.leagueDot, { backgroundColor: leagueColor }]} />
            <View>
              <View style={styles.titleRow}>
                <Text style={styles.roomTitle}>{title}</Text>
                {isLive && (
                  <View style={styles.livePill}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>LIVE</Text>
                  </View>
                )}
              </View>
              <Text style={styles.headerSub}>
                {isLive ? `${clock}  ·  ` : ''}{activeUsers >= 1000 ? `${(activeUsers / 1000).toFixed(1)}k` : activeUsers} watching
              </Text>
            </View>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Scoreboard strip for live games */}
        {isLive && (
          <View style={styles.scoreStrip}>
            <TeamLogo uri={getLogo(awayTeam.abbr, league)} abbr={awayTeam.abbr} size={32} />
            <Text style={styles.scoreStripTeam}>{awayTeam.abbr}</Text>
            <Text style={styles.scoreStripScore}>{awayTeam.score}</Text>
            <Text style={styles.scoreStripClock}>{clock}</Text>
            <Text style={styles.scoreStripScore}>{homeTeam.score}</Text>
            <Text style={styles.scoreStripTeam}>{homeTeam.abbr}</Text>
            <TeamLogo uri={getLogo(homeTeam.abbr, league)} abbr={homeTeam.abbr} size={32} />
          </View>
        )}

        {/* Chalky pick strip */}
        {chalkPick && (
          <View style={styles.chalkStrip}>
            <Text style={styles.chalkStripText}>🎯 Chalky: {chalkPick}</Text>
          </View>
        )}

        {/* Messages */}
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ChatBubble message={item} />}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: false })
            }
          />

          {/* Input bar */}
          <View style={styles.inputBar}>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder="Say something..."
                placeholderTextColor={colors.grey}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={sendMessage}
                returnKeyType="send"
                multiline={false}
                maxLength={280}
              />
            </View>
            <TouchableOpacity
              style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
              onPress={sendMessage}
              disabled={!input.trim()}
              activeOpacity={0.8}
            >
              <Text style={styles.sendBtnText}>↑</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  leagueDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  roomTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.offWhite,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.red + '22',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.red + '55',
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.red,
  },
  liveText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.red,
    letterSpacing: 0.5,
  },
  headerSub: {
    fontSize: 11,
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
  },
  scoreStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  scoreStripTeam: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.offWhite,
    width: 44,
    textAlign: 'center',
  },
  scoreStripScore: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.offWhite,
  },
  scoreStripClock: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.red,
    minWidth: 60,
    textAlign: 'center',
  },
  chalkStrip: {
    backgroundColor: colors.green + '14',
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.green + '33',
  },
  chalkStripText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.green,
    textAlign: 'center',
  },
  // Messages
  messageList: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  // Chalk system message
  chalkBubble: {
    backgroundColor: colors.green + '18',
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.green + '44',
    marginVertical: spacing.xs,
  },
  chalkBubbleText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.green,
    textAlign: 'center',
  },
  // Own messages (right side)
  ownRow: {
    alignItems: 'flex-end',
    marginVertical: 3,
  },
  ownBubble: {
    backgroundColor: colors.green,
    borderRadius: radius.lg,
    borderBottomRightRadius: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '75%',
  },
  ownText: {
    fontSize: 14,
    color: colors.background,
    fontWeight: '500',
  },
  // Other messages (left side)
  otherRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginVertical: 3,
  },
  avatarSmall: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 0,
  },
  avatarSmallText: { fontSize: 14 },
  otherContent: {
    maxWidth: '75%',
  },
  otherUsername: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.grey,
    marginBottom: 3,
  },
  otherBubble: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderBottomLeftRadius: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  otherText: {
    fontSize: 14,
    color: colors.offWhite,
  },
  bubbleTime: {
    fontSize: 10,
    color: colors.grey,
    marginTop: 3,
  },
  // Input
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
  },
  input: {
    fontSize: 14,
    color: colors.offWhite,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: colors.border,
  },
  sendBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.background,
    lineHeight: 22,
  },
});
