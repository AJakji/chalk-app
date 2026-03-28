import React, { useRef, useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme, useIsFocused } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Animated, StyleSheet, ActivityIndicator } from 'react-native';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { TeamLogosProvider } from './src/context/TeamLogosContext';
import { PaywallProvider, usePaywall } from './src/context/PaywallContext';
import { useProStatus } from './src/hooks/useProStatus';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import PicksScreen from './src/screens/PicksScreen';
import ScoresScreen from './src/screens/ScoresScreen';
import ResearchScreen from './src/screens/ResearchScreen';
import PlayersScreen from './src/screens/PlayersScreen';
import OnboardingScreen, { ONBOARDING_SEEN_KEY } from './src/screens/OnboardingScreen';
import SignInScreen from './src/screens/SignInScreen';
import PaywallModal from './src/components/PaywallModal';
import { colors } from './src/theme';
import { navigationRef } from './src/navigationRef';

const CLERK_PUBLISHABLE_KEY = 'pk_test_cXVhbGl0eS1wZXJjaC0zOC5jbGVyay5hY2NvdW50cy5kZXYk';

const tokenCache = {
  async getToken(key) {
    try { return await SecureStore.getItemAsync(key); }
    catch { return null; }
  },
  async saveToken(key, value) {
    try { await SecureStore.setItemAsync(key, value); }
    catch {}
  },
};

const Tab = createBottomTabNavigator();

const GOLD = '#FFD700';

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

// ── Fade wrapper — fades in every time the tab becomes focused ────────────────

function FadeScreen({ children }) {
  const isFocused = useIsFocused();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isFocused) {
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [isFocused]);

  return (
    <Animated.View style={{ flex: 1, opacity }}>
      {children}
    </Animated.View>
  );
}

const PicksTab    = () => <FadeScreen><PicksScreen /></FadeScreen>;
const ResearchTab = () => <FadeScreen><ResearchScreen /></FadeScreen>;
const ScoresTab   = () => <FadeScreen><ScoresScreen /></FadeScreen>;
const PlayersTab  = ({ navigation }) => <FadeScreen><PlayersScreen navigation={navigation} /></FadeScreen>;

// ── Tab Icons ─────────────────────────────────────────────────────────────────

function PicksIcon({ color, size }) {
  const s = size * 0.55;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: s, height: s, transform: [{ rotate: '45deg' }],
        borderWidth: 2, borderColor: color, borderRadius: 3,
      }}>
        <View style={{
          position: 'absolute', top: s * 0.25, left: s * 0.25,
          width: s * 0.5, height: s * 0.5,
          backgroundColor: color, borderRadius: 2,
        }} />
      </View>
    </View>
  );
}

function ResearchIcon({ color, size }) {
  const circleSize = size * 0.56;
  const circleR = circleSize / 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: circleSize, height: circleSize, borderRadius: circleR,
        borderWidth: 2.5, borderColor: color,
        position: 'absolute', top: size * 0.06, left: size * 0.06,
      }} />
      <View style={{
        position: 'absolute', bottom: size * 0.06, right: size * 0.06,
        width: 3, height: size * 0.34,
        backgroundColor: color, borderRadius: 3,
        transform: [{ rotate: '45deg' }],
      }} />
    </View>
  );
}

function ScoresIcon({ color, size }) {
  const barW = size * 0.14;
  const gap = size * 0.08;
  return (
    <View style={{
      width: size, height: size,
      alignItems: 'flex-end', justifyContent: 'flex-end',
      flexDirection: 'row', gap,
    }}>
      {[0.45, 0.65, 0.85, 1.0].map((h, i) => (
        <View
          key={i}
          style={{ width: barW, height: size * h * 0.7, backgroundColor: color, borderRadius: 2 }}
        />
      ))}
    </View>
  );
}

