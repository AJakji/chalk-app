import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { colors, spacing } from '../theme';
import RoomCard from '../components/rooms/RoomCard';
import ChatRoom from '../components/rooms/ChatRoom';
import { mockRooms } from '../data/mockRooms';

export default function RoomsScreen() {
  const [selectedRoom, setSelectedRoom] = useState(null);

  const liveRooms = mockRooms.filter((r) => r.status === 'live');
  const upcomingRooms = mockRooms.filter((r) => r.status === 'upcoming');

  const renderHeader = () => (
    <>
      {liveRooms.length > 0 && (
        <View style={styles.sectionHeader}>
          <View style={styles.liveIndicator} />
          <Text style={styles.sectionLabel}>Live Rooms</Text>
          <Text style={styles.sectionCount}>{liveRooms.length}</Text>
        </View>
      )}
    </>
  );

  const sections = [
    ...liveRooms,
    // Inject an "Upcoming" header item
    ...(upcomingRooms.length > 0
      ? [{ id: '__upcoming_header__', type: 'header' }, ...upcomingRooms]
      : []),
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Rooms</Text>
          <Text style={styles.subtitle}>
            {liveRooms.length} live · {upcomingRooms.length} upcoming
          </Text>
        </View>
        {liveRooms.length > 0 && (
          <View style={styles.liveCountBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveCountText}>{liveRooms.length} Live</Text>
          </View>
        )}
      </View>

      <FlatList
        data={sections}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>Upcoming Rooms</Text>
                <Text style={styles.sectionCount}>{upcomingRooms.length}</Text>
              </View>
            );
          }
          return <RoomCard room={item} onPress={setSelectedRoom} />;
        }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>💬</Text>
            <Text style={styles.emptyText}>No game rooms right now</Text>
            <Text style={styles.emptySubText}>Rooms open when games go live</Text>
          </View>
        }
      />

      <ChatRoom
        room={selectedRoom}
        visible={!!selectedRoom}
        onClose={() => setSelectedRoom(null)}
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
  subtitle: {
    fontSize: 12,
    color: colors.grey,
    marginTop: 1,
  },
  liveCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.red + '18',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.red + '44',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.red,
  },
  liveCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.red,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  liveIndicator: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.red,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1,
    flex: 1,
  },
  sectionCount: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.grey,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    gap: spacing.sm,
  },
  emptyIcon: { fontSize: 40 },
  emptyText: {
    fontSize: 15,
    color: colors.grey,
    fontWeight: '600',
  },
  emptySubText: {
    fontSize: 13,
    color: colors.grey,
  },
});
