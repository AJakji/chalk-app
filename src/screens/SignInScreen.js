/**
 * SignInScreen — modern, minimal, premium auth screen.
 * Dark. Clean. No card containers. Floating inputs with bottom-border only.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Image,
  Dimensions,
  Animated,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { useSignIn, useSignUp, useOAuth } from '@clerk/clerk-expo';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { API_URL } from '../config';

WebBrowser.maybeCompleteAuthSession();

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const CHALKY_PNG = require('../../assets/chalky.png');
const { width: W, height: H } = Dimensions.get('window');

// ── OAuth helpers ─────────────────────────────────────────────────────────────

function useAppleOAuth() {
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_apple' });
  return async () => {
    try {
      const { createdSessionId, setActive } = await startOAuthFlow({
        redirectUrl: Linking.createURL('/', { scheme: 'chalky' }),
      });
      if (createdSessionId) await setActive({ session: createdSessionId });
    } catch (err) {
      console.error('Apple OAuth:', err);
    }
  };
}

function useGoogleOAuth() {
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' });
  return async () => {
    try {
      const { createdSessionId, setActive } = await startOAuthFlow({
        redirectUrl: Linking.createURL('/', { scheme: 'chalky' }),
      });
      if (createdSessionId) await setActive({ session: createdSessionId });
    } catch (err) {
      console.error('Google OAuth:', err);
    }
  };
}

// ── Underline tab switcher ────────────────────────────────────────────────────

function ModeSwitcher({ mode, onChange }) {
  const underlineX = useRef(new Animated.Value(0)).current;
  const [signinW, setSigninW] = useState(0);
  const [signupW, setSignupW] = useState(0);

  const switchTo = (next) => {
    onChange(next);
    Animated.spring(underlineX, {
      toValue: next === 'signin' ? 0 : 1,
      tension: 180,
      friction: 12,
      useNativeDriver: false,
    }).start();
  };

  const underlineLeft = underlineX.interpolate({
    inputRange: [0, 1],
    outputRange: [0, signinW + 32], // 32 = gap between labels
  });
  const underlineWidth = underlineX.interpolate({
    inputRange: [0, 1],
    outputRange: [signinW, signupW],
  });

  return (
    <View style={switcher.wrap}>
      <TouchableOpacity
        onPress={() => switchTo('signin')}
        activeOpacity={0.7}
        onLayout={(e) => setSigninW(e.nativeEvent.layout.width)}
      >
        <Text style={[switcher.label, mode === 'signin' && switcher.labelActive]}>
          Sign In
        </Text>
      </TouchableOpacity>

      <View style={switcher.spacer} />

      <TouchableOpacity
        onPress={() => switchTo('signup')}
        activeOpacity={0.7}
        onLayout={(e) => setSignupW(e.nativeEvent.layout.width)}
      >
        <Text style={[switcher.label, mode === 'signup' && switcher.labelActive]}>
          Create Account
        </Text>
      </TouchableOpacity>

      {/* Sliding green underline */}
      <Animated.View
        style={[
          switcher.underline,
          {
            left: underlineLeft,
            width: underlineWidth,
          },
        ]}
      />
    </View>
  );
}

const switcher = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 10,
    position: 'relative',
  },
  spacer: { width: 32 },
  label: {
    fontSize: 15,
    fontWeight: '400',
    color: '#444444',
    letterSpacing: 0.2,
    paddingBottom: 8,
  },
  labelActive: {
    color: '#F5F5F0',
    fontWeight: '700',
  },
  underline: {
    position: 'absolute',
    bottom: 0,
    height: 2,
    backgroundColor: '#00E87A',
    borderRadius: 1,
  },
});

// ── Bottom-border input ───────────────────────────────────────────────────────

