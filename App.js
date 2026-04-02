import React, { useRef, useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme, useIsFocused } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Animated, StyleSheet, ActivityIndicator } from 'react-native';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { TeamLogosProvider } from './src/context/TeamLogosContext';
import { PaywallProvider, usePaywall } from './src/context/PaywallContext';
import { RevenueCatProvider } from './src/context/RevenueCatContext';
import { configureRevenueCat } from './src/services/purchases';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import PicksScreen from './src/screens/PicksScreen';
import ScoresScreen from './src/screens/ScoresScreen';
import StatsScreen from './src/screens/StatsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import OnboardingScreen, { ONBOARDING_SEEN_KEY } from './src/screens/OnboardingScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import SignInScreen from './src/screens/SignInScreen';
import SupportSuggestionsScreen from './src/screens/SupportSuggestionsScreen';
import CreateAccountScreen from './src/screens/CreateAccountScreen';
import VerifyEmailScreen from './src/screens/VerifyEmailScreen';
import PaywallModal from './src/components/PaywallModal';
import { colors } from './src/theme';
import { navigationRef } from './src/navigationRef';

const CLERK_PUBLISHABLE_KEY = 'pk_live_Y2xlcmsuY2hhbGt5cGlja3MuY29tJA';

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

const Tab   = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const GOLD  = '#FFD700';

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

// ── Fade wrapper ───────────────────────────────────────────────────────────────

function FadeScreen({ children }) {
  const isFocused = useIsFocused();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isFocused) {
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [isFocused]);
  return <Animated.View style={{ flex: 1, opacity }}>{children}</Animated.View>;
}

const PicksTab    = () => <FadeScreen><PicksScreen /></FadeScreen>;
const ScoresTab   = () => <FadeScreen><ScoresScreen /></FadeScreen>;
const StatsTab    = () => <FadeScreen><StatsScreen /></FadeScreen>;
const ProfileTab  = () => <FadeScreen><ProfileScreen /></FadeScreen>;

// ── Tab icons ──────────────────────────────────────────────────────────────────

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

function StatsIcon({ color, size }) {
  const w = size * 0.68, h = size * 0.56;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: w, height: h, borderWidth: 2, borderColor: color, borderRadius: 3 }}>
        {/* header divider */}
        <View style={{ position: 'absolute', top: h * 0.33, left: 0, right: 0, height: 1.5, backgroundColor: color }} />
        {/* column divider */}
        <View style={{ position: 'absolute', top: h * 0.33, bottom: 0, left: w * 0.5, width: 1.5, backgroundColor: color }} />
      </View>
    </View>
  );
}

function ScoresIcon({ color, size }) {
  const barW = size * 0.14, gap = size * 0.08;
  return (
    <View style={{ width: size, height: size, alignItems: 'flex-end', justifyContent: 'center', flexDirection: 'row', gap }}>
      {[0.45, 0.65, 0.85, 1.0].map((h, i) => (
        <View key={i} style={{ width: barW, height: size * h * 0.7, backgroundColor: color, borderRadius: 2 }} />
      ))}
    </View>
  );
}

function ProfileIcon({ color, size }) {
  const s = size * 0.62, headR = s * 0.3, bodyW = s * 0.54, bodyH = s * 0.3;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: headR * 2, height: headR * 2, borderRadius: headR, borderWidth: 2, borderColor: color, marginBottom: 3 }} />
      <View style={{ width: bodyW, height: bodyH, borderTopLeftRadius: bodyW / 2, borderTopRightRadius: bodyW / 2, borderWidth: 2, borderColor: color, borderBottomWidth: 0 }} />
    </View>
  );
}


