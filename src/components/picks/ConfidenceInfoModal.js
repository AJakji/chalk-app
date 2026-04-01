import React from 'react';
import {
  Modal, View, Text, ScrollView, Pressable,
  StyleSheet,
} from 'react-native';
import { colors, spacing, radius } from '../../theme';
import ChalkyFace from '../ChalkyFace';

const G = colors.green;

export default function ConfidenceInfoModal({ visible, onClose }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>

          {/* Drag handle */}
          <View style={styles.handle} />

          {/* Chalky avatar + title */}
          <View style={styles.titleRow}>
            <ChalkyFace size={36} style={styles.avatar} />
            <Text style={styles.title}>How Chalky's confidence works</Text>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
          >
            <Text style={styles.para}>
              Confidence reflects how much our proprietary model disagrees with
              the sportsbook's line — and how reliable that disagreement is.
            </Text>

            <Text style={styles.para}>
              The model already accounts for everything:{' '}
              <Text style={styles.green}>opponent defensive rank, pace, rest days,
              shooting trends, weather, park factors, special teams, goalie
              performance,</Text>{' '}
              and dozens of other variables.
            </Text>

            <Text style={styles.para}>
              The{' '}
              <Text style={styles.green}>edge</Text>
              {' '}is the gap between what our model projects and what the book posted.
              A larger edge means our research disagrees more strongly with the
              market — and that drives confidence up.
            </Text>

            <Text style={styles.sectionLabel}>Edge tiers</Text>
            <View style={styles.table}>
              {[
                ['≥ 5.0',  '+35'],
                ['≥ 4.0',  '+28'],
                ['≥ 3.0',  '+22'],
                ['≥ 2.5',  '+18'],
                ['≥ 2.0',  '+14'],
                ['≥ 1.5',  '+8'],
              ].map(([tier, bonus]) => (
                <View key={tier} style={styles.tableRow}>
                  <Text style={styles.tableTier}>{tier} edge</Text>
                  <Text style={styles.tableBonus}>{bonus}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.para}>
              The only things that adjust confidence{' '}
              <Text style={styles.green}>after the model runs</Text>
              {' '}are new signals that arrived after the projection was built:
            </Text>

            <View style={styles.bullets}>
              {[
                'Line movement (sharp money agrees or disagrees)',
                'Late injury news (player status changed)',
                'Goalie confirmation (NHL starter revealed)',
                'Sample size (how much data we have)',
              ].map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>·</Text>
                  <Text style={styles.bulletText}>{b}</Text>
                </View>
              ))}
            </View>

            <View style={styles.disclaimer}>
              <Text style={styles.disclaimerText}>
                <Text style={styles.green}>92%</Text>
                {' '}does not mean the pick wins 92% of the time. It means our model
                has very high conviction based on the edge and the available information.
              </Text>
              <Text style={[styles.disclaimerText, { marginTop: spacing.sm }]}>
                No pick is a certainty. Chalk is about finding{' '}
                <Text style={styles.green}>edges</Text>
                {' '}— the best ones win over time.
              </Text>
            </View>
          </ScrollView>

          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Got it</Text>
          </Pressable>

        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingBottom: 32,
    maxHeight: '85%',
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.offWhite,
    flex: 1,
  },
  body: {
    paddingBottom: 8,
  },
  para: {
    fontSize: 14,
    color: colors.grey,
    lineHeight: 21,
    marginBottom: 14,
  },
  green: {
    color: G,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  table: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableTier: {
    fontSize: 13,
    color: colors.offWhite,
    fontWeight: '600',
  },
  tableBonus: {
    fontSize: 13,
    color: G,
    fontWeight: '700',
  },
  bullets: {
    marginBottom: 16,
    gap: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 8,
  },
  bulletDot: {
    fontSize: 16,
    color: G,
    lineHeight: 22,
  },
  bulletText: {
    fontSize: 13,
    color: colors.grey,
    lineHeight: 22,
    flex: 1,
  },
  disclaimer: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 4,
  },
  disclaimerText: {
    fontSize: 13,
    color: colors.grey,
    lineHeight: 20,
  },
  closeBtn: {
    marginTop: 20,
    backgroundColor: G,
    borderRadius: radius.full,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.background,
    letterSpacing: 0.3,
  },
});