function LineInput({
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  showToggle,
  onToggle,
  showingPassword,
  autoFocus,
}) {
  const [focused, setFocused] = useState(false);
  const borderAnim = useRef(new Animated.Value(0)).current;

  const borderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#252525', '#00E87A'],
  });

  const handleFocus = () => {
    setFocused(true);
    Animated.timing(borderAnim, { toValue: 1, duration: 200, useNativeDriver: false }).start();
  };
  const handleBlur = () => {
    setFocused(false);
    Animated.timing(borderAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  };

  return (
    <Animated.View style={[input.wrap, { borderBottomColor: borderColor }]}>
      <TextInput
        style={input.field}
        placeholder={placeholder}
        placeholderTextColor="#444444"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry && !showingPassword}
        keyboardType={keyboardType || 'default'}
        autoCapitalize={autoCapitalize || 'none'}
        autoCorrect={false}
        onFocus={handleFocus}
        onBlur={handleBlur}
        autoFocus={autoFocus}
      />
      {showToggle && (
        <TouchableOpacity onPress={onToggle} style={input.eyeBtn} activeOpacity={0.6}>
          <Ionicons
            name={showingPassword ? 'eye-off' : 'eye'}
            size={17}
            color={showingPassword ? '#F5F5F0' : '#444444'}
          />
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const input = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    borderBottomWidth: 1,
    marginBottom: 16,
  },
  field: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 4,
    color: '#F5F5F0',
    fontSize: 15,
  },
  eyeBtn: {
    padding: 4,
    paddingLeft: 12,
  },
});

// ── CTA button with spring press ──────────────────────────────────────────────

function CTAButton({ onPress, loading, label }) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.97, tension: 300, friction: 10, useNativeDriver: true }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }).start();

  return (
    <Animated.View style={{ transform: [{ scale }], marginHorizontal: 24, marginTop: 32 }}>
      <TouchableOpacity
        style={cta.btn}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={loading}
        activeOpacity={1}
      >
        {loading
          ? <ActivityIndicator color="#080808" size="small" />
          : <Text style={cta.text}>{label}</Text>}
      </TouchableOpacity>
    </Animated.View>
  );
}

