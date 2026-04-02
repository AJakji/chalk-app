import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, radius } from '../theme';
import { askChalky } from '../services/api';
import ChalkyMenuButton from '../components/ChalkyMenuButton';
import ChalkyLogo from '../components/ChalkyLogo';
import ReportModal from '../components/ReportModal';
import { onResearchMessage } from '../researchBridge';
import { Ionicons } from '@expo/vector-icons';
import {
  FormattedText,
  ComponentRenderer,
  ResearchVisual,
} from '../components/research/ResearchComponents';
import ChalkyFace from '../components/ChalkyFace';
import ChalkyMascot from '../components/ChalkyMascot';

const DAILY_LIMIT = 5;
const RL_COUNT_KEY = 'chalk_rl_count';
const RL_DATE_KEY = 'chalk_rl_date';

// ── Daily limit helpers ───────────────────────────────────────────────────────

async function loadDailyCount() {
  try {
    const [count, date] = await Promise.all([
      AsyncStorage.getItem(RL_COUNT_KEY),
      AsyncStorage.getItem(RL_DATE_KEY),
    ]);
    const today = new Date().toDateString();
    if (date !== today) return 0;
    return parseInt(count || '0', 10);
  } catch {
    return 0;
  }
}

async function saveDailyCount(n) {
  try {
    await Promise.all([
      AsyncStorage.setItem(RL_COUNT_KEY, String(n)),
      AsyncStorage.setItem(RL_DATE_KEY, new Date().toDateString()),
    ]);
  } catch {}
}

// ── Backtick / JSON leak sanitizer ───────────────────────────────────────────

function sanitizeMessage(text) {
  if (!text || typeof text !== 'string') return text;
  text = text.replace(/```json[\s\S]*?```/gi, '');
  text = text.replace(/```[\s\S]*?```/gi, '');
  text = text.replace(/`json[\s\S]*?`/gi, '');
  text = text.replace(/\n*\{[\s]*"response"[\s\S]*/g, '');
  return text.trim();
}

// ── Message bubble ────────────────────────────────────────────────────────────

function ChatBubble({ message, onSend, onReport }) {
  const isUser = message.role === 'user';
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(4)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.bubbleRow,
        isUser && styles.bubbleRowUser,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
      ]}
    >
      {!isUser && (
        <ChalkyFace size={56} style={styles.chalkyAvatar} />
      )}
      <View style={styles.bubbleColumn}>
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
          {message.isLimitMsg ? (
            <>
              <Text style={styles.bubbleText}>{message.content}</Text>
              <TouchableOpacity style={styles.upgradeBtn} activeOpacity={0.8}>
                <Text style={styles.upgradeBtnText}>Upgrade to Chalk Pro →</Text>
              </TouchableOpacity>
            </>
          ) : (
            <FormattedText text={sanitizeMessage(message.content || '')} style={styles.bubbleText} />
          )}
        </View>

        {/* Rich visual (only when not streaming) */}
        {!message.isStreaming && message.visualData && (
          <ResearchVisual visualData={message.visualData} delay={200} />
        )}

        {/* Legacy inline components (only when not streaming) */}
        {!message.isStreaming &&
          message.components?.map((comp, i) => (
            <ComponentRenderer key={i} component={comp} index={i} />
          ))}

        {/* Report button — only on completed assistant messages */}
        {!isUser && !message.isStreaming && !message.isLimitMsg && onReport && (
          <TouchableOpacity style={styles.reportBtn} onPress={() => onReport(message)} activeOpacity={0.7}>
            <Ionicons name="flag-outline" size={11} color="#3a3a3a" /><Text style={styles.reportBtnText}>  Report a problem</Text>
          </TouchableOpacity>
        )}

      </View>
    </Animated.View>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (anim, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.delay(600),
        ])
      ).start();
    pulse(dot1, 0);
    pulse(dot2, 200);
    pulse(dot3, 400);
  }, []);

  return (
    <View style={styles.bubbleRow}>
      <ChalkyFace size={28} style={styles.chalkyAvatar} />
      <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
        {[dot1, dot2, dot3].map((anim, i) => (
          <Animated.View key={i} style={[styles.typingDot, { opacity: anim }]} />
        ))}
      </View>
    </View>
  );
}

