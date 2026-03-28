import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { colors, spacing, radius } from '../../theme';
import { createPost } from '../../services/api';

const LEAGUES = ['NBA', 'MLB', 'NHL', 'Soccer'];

export default function PostPickModal({ visible, onClose, onPosted }) {
  const { getToken } = useAuth();
  const [league, setLeague] = useState('NBA');
  const [pick, setPick] = useState('');
  const [game, setGame] = useState('');
  const [odds, setOdds] = useState('');
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setPick('');
    setGame('');
    setOdds('');
    setCaption('');
    setLeague('NBA');
  };

  const handlePost = async () => {
    if (!pick.trim() || !game.trim()) {
      Alert.alert('Missing info', 'Pick and game are required.');
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      await createPost(token, { league, pick: pick.trim(), game: game.trim(), odds: odds.trim(), caption: caption.trim() });
      reset();
      onPosted?.();
      onClose();
    } catch (err) {
      Alert.alert('Could not post', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Post a Pick</Text>
          <TouchableOpacity
            style={[styles.postBtn, submitting && styles.postBtnDisabled]}
            onPress={handlePost}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.background} />
            ) : (
              <Text style={styles.postBtnText}>Post</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
          {/* League selector */}
          <Text style={styles.label}>League</Text>
          <View style={styles.leagueRow}>
            {LEAGUES.map((l) => (
              <TouchableOpacity
                key={l}
                style={[styles.leagueChip, league === l && styles.leagueChipActive]}
                onPress={() => setLeague(l)}
              >
                <Text style={[styles.leagueText, league === l && styles.leagueTextActive]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Pick */}
          <Text style={styles.label}>Your Pick *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Celtics -4.5"
            placeholderTextColor={colors.grey}
            value={pick}
            onChangeText={setPick}
          />

          {/* Game */}
          <Text style={styles.label}>Game *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. GSW @ BOS"
            placeholderTextColor={colors.grey}
            value={game}
            onChangeText={setGame}
          />

          {/* Odds */}
          <Text style={styles.label}>Odds (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. -110"
            placeholderTextColor={colors.grey}
            value={odds}
            onChangeText={setOdds}
          />

          {/* Caption */}
          <Text style={styles.label}>Your reasoning (optional)</Text>
          <TextInput
            style={[styles.input, styles.captionInput]}
            placeholder="Why do you like this pick?"
            placeholderTextColor={colors.grey}
            value={caption}
            onChangeText={setCaption}
            multiline
            numberOfLines={4}
          />

          <Text style={styles.disclaimer}>
            Not Financial Advice, Bet Responsibly
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cancelBtn: {
    width: 70,
  },
  cancelText: {
    fontSize: 15,
    color: colors.grey,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.offWhite,
  },
  postBtn: {
    backgroundColor: colors.green,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    width: 70,
    alignItems: 'center',
  },
  postBtnDisabled: {
    opacity: 0.6,
  },
  postBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.background,
  },
  body: {
    padding: spacing.md,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  leagueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  leagueChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  leagueChipActive: {
    backgroundColor: colors.offWhite,
    borderColor: colors.offWhite,
  },
  leagueText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey,
  },
  leagueTextActive: {
    color: colors.background,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.offWhite,
    fontSize: 15,
  },
  captionInput: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: spacing.sm + 2,
  },
  disclaimer: {
    fontSize: 11,
    color: colors.grey,
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
});
