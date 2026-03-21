import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, StyleSheet } from 'react-native';

import PicksScreen from './src/screens/PicksScreen';
import ScoresScreen from './src/screens/ScoresScreen';
import FeedScreen from './src/screens/FeedScreen';
import RoomsScreen from './src/screens/RoomsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { colors } from './src/theme';

const Tab = createBottomTabNavigator();

const ChalkNavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.offWhite,
    border: colors.border,
  },
};

// Minimal geometric icon components — no icon library needed
function PicksIcon({ color, size }) {
  const s = size * 0.55;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: s, height: s, transform: [{ rotate: '45deg' }], borderWidth: 2, borderColor: color, borderRadius: 3 }}>
        <View style={{ position: 'absolute', top: s * 0.25, left: s * 0.25, width: s * 0.5, height: s * 0.5, backgroundColor: color, borderRadius: 2 }} />
      </View>
    </View>
  );
}

function ScoresIcon({ color, size }) {
  const barW = size * 0.14;
  const gap = size * 0.08;
  return (
    <View style={{ width: size, height: size, alignItems: 'flex-end', justifyContent: 'flex-end', flexDirection: 'row', gap }}>
      {[0.45, 0.65, 0.85, 1.0].map((h, i) => (
        <View key={i} style={{ width: barW, height: size * h * 0.7, backgroundColor: color, borderRadius: 2 }} />
      ))}
    </View>
  );
}

function FeedIcon({ color, size }) {
  const lineH = size * 0.1;
  const gap = size * 0.15;
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', gap }}>
      <View style={{ height: lineH, backgroundColor: color, borderRadius: 99, width: '100%' }} />
      <View style={{ height: lineH, backgroundColor: color, borderRadius: 99, width: '75%' }} />
      <View style={{ height: lineH, backgroundColor: color, borderRadius: 99, width: '55%' }} />
    </View>
  );
}

function RoomsIcon({ color, size }) {
  const r = size * 0.42;
  const tailSize = size * 0.22;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: r * 2, height: r * 1.5, borderRadius: r, borderWidth: 2, borderColor: color }}>
        <View style={{
          position: 'absolute', bottom: -tailSize * 0.6, left: r * 0.3,
          width: tailSize, height: tailSize,
          borderRightWidth: 2, borderBottomWidth: 2, borderColor: color,
          transform: [{ rotate: '30deg' }], borderRadius: 2,
        }} />
      </View>
    </View>
  );
}

function ProfileIcon({ color, size }) {
  const headR = size * 0.22;
  const bodyW = size * 0.55;
  const bodyH = size * 0.28;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', gap: size * 0.06 }}>
      <View style={{ width: headR * 2, height: headR * 2, borderRadius: headR, borderWidth: 2, borderColor: color }} />
      <View style={{ width: bodyW, height: bodyH, borderTopLeftRadius: bodyW / 2, borderTopRightRadius: bodyW / 2, borderWidth: 2, borderColor: color, borderBottomWidth: 0 }} />
    </View>
  );
}

function TabIcon({ IconComponent, focused }) {
  const iconSize = 22;
  const color = focused ? colors.green : colors.grey;
  return (
    <View style={[tabStyles.wrap, focused && tabStyles.wrapActive]}>
      <IconComponent color={color} size={iconSize} />
    </View>
  );
}

const tabStyles = StyleSheet.create({
  wrap: {
    width: 44,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  wrapActive: {
    backgroundColor: colors.green + '18',
  },
});

export default function App() {
  return (
    <NavigationContainer theme={ChalkNavTheme}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: 68,
            paddingBottom: 10,
            paddingTop: 6,
          },
          tabBarActiveTintColor: colors.green,
          tabBarInactiveTintColor: colors.grey,
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 0.4,
            marginTop: 1,
          },
        }}
      >
        <Tab.Screen
          name="Picks"
          component={PicksScreen}
          options={{ tabBarIcon: ({ focused }) => <TabIcon IconComponent={PicksIcon} focused={focused} /> }}
        />
        <Tab.Screen
          name="Scores"
          component={ScoresScreen}
          options={{ tabBarIcon: ({ focused }) => <TabIcon IconComponent={ScoresIcon} focused={focused} /> }}
        />
        <Tab.Screen
          name="Feed"
          component={FeedScreen}
          options={{ tabBarIcon: ({ focused }) => <TabIcon IconComponent={FeedIcon} focused={focused} /> }}
        />
        <Tab.Screen
          name="Rooms"
          component={RoomsScreen}
          options={{ tabBarIcon: ({ focused }) => <TabIcon IconComponent={RoomsIcon} focused={focused} /> }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={{ tabBarIcon: ({ focused }) => <TabIcon IconComponent={ProfileIcon} focused={focused} /> }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