function PlayersIcon({ color, size }) {
  const s = size * 0.62;
  const headR = s * 0.3;
  const bodyW = s * 0.54;
  const bodyH = s * 0.3;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Head circle */}
      <View style={{
        width: headR * 2, height: headR * 2, borderRadius: headR,
        borderWidth: 2, borderColor: color,
        marginBottom: 3,
      }} />
      {/* Shoulders arc as rounded rect */}
      <View style={{
        width: bodyW, height: bodyH,
        borderTopLeftRadius: bodyW / 2, borderTopRightRadius: bodyW / 2,
        borderWidth: 2, borderColor: color,
        borderBottomWidth: 0,
      }} />
    </View>
  );
}

// activeColor prop lets each tab use its own highlight colour
function TabIcon({ IconComponent, focused, activeColor }) {
  const scale = useRef(new Animated.Value(1)).current;
  const prevFocused = useRef(focused);
  const color = focused ? activeColor : colors.grey;

  useEffect(() => {
    if (focused !== prevFocused.current) {
      prevFocused.current = focused;
      if (focused) {
        scale.setValue(0.82);
        Animated.spring(scale, {
          toValue: 1,
          tension: 220,
          friction: 7,
          useNativeDriver: true,
        }).start();
      }
    }
  }, [focused]);

  const bgColor = focused ? activeColor + '18' : 'transparent';

  return (
    <Animated.View style={[tabStyles.wrap, focused && { backgroundColor: bgColor }, { transform: [{ scale }] }]}>
      <IconComponent color={color} size={22} />
    </Animated.View>
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
});

// ── Main tab app ──────────────────────────────────────────────────────────────

function TabApp() {
  const { isPro } = useProStatus();
  const { openPaywall, visible, closePaywall } = usePaywall();

  return (
    <>
      <NavigationContainer ref={navigationRef} theme={ChalkNavTheme}>
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
            component={PicksTab}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon IconComponent={PicksIcon} focused={focused} activeColor={GOLD} />
              ),
              tabBarActiveTintColor: GOLD,
            }}
          />
          <Tab.Screen
            name="Research"
            component={ResearchTab}
            listeners={() => ({
              tabPress: (e) => {
                if (!isPro) {
                  e.preventDefault();
                  openPaywall();
                }
              },
            })}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon IconComponent={ResearchIcon} focused={focused} activeColor={GOLD} />
              ),
              tabBarActiveTintColor: GOLD,
            }}
          />
          <Tab.Screen
            name="Scores"
            component={ScoresTab}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon IconComponent={ScoresIcon} focused={focused} activeColor={colors.green} />
              ),
            }}
          />
          <Tab.Screen
            name="Players"
            component={PlayersTab}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon IconComponent={PlayersIcon} focused={focused} activeColor={colors.green} />
              ),
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
      <PaywallModal visible={visible} onClose={closePaywall} />
    </>
  );
}

// ── App — routing logic ───────────────────────────────────────────────────────

function MainApp() {
  const { isSignedIn, isLoaded } = useAuth();
  const [onboardingSeen, setOnboardingSeen] = useState(null); // null = loading

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_SEEN_KEY)
      .then((val) => setOnboardingSeen(!!val))
      .catch(() => setOnboardingSeen(true)); // if error, skip onboarding
  }, []);

  // Still loading Clerk or AsyncStorage
  if (!isLoaded || onboardingSeen === null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  // Not signed in + hasn't seen onboarding → show onboarding
  if (!isSignedIn && !onboardingSeen) {
    return (
      <OnboardingScreen
        onComplete={() => setOnboardingSeen(true)}
      />
    );
  }

  // Not signed in + has seen onboarding → show sign-in
  if (!isSignedIn) {
    return <SignInScreen />;
  }

  // Signed in → show the main app
  return <TabApp />;
}

export default function App() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <TeamLogosProvider>
        <PaywallProvider>
          <MainApp />
        </PaywallProvider>
      </TeamLogosProvider>
    </ClerkProvider>
  );
}