function TabIcon({ IconComponent, focused, activeColor }) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev  = useRef(focused);
  useEffect(() => {
    if (focused !== prev.current) {
      prev.current = focused;
      if (focused) {
        scale.setValue(0.82);
        Animated.spring(scale, { toValue: 1, tension: 220, friction: 7, useNativeDriver: true }).start();
      }
    }
  }, [focused]);
  const color = focused ? activeColor : colors.grey;
  return (
    <Animated.View style={[ti.wrap, focused && { backgroundColor: activeColor + '18' }, { transform: [{ scale }] }]}>
      <IconComponent color={color} size={22} />
    </Animated.View>
  );
}

const ti = StyleSheet.create({
  wrap: { width: 44, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
});

// ── Main tabs ──────────────────────────────────────────────────────────────────

function MainTabs() {
  const { visible, closePaywall } = usePaywall();
  return (
    <>
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
          tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginTop: 1 },
        }}
      >
        <Tab.Screen
          name="Picks"
          component={PicksTab}
          options={{ tabBarIcon: ({ focused }) => <TabIcon IconComponent={PicksIcon} focused={focused} activeColor={GOLD} />, tabBarActiveTintColor: GOLD }}
        />
        <Tab.Screen
          name="Scores"
          component={ScoresTab}
          options={{ tabBarIcon: ({ focused }) => <TabIcon IconComponent={ScoresIcon} focused={focused} activeColor={colors.green} /> }}
        />
        <Tab.Screen
          name="Stats"
          component={StatsTab}
          options={{ tabBarIcon: ({ focused }) => <TabIcon IconComponent={StatsIcon} focused={focused} activeColor={colors.green} /> }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileTab}
          options={{ tabBarIcon: ({ focused }) => <TabIcon IconComponent={ProfileIcon} focused={focused} activeColor={colors.green} /> }}
        />
      </Tab.Navigator>
      <PaywallModal visible={visible} onClose={closePaywall} />
    </>
  );
}

// ── Root navigator — switches between auth and main based on sign-in state ─────

function RootNavigator({ onboardingSeen, markOnboardingSeen }) {
  const { isSignedIn } = useAuth();

  if (!isSignedIn && !onboardingSeen) {
    return (
      <OnboardingScreen onComplete={markOnboardingSeen} />
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={ChalkNavTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        {isSignedIn ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="SupportSuggestions" component={SupportSuggestionsScreen} options={{ headerShown: false }} />
          </>
        ) : (
          <>
            <Stack.Screen name="Welcome"       component={WelcomeScreen} />
            <Stack.Screen name="SignIn"         component={SignInScreen} />
            <Stack.Screen name="CreateAccount"  component={CreateAccountScreen} />
            <Stack.Screen name="VerifyEmail"    component={VerifyEmailScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// ── RevenueCat initializer — runs once when Clerk auth state is known ──────────
// Re-configures RC whenever the signed-in user changes so the RC identity
// always matches the Clerk identity.

function RevenueCatInit() {
  const { userId } = useAuth();
  useEffect(() => {
    configureRevenueCat(userId || null);
  }, [userId]);
  return null;
}

// ── MainApp — handles loading + onboarding gate ────────────────────────────────

function MainApp() {
  const { isLoaded } = useAuth();
  const [onboardingSeen, setOnboardingSeen] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_SEEN_KEY)
      .then((val) => setOnboardingSeen(!!val))
      .catch(() => setOnboardingSeen(true));
  }, []);

  if (!isLoaded || onboardingSeen === null) {
    return (
      <View style={{ flex: 1, backgroundColor: '#080808', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  const markOnboardingSeen = async () => {
    try { await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true'); } catch {}
    setOnboardingSeen(true);
  };

  return (
    <RootNavigator
      onboardingSeen={onboardingSeen}
      markOnboardingSeen={markOnboardingSeen}
    />
  );
}

// ── App root ───────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <RevenueCatProvider>
        <RevenueCatInit />
        <TeamLogosProvider>
          <PaywallProvider>
            <MainApp />
          </PaywallProvider>
        </TeamLogosProvider>
      </RevenueCatProvider>
    </ClerkProvider>
  );
}
