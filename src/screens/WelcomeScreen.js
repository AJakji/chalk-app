/**
 * WelcomeScreen — Hero / landing screen.
 * First thing unauthenticated users see after onboarding.
 */
import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Image,
  Animated,
  Dimensions,
} from 'react-native';

const CHALKY_PNG = require('../../assets/chalky.png');
const { height: H } = Dimensions.get('window');

// Floating particle — a faint green dot drifting upward
function Particle({ x, delay, size }) {
  const y = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const run = () => {
      y.setValue(0);
      opacity.setValue(0);
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(y, { toValue: -H * 0.55, duration: 7000 + delay, useNativeDriver: true }),
        ]),
        Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start(() => run());
    };
    run();
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x,
        bottom: H * 0.1,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#00E87A',
        opacity: opacity.interpolate({ inputRange: [0, 1], outputRange: [0, 0.04] }),
        transform: [{ translateY: y }],
      }}
    />
  );
}

const PARTICLES = [
  { x: '8%',  delay: 0,    size: 6  },
  { x: '22%', delay: 1200, size: 4  },
  { x: '40%', delay: 600,  size: 8  },
  { x: '58%', delay: 2000, size: 5  },
  { x: '72%', delay: 400,  size: 7  },
  { x: '88%', delay: 1600, size: 4  },
  { x: '15%', delay: 2800, size: 6  },
  { x: '65%', delay: 800,  size: 5  },
];

export default function WelcomeScreen({ navigation }) {
  // Mount animations
  const logoScale   = useRef(new Animated.Value(0.8)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleY       = useRef(new Animated.Value(16)).current;
  const tagOpacity   = useRef(new Animated.Value(0)).current;
  const tagY         = useRef(new Animated.Value(16)).current;
  const btnsOpacity  = useRef(new Animated.Value(0)).current;
  const btnsY        = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    const anim = (opacity, y, delay) => Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 600, delay, useNativeDriver: true }),
      y ? Animated.timing(y, { toValue: 0, duration: 600, delay, useNativeDriver: true }) : null,
    ].filter(Boolean));

    Animated.parallel([
      Animated.parallel([
        Animated.spring(logoScale, { toValue: 1, tension: 80, friction: 8, delay: 0, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 700, delay: 0, useNativeDriver: true }),
      ]),
      anim(titleOpacity, titleY, 150),
      anim(tagOpacity, tagY, 300),
      anim(btnsOpacity, btnsY, 500),
    ]).start();
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      {/* Background glow */}
      <View style={s.glow} pointerEvents="none" />

      {/* Floating particles */}
      {PARTICLES.map((p, i) => (
        <Particle key={i} x={p.x} delay={p.delay} size={p.size} />
      ))}

      {/* TOP HALF — brand */}
      <View style={s.top}>
        <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }] }}>
          <Image source={CHALKY_PNG} style={s.logo} resizeMode="contain" />
        </Animated.View>

        <Animated.Text
          style={[s.appName, { opacity: titleOpacity, transform: [{ translateY: titleY }] }]}
        >
          CHALKY
        </Animated.Text>

        <Animated.Text
          style={[s.tagline, { opacity: tagOpacity, transform: [{ translateY: tagY }] }]}
        >
          Welcome to the Algorithm
        </Animated.Text>
      </View>

      {/* BOTTOM HALF — actions */}
      <Animated.View
        style={[s.bottom, { opacity: btnsOpacity, transform: [{ translateY: btnsY }] }]}
      >
        <TouchableOpacity
          style={s.createBtn}
          onPress={() => navigation.navigate('CreateAccount')}
          activeOpacity={0.85}
        >
          <Text style={s.createBtnText}>Create an Account</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.signInBtn}
          onPress={() => navigation.navigate('SignIn')}
          activeOpacity={0.85}
        >
          <Text style={s.signInBtnText}>Sign In</Text>
        </TouchableOpacity>

        <Text style={s.legal}>18+ only. Bet responsibly.</Text>
      </Animated.View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#080808',
  },
  glow: {
    position: 'absolute',
    top: H * 0.1,
    left: '50%',
    marginLeft: -180,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: '#00E87A',
    opacity: 0.05,
  },

  // Top zone
  top: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  appName: {
    fontSize: 72,
    fontWeight: '900',
    color: '#F5F5F0',
    letterSpacing: 6,
    marginTop: 20,
    lineHeight: 76,
  },
  tagline: {
    fontSize: 18,
    fontWeight: '300',
    color: '#888888',
    letterSpacing: 1,
    marginTop: 16,
    textAlign: 'center',
  },

  // Bottom zone
  bottom: {
    paddingHorizontal: 28,
    paddingBottom: 40,
    gap: 14,
  },
  createBtn: {
    backgroundColor: '#00E87A',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#080808',
    letterSpacing: 0.3,
  },
  signInBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  signInBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F5F0',
    letterSpacing: 0.3,
  },
  legal: {
    fontSize: 11,
    color: '#2a2a2a',
    textAlign: 'center',
    marginTop: 6,
  },
});