// ── Daily counter strip ───────────────────────────────────────────────────────

function QuestionCounter({ remaining }) {
  if (remaining >= DAILY_LIMIT) return null;
  const color = remaining > 0 ? '#F5A623' : colors.red;
  return (
    <View style={styles.counterStrip}>
      <View style={styles.counterDots}>
        {Array.from({ length: DAILY_LIMIT }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.counterDot,
              { backgroundColor: i < remaining ? colors.green : colors.border },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.counterText, { color }]}>
        {remaining > 0
          ? `${remaining} of ${DAILY_LIMIT} questions remaining today`
          : 'Daily limit reached · Go Pro for unlimited'}
      </Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ResearchScreen() {
  const [messages, setMessages] = useState([]);
  const [streamingMsg, setStreamingMsg] = useState(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [dailyCount, setDailyCount] = useState(0);
  const [limitLoaded, setLimitLoaded] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportingMessage, setReportingMessage] = useState(null);
  const scrollRef = useRef(null);
  const streamTimerRef = useRef(null);
  const conversationHistory = useRef([]);

  const remaining = Math.max(0, DAILY_LIMIT - dailyCount);

  // Listen for messages fired from player profiles / other screens
  useEffect(() => {
    return onResearchMessage((msg) => {
      if (msg) send(msg);
    });
  }, [send]);

  const openReportModal = useCallback((message) => {
    setReportingMessage(message);
    setReportModalVisible(true);
  }, []);

  useEffect(() => {
    loadDailyCount().then((count) => {
      setDailyCount(count);
      setLimitLoaded(true);
    });
    return () => {
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const addMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, { ...msg, id: String(Date.now()) + String(Math.random()) }]);
    scrollToBottom();
  }, [scrollToBottom]);

  const startStreaming = useCallback((fullText, components, hasPick, visualData, userQuestion) => {
    const words = fullText.split(' ').filter(Boolean);
    if (words.length === 0) return;
    setIsStreaming(true);
    setStreamingMsg({ text: words[0], components, hasPick });
    let i = 1;
    streamTimerRef.current = setInterval(() => {
      if (i < words.length) {
        setStreamingMsg((prev) =>
          prev ? { ...prev, text: prev.text + ' ' + words[i] } : null
        );
        i++;
        scrollToBottom();
      } else {
        clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
        // Commit to messages — reveal visualData after text finishes
        setTimeout(() => {
          addMessage({
            role: 'assistant',
            content: fullText,
            components,
            hasPick,
            visualData: visualData || null,
            userQuestion: userQuestion || '',
            isStreaming: false,
          });
          setStreamingMsg(null);
          setIsStreaming(false);
        }, 200);
      }
    }, 35);
  }, [addMessage, scrollToBottom]);

  const send = useCallback(async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading || isStreaming) return;
    setInput('');

    // Hit daily limit — show Chalky's upgrade message
    if (remaining <= 0) {
      addMessage({ role: 'user', content: msg });
      setTimeout(() => {
        addMessage({
          role: 'assistant',
          content:
            `You have used your ${DAILY_LIMIT} free research questions today. Upgrade to Chalk Pro for unlimited access to Chalky.`,
          isLimitMsg: true,
          components: [],
          hasPick: false,
        });
      }, 400);
      return;
    }

    addMessage({ role: 'user', content: msg });

    const newCount = dailyCount + 1;
    setDailyCount(newCount);
    saveDailyCount(newCount);

    setLoading(true);

    try {
      const history = conversationHistory.current;
      const data = await askChalky(msg, history);
      // Update conversation history for context continuity
      conversationHistory.current = [
        ...history,
        { role: 'user', content: msg },
        { role: 'assistant', content: data.response },
      ].slice(-20); // keep last 10 exchanges

      setLoading(false);
      startStreaming(
        data.response,
        data.components || [],
        data.hasPick || false,
        data.visualData || null,
        msg,
      );
    } catch {
      setLoading(false);
      addMessage({
        role: 'assistant',
        content: "I ran into a connection issue. Check your network and try again.",
        components: [],
        hasPick: false,
      });
    }
  }, [input, loading, isStreaming, remaining, dailyCount, addMessage, startStreaming]);

  const isEmpty = messages.length === 0 && !loading && !isStreaming;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <ChalkyMenuButton />
        <View style={styles.headerCenter}>
          <ChalkyLogo size={26} />
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Chalky is live</Text>
        </View>
      </View>

      {/* Question counter */}
      {limitLoaded && <QuestionCounter remaining={remaining} />}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {isEmpty ? (
          /* Empty state */
          <ScrollView
            contentContainerStyle={styles.emptyState}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <ChalkyMascot size={180} style={styles.emptyAvatar} />
            <Text style={styles.emptyTitle}>Research</Text>
            <Text style={styles.emptySubtitle}>
              Stats, trends, matchups, and betting lines. Ask about any player, team, or game.
            </Text>
          </ScrollView>
        ) : (
          /* Messages list */
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.chatList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: false })
            }
          >
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} onSend={send} onReport={openReportModal} />
            ))}

            {/* Streaming bubble */}
            {isStreaming && streamingMsg && (
              <ChatBubble
                message={{
                  id: 'streaming',
                  role: 'assistant',
                  content: streamingMsg.text,
                  isStreaming: true,
                  components: [],
                }}
              />
            )}

            {/* Typing indicator */}
            {loading && !isStreaming && <TypingIndicator />}
          </ScrollView>
        )}

        {/* Input bar */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask about any player, team, stat, or matchup..."
            placeholderTextColor={colors.grey}
            returnKeyType="send"
            onSubmitEditing={() => send()}
            multiline={false}
            editable={!loading && !isStreaming}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!input.trim() || loading || isStreaming) && styles.sendBtnDisabled,
            ]}
            onPress={() => send()}
            disabled={!input.trim() || loading || isStreaming}
            activeOpacity={0.8}
          >
            <Ionicons
              name="arrow-up"
              size={18}
              color={(!input.trim() || loading || isStreaming) ? colors.grey : colors.background}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <ReportModal
        visible={reportModalVisible}
        onClose={() => {
          setReportModalVisible(false);
          setReportingMessage(null);
        }}
        question={reportingMessage?.userQuestion || ''}
        chalkyResponse={reportingMessage?.content || ''}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.green + '18',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.green + '33',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.green,
  },
  liveText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.green,
  },

  // Counter strip
  counterStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  counterDots: {
    flexDirection: 'row',
    gap: 4,
  },
  counterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  counterText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Empty state
  emptyState: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyAvatar: {
    width: 80,
    height: 80,
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.offWhite,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.grey,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  // Chat
  chatList: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  bubbleRowUser: {
    flexDirection: 'row-reverse',
  },
  bubbleColumn: {
    flex: 1,
    maxWidth: '82%',
  },
  chalkyAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    flexShrink: 0,
    marginTop: 2,
  },
  bubble: {
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  bubbleAssistant: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleUser: {
    backgroundColor: colors.green + '22',
    borderWidth: 1,
    borderColor: colors.green + '44',
    alignSelf: 'flex-end',
    maxWidth: '100%',
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 23,
    color: colors.offWhite,
  },

  // Upgrade button inside limit message
  upgradeBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.green,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  upgradeBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.background,
  },

  // Typing indicator
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.grey,
  },

  // Input bar
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.offWhite,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.background,
  },
  sendBtnTextDisabled: {
    color: colors.grey,
  },

  // Report button
  reportBtn: {
    marginTop: 6,
    marginLeft: 4,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reportBtnText: {
    fontSize: 11,
    color: '#3a3a3a',
    letterSpacing: 0.3,
  },

});