const cta = StyleSheet.create({
  btn: {
    backgroundColor: '#00E87A',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  text: {
    color: '#080808',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SignInScreen() {
  const { signIn, setActive: setSignInActive, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setSignUpActive, isLoaded: signUpLoaded } = useSignUp();

  const handleApple = useAppleOAuth();
  const handleGoogle = useGoogleOAuth();

  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);

  // ── Mount animations ──────────────────────────────────────────────────────
  const logoOpacity   = useRef(new Animated.Value(0)).current;
  const titleOpacity  = useRef(new Animated.Value(0)).current;
  const titleY        = useRef(new Animated.Value(12)).current;
  const tagOpacity    = useRef(new Animated.Value(0)).current;
  const tagY          = useRef(new Animated.Value(12)).current;
  const formOpacity   = useRef(new Animated.Value(0)).current;
  const formY         = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    const fade = (val, delay) =>
      Animated.timing(val, { toValue: 1, duration: 600, delay, useNativeDriver: true });
    const rise = (val, delay) =>
      Animated.timing(val, { toValue: 0, duration: 600, delay, useNativeDriver: true });

    Animated.parallel([
      fade(logoOpacity, 0),
      fade(titleOpacity, 150), rise(titleY, 150),
      fade(tagOpacity, 250),   rise(tagY, 250),
      fade(formOpacity, 400),  rise(formY, 400),
    ]).start();
  }, []);

  // ── Mode switch — animate confirm field in/out ────────────────────────────
  const handleModeSwitch = (next) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMode(next);
    setError('');
  };

  // ── Auth handlers ─────────────────────────────────────────────────────────
  async function handleSignIn() {
    if (!signInLoaded) return;
    setLoading(true); setError('');
    try {
      const res = await signIn.create({ identifier: email, password });
      if (res.status === 'complete') {
        await setSignInActive({ session: res.createdSessionId });
      } else {
        setError('Sign in incomplete. Please try again.');
      }
    } catch (e) { setError(clerkMsg(e)); }
    finally { setLoading(false); }
  }

  async function handleSignUp() {
    if (!signUpLoaded) return;
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true); setError('');
    try {
      await signUp.create({ emailAddress: email, password, username });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setVerifying(true);
    } catch (e) { setError(clerkMsg(e)); }
    finally { setLoading(false); }
  }

  async function handleVerify() {
    if (!signUpLoaded) return;
    setLoading(true); setError('');
    try {
      const res = await signUp.attemptEmailAddressVerification({ code });
      if (res.status === 'complete') {
        await setSignUpActive({ session: res.createdSessionId });
      } else {
        setError('Verification incomplete. Try again.');
      }
    } catch (e) { setError(clerkMsg(e)); }
    finally { setLoading(false); }
  }

  // ── Verify screen ─────────────────────────────────────────────────────────
  if (verifying) {
    return (
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.verifyWrap}>
            <Image source={CHALKY_PNG} style={s.verifyLogo} resizeMode="contain" />
            <Text style={s.verifyTitle}>Check your email</Text>
            <Text style={s.verifySub}>
              Sent a 6-digit code to{'\n'}
              <Text style={s.verifyEmail}>{email}</Text>
            </Text>
            <TextInput
              style={s.codeInput}
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              placeholderTextColor="#444444"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
            {error ? <Text style={s.error}>{error}</Text> : null}
            <CTAButton onPress={handleVerify} loading={loading} label="Verify & Enter" />
            <TouchableOpacity onPress={() => { setVerifying(false); setError(''); }} style={s.backLink}>
              <Text style={s.backLinkText}>← Back</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const isSignUp = mode === 'signup';

  return (
    <SafeAreaView style={s.safe}>
      {/* Radial glow */}
      <View style={s.glow} pointerEvents="none" />

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >

          {/* ── TOP ZONE ── */}
          <View style={s.topZone}>
            <Animated.View style={{ opacity: logoOpacity }}>
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
              The edge has a name.
            </Animated.Text>
          </View>

          {/* ── MIDDLE ZONE ── */}
          <Animated.View
            style={[s.midZone, { opacity: formOpacity, transform: [{ translateY: formY }] }]}
          >
            {/* Mode switcher */}
            <ModeSwitcher mode={mode} onChange={handleModeSwitch} />

            <View style={s.formGap} />

            {/* Social buttons — side by side */}
            <View style={s.socialRow}>
              <TouchableOpacity style={s.appleBtn} onPress={handleApple} activeOpacity={0.85}>
                <Text style={s.appleLogo}></Text>
                <Text style={s.appleTxt}>Apple</Text>
              </TouchableOpacity>

              <TouchableOpacity style={s.googleBtn} onPress={handleGoogle} activeOpacity={0.85}>
                <Text style={s.googleG}>G</Text>
                <Text style={s.googleTxt}>Google</Text>
              </TouchableOpacity>
            </View>

            {/* Divider */}
            <View style={s.divider}>
              <View style={s.dividerLine} />
              <Text style={s.dividerOr}>or</Text>
              <View style={s.dividerLine} />
            </View>

            {/* Username — sign up only */}
            {isSignUp && (
              <LineInput
                placeholder="Username"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
              />
            )}

            {/* Email */}
            <LineInput
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            {/* Password */}
            <LineInput
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              showToggle
              showingPassword={showPw}
              onToggle={() => setShowPw(v => !v)}
            />

            {/* Confirm password — sign up only */}
            {isSignUp && (
              <LineInput
                placeholder="Confirm Password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                showToggle
                showingPassword={showConfirm}
                onToggle={() => setShowConfirm(v => !v)}
              />
            )}

            {/* Error */}
            {error ? <Text style={s.error}>{error}</Text> : null}

            {/* CTA */}
            <CTAButton
              onPress={isSignUp ? handleSignUp : handleSignIn}
              loading={loading}
              label={isSignUp ? 'Create Account' : 'Sign In'}
            />

            {/* Forgot password — sign in only */}
            {!isSignUp && (
              <TouchableOpacity style={s.forgotWrap} activeOpacity={0.6}>
                <Text style={s.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            )}
          </Animated.View>

          {/* ── BOTTOM ZONE ── */}
          <View style={s.bottomZone}>
            <Text style={s.terms}>
              By continuing you agree to our Terms of Service · 18+ · Bet responsibly
            </Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function clerkMsg(e) {
  return e?.errors?.[0]?.longMessage
    || e?.errors?.[0]?.message
    || 'Something went wrong. Please try again.';
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#080808',
  },
  flex: { flex: 1 },

  glow: {
    position: 'absolute',
    top: -40,
    left: '50%',
    marginLeft: -160,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#00E87A',
    opacity: 0.06,
  },

  scroll: {
    flexGrow: 1,
    minHeight: H,
  },

  // TOP ZONE
  topZone: {
    height: H * 0.38,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  appName: {
    fontSize: 48,
    fontWeight: '900',
    color: '#F5F5F0',
    letterSpacing: 8,
    marginTop: 14,
    lineHeight: 52,
  },
  tagline: {
    fontSize: 14,
    color: '#555555',
    letterSpacing: 0.5,
    marginTop: 6,
  },

  // MIDDLE ZONE
  midZone: {
    minHeight: H * 0.44,
    paddingBottom: 8,
  },
  formGap: { height: 32 },

  // Social row — side by side
  socialRow: {
    flexDirection: 'row',
    marginHorizontal: 24,
    gap: 12,
    marginBottom: 20,
  },
  appleBtn: {
    flex: 1,
    backgroundColor: '#F5F5F0',
    borderRadius: 10,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  appleLogo: {
    fontSize: 17,
    color: '#080808',
    lineHeight: 20,
  },
  appleTxt: {
    fontSize: 14,
    fontWeight: '600',
    color: '#080808',
  },
  googleBtn: {
    flex: 1,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 10,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  googleG: {
    fontSize: 16,
    fontWeight: '800',
    color: '#4285F4',
  },
  googleTxt: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5F5F0',
  },

  // Divider
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1e1e1e',
  },
  dividerOr: {
    color: '#444444',
    fontSize: 12,
    marginHorizontal: 12,
    fontWeight: '500',
  },

  // Error
  error: {
    color: '#FF4444',
    fontSize: 12,
    marginHorizontal: 28,
    marginTop: -8,
    marginBottom: 8,
    lineHeight: 18,
  },

  // Forgot
  forgotWrap: {
    alignItems: 'center',
    marginTop: 14,
  },
  forgotText: {
    fontSize: 12,
    color: '#555555',
  },

  // BOTTOM ZONE
  bottomZone: {
    height: H * 0.18,
    justifyContent: 'flex-end',
    paddingBottom: 24,
    paddingHorizontal: 32,
  },
  terms: {
    fontSize: 11,
    color: '#2a2a2a',
    textAlign: 'center',
    lineHeight: 17,
  },

  // Verify screen
  verifyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  verifyLogo: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginBottom: 8,
  },
  verifyTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F5F5F0',
    letterSpacing: -0.4,
  },
  verifySub: {
    fontSize: 14,
    color: '#555555',
    textAlign: 'center',
    lineHeight: 22,
  },
  verifyEmail: {
    color: '#F5F5F0',
    fontWeight: '600',
  },
  codeInput: {
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: '#00E87A',
    paddingVertical: 14,
    paddingHorizontal: 4,
    color: '#F5F5F0',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 10,
    textAlign: 'center',
    alignSelf: 'stretch',
    marginTop: 8,
  },
  backLink: {
    marginTop: 4,
    padding: 8,
  },
  backLinkText: {
    fontSize: 13,
    color: '#555555',
  },
});
