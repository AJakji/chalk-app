/**
 * CreateAccountScreen — sign up with Apple, Google, or email.
 * Handles both the sign-up form and email verification in one screen
 * so the same signUp instance is used throughout (Clerk requirement).
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
  Animated,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { useSignUp, useOAuth } from '@clerk/clerk-expo';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';

function GoogleIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" style={{ marginRight: 0 }}>
      <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </Svg>
  );
}

WebBrowser.maybeCompleteAuthSession();

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function FormInput({ placeholder, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize, showToggle, showing, onToggle }) {
  const borderAnim = useRef(new Animated.Value(0)).current;
  const border = borderAnim.interpolate({ inputRange: [0, 1], outputRange: ['#1e1e1e', '#00E87A'] });

  return (
    <Animated.View style={[fi.wrap, { borderColor: border }]}>
      <TextInput
        style={fi.input}
        placeholder={placeholder}
        placeholderTextColor="#3a3a3a"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry && !showing}
        keyboardType={keyboardType || 'default'}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
        onFocus={() =>
          Animated.timing(borderAnim, { toValue: 1, duration: 180, useNativeDriver: false }).start()
        }
        onBlur={() =>
          Animated.timing(borderAnim, { toValue: 0, duration: 180, useNativeDriver: false }).start()
        }
      />
      {showToggle && (
        <TouchableOpacity onPress={onToggle} style={fi.eye} activeOpacity={0.6}>
          <Ionicons name={showing ? 'eye-off' : 'eye'} size={17} color={showing ? '#F5F5F0' : '#3a3a3a'} />
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const fi = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 15,
    paddingHorizontal: 18,
    color: '#F5F5F0',
    fontSize: 15,
  },
  eye: { paddingHorizontal: 14, paddingVertical: 15 },
});

function useApple() {
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_apple' });
  return async () => {
    try {
      const { createdSessionId, setActive } = await startOAuthFlow({
        redirectUrl: Linking.createURL('/', { scheme: 'chalky' }),
      });
      if (createdSessionId) await setActive({ session: createdSessionId });
    } catch (e) { console.error('Apple:', e); }
  };
}

function useGoogle() {
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' });
  return async () => {
    try {
      const { createdSessionId, setActive } = await startOAuthFlow({
        redirectUrl: Linking.createURL('/', { scheme: 'chalky' }),
      });
      if (createdSessionId) await setActive({ session: createdSessionId });
    } catch (e) { console.error('Google:', e); }
  };
}

export default function CreateAccountScreen({ navigation }) {
  const { signUp, setActive, isLoaded } = useSignUp();
  const handleApple  = useApple();
  const handleGoogle = useGoogle();

  // Sign-up form state
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [username, setUsername]   = useState('');
  const [password, setPassword]   = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  // Verification state — shown after account creation
  const [pendingVerification, setPendingVerification] = useState(false);
  const [digits, setDigits]           = useState(['', '', '', '', '', '']);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(30);
  const digitRefs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];

  // Countdown for resend button
  useEffect(() => {
    if (!pendingVerification || resendCountdown <= 0) return;
    const t = setTimeout(() => setResendCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [pendingVerification, resendCountdown]);

  // Auto-focus first digit box when verification screen appears
  useEffect(() => {
    if (pendingVerification) {
      setTimeout(() => digitRefs[0].current?.focus(), 400);
    }
  }, [pendingVerification]);

  const revealEmailForm = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowEmailForm(true);
  };

  // Step 1 — create account and send code
  const handleSubmit = async () => {
    if (!isLoaded) return;
    setLoading(true);
    setError('');
    if (!username.trim()) {
      setError('Please enter a username.');
      setLoading(false);
      return;
    }
    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters.');
      setLoading(false);
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      setError('Username can only contain letters, numbers, and underscores.');
      setLoading(false);
      return;
    }
    try {
      await signUp.create({ firstName, lastName, emailAddress: email, password, username: username.trim() });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setPendingVerification(true);
    } catch (e) {
      setError(e.errors?.[0]?.longMessage || e.errors?.[0]?.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  // Digit input handling
  const handleDigit = (text, index) => {
    const cleaned = text.replace(/[^0-9]/g, '').slice(-1);
    const next = [...digits];
    next[index] = cleaned;
    setDigits(next);
    if (cleaned && index < 5) {
      digitRefs[index + 1].current?.focus();
    }
    if (cleaned && index === 5) {
      const code = next.join('');
      if (code.length === 6) handleVerify(code);
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      digitRefs[index - 1].current?.focus();
    }
  };

  // Step 2 — verify code using the SAME signUp instance
  const handleVerify = async (codeOverride) => {
    const code = (codeOverride || digits.join('')).trim();
    if (code.length < 6) { setError('Enter all 6 digits.'); return; }
    if (!isLoaded) return;
    setVerifyLoading(true);
    setError('');
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
      } else {
        setError(`Verification incomplete (status: ${result.status}). Please try again.`);
        setDigits(['', '', '', '', '', '']);
        setTimeout(() => digitRefs[0].current?.focus(), 100);
      }
    } catch (e) {
      const msg = e.errors?.[0]?.longMessage || e.errors?.[0]?.message || 'Invalid code. Try again.';
      setError(msg);
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => digitRefs[0].current?.focus(), 100);
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCountdown > 0 || !isLoaded) return;
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setResendCountdown(30);
      setError('');
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => digitRefs[0].current?.focus(), 100);
    } catch (e) {
      setError('Could not resend code.');
    }
  };

  // ── Verification view ────────────────────────────────────────────────────────
  if (pendingVerification) {
    const isFilled = digits.every(d => d !== '');
    return (
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={s.backBtn} onPress={() => { setPendingVerification(false); setDigits(['','','','','','']); setError(''); }} activeOpacity={0.6}>
            <Ionicons name="arrow-back" size={22} color="#888888" />
          </TouchableOpacity>

          <View style={s.verifyContent}>
            <Text style={s.headline}>Check your email</Text>
            <Text style={s.verifySub}>
              We sent a 6-digit code to{'\n'}
              <Text style={s.emailHighlight}>{email}</Text>
            </Text>

            <View style={s.boxRow}>
              {digits.map((d, i) => (
                <TextInput
                  key={i}
                  ref={digitRefs[i]}
                  style={[s.box, d && s.boxFilled]}
                  value={d}
                  onChangeText={(t) => handleDigit(t, i)}
                  onKeyPress={(e) => handleKeyPress(e, i)}
                  keyboardType="number-pad"
                  maxLength={1}
                  textAlign="center"
                  selectTextOnFocus
                />
              ))}
            </View>

            {error ? <Text style={s.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[s.ctaBtn, (!isFilled || verifyLoading) && s.ctaDisabled]}
              onPress={() => handleVerify()}
              disabled={!isFilled || verifyLoading}
              activeOpacity={0.85}
            >
              {verifyLoading
                ? <ActivityIndicator color="#080808" size="small" />
                : <Text style={s.ctaTxt}>Verify Email</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={s.resendBtn} onPress={handleResend} disabled={resendCountdown > 0} activeOpacity={0.7}>
              <Text style={[s.resendTxt, resendCountdown > 0 && s.resendDisabled]}>
                {resendCountdown > 0 ? `Resend code in ${resendCountdown}s` : 'Resend code'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Sign-up form view ────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.6}>
            <Ionicons name="arrow-back" size={22} color="#888888" />
          </TouchableOpacity>

          <Text style={s.headline}>Create Account</Text>

          <Text style={s.continueWith}>Continue with</Text>
          <View style={s.socialRow}>
            <TouchableOpacity style={s.appleBtn} onPress={handleApple} activeOpacity={0.85}>
              <Ionicons name="logo-apple" size={20} color="#000000" />
              <Text style={s.appleTxt}>Apple</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.googleBtn} onPress={handleGoogle} activeOpacity={0.85}>
              <GoogleIcon />
              <Text style={s.googleTxt}>Google</Text>
            </TouchableOpacity>
          </View>

          <View style={s.divider}>
            <View style={s.divLine} />
            <Text style={s.divOr}>or</Text>
            <View style={s.divLine} />
          </View>

          {!showEmailForm ? (
            <TouchableOpacity onPress={revealEmailForm} style={s.emailRevealBtn} activeOpacity={0.85}>
              <Text style={s.emailRevealText}>Continue with Email</Text>
            </TouchableOpacity>
          ) : (
            <>
              <FormInput placeholder="First Name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
              <FormInput placeholder="Last Name"  value={lastName}  onChangeText={setLastName}  autoCapitalize="words" />
              <FormInput placeholder="Username"   value={username}  onChangeText={setUsername} />
              <FormInput placeholder="Email"      value={email}     onChangeText={setEmail}     keyboardType="email-address" />
              <FormInput
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                showToggle
                showing={showPw}
                onToggle={() => setShowPw(v => !v)}
              />

              {error ? <Text style={s.error}>{error}</Text> : null}

              <TouchableOpacity
                style={[s.ctaBtn, loading && s.ctaDisabled]}
                onPress={handleSubmit}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#080808" size="small" />
                  : <Text style={s.ctaTxt}>Create Account</Text>}
              </TouchableOpacity>
            </>
          )}

          <Text style={s.footer}>
            By continuing you agree to our Terms of Service and Privacy Policy
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080808' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: 40 },

  backBtn: {
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 8,
    alignSelf: 'flex-start',
  },

  headline: {
    fontSize: 32,
    fontWeight: '800',
    color: '#F5F5F0',
    textAlign: 'center',
    paddingHorizontal: 28,
    marginTop: 140,
    marginBottom: 36,
  },

  continueWith: {
    fontSize: 12,
    fontWeight: '600',
    color: '#444444',
    textAlign: 'center',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 14,
  },

  socialRow: {
    flexDirection: 'row',
    marginHorizontal: 28,
    gap: 12,
    marginBottom: 24,
  },
  appleBtn: {
    flex: 1,
    backgroundColor: '#F5F5F0',
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  appleTxt: { fontSize: 14, fontWeight: '600', color: '#080808' },
  googleBtn: {
    flex: 1,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  googleTxt: { fontSize: 14, fontWeight: '600', color: '#F5F5F0' },

  divider: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 28, marginBottom: 24 },
  divLine:  { flex: 1, height: 1, backgroundColor: '#1e1e1e' },
  divOr:    { color: '#444444', fontSize: 12, marginHorizontal: 12, fontWeight: '500' },

  emailRevealBtn: {
    backgroundColor: '#00E87A',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 28,
    alignItems: 'center',
  },
  emailRevealText: { fontSize: 15, fontWeight: '700', color: '#080808' },

  error: {
    color: '#FF4444',
    fontSize: 12,
    marginHorizontal: 28,
    marginTop: -6,
    marginBottom: 8,
    lineHeight: 18,
  },

  ctaBtn: {
    backgroundColor: '#00E87A',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 28,
    alignItems: 'center',
    marginTop: 8,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaTxt: { fontSize: 15, fontWeight: '700', color: '#080808' },

  footer: {
    fontSize: 11,
    color: '#2a2a2a',
    textAlign: 'center',
    paddingHorizontal: 32,
    marginTop: 24,
    lineHeight: 17,
  },

  // Verification view
  verifyContent: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 40,
  },
  verifySub: {
    fontSize: 14,
    color: '#555555',
    lineHeight: 22,
    marginBottom: 40,
  },
  emailHighlight: {
    color: '#F5F5F0',
    fontWeight: '600',
  },
  boxRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
    justifyContent: 'center',
  },
  box: {
    width: 46,
    height: 58,
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 12,
    fontSize: 24,
    fontWeight: '700',
    color: '#F5F5F0',
  },
  boxFilled: {
    borderColor: '#00E87A',
  },
  resendBtn: { alignItems: 'center', paddingVertical: 8, marginTop: 8 },
  resendTxt: { fontSize: 13, color: '#555555' },
  resendDisabled: { color: '#333333' },
});
