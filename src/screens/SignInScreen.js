/**
 * SignInScreen — "Welcome Back" sign in screen.
 */
import React, { useState, useRef } from 'react';
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
} from 'react-native';
import { useSignIn, useOAuth } from '@clerk/clerk-expo';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';

WebBrowser.maybeCompleteAuthSession();

// ── Shared input ──────────────────────────────────────────────────────────────

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
  input: { flex: 1, paddingVertical: 15, paddingHorizontal: 18, color: '#F5F5F0', fontSize: 15 },
  eye: { paddingHorizontal: 14, paddingVertical: 15 },
});

// ── OAuth helpers ─────────────────────────────────────────────────────────────

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

// ── Main ──────────────────────────────────────────────────────────────────────

export default function SignInScreen({ navigation }) {
  const { signIn, setActive, isLoaded } = useSignIn();
  const handleApple  = useApple();
  const handleGoogle = useGoogle();

  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleSubmit = async () => {
    if (!isLoaded) return;
    setLoading(true);
    setError('');
    try {
      const result = await signIn.create({ identifier: email, password });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
      } else {
        setError('Sign in incomplete. Please try again.');
      }
    } catch (e) {
      setError(e.errors?.[0]?.longMessage || e.errors?.[0]?.message || 'Invalid credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.6}>
            <Ionicons name="arrow-back" size={22} color="#888888" />
          </TouchableOpacity>

          {/* Headline */}
          <Text style={s.headline}>Welcome Back</Text>
          <Text style={s.sub}>Sign in to your account.</Text>

          {/* Social buttons */}
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
            <View style={s.divLine} />
            <Text style={s.divOr}>or</Text>
            <View style={s.divLine} />
          </View>

          {/* Email form */}
          <View style={s.form}>
            <FormInput
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
            />
            <FormInput
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              showToggle
              showing={showPw}
              onToggle={() => setShowPw(v => !v)}
            />

            {/* Forgot password */}
            <TouchableOpacity style={s.forgotBtn} activeOpacity={0.6}>
              <Text style={s.forgotTxt}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          {/* CTA */}
          <TouchableOpacity
            style={[s.ctaBtn, loading && s.ctaDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#080808" size="small" />
              : <Text style={s.ctaTxt}>Sign In</Text>}
          </TouchableOpacity>

          {/* Create account link */}
          <TouchableOpacity
            style={s.createLink}
            onPress={() => navigation.navigate('CreateAccount')}
            activeOpacity={0.7}
          >
            <Text style={s.createLinkTxt}>
              Don't have an account?{' '}
              <Text style={s.createLinkGreen}>Create one</Text>
            </Text>
          </TouchableOpacity>

          {/* Footer */}
          <Text style={s.footer}>
            Not financial advice. Bet responsibly.
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
    paddingHorizontal: 28,
    marginTop: 20,
    marginBottom: 8,
  },
  sub: {
    fontSize: 14,
    color: '#555555',
    paddingHorizontal: 28,
    marginBottom: 36,
  },

  // Social
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
  appleLogo: { fontSize: 18, color: '#080808', lineHeight: 22 },
  appleTxt:  { fontSize: 14, fontWeight: '600', color: '#080808' },
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
  googleG:   { fontSize: 16, fontWeight: '800', color: '#4285F4' },
  googleTxt: { fontSize: 14, fontWeight: '600', color: '#F5F5F0' },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 28, marginBottom: 24 },
  divLine:  { flex: 1, height: 1, backgroundColor: '#1e1e1e' },
  divOr:    { color: '#444444', fontSize: 12, marginHorizontal: 12, fontWeight: '500' },

  // Form
  form: { paddingHorizontal: 28 },

  forgotBtn: { alignItems: 'flex-end', marginTop: -4, marginBottom: 20 },
  forgotTxt: { fontSize: 12, color: '#555555' },

  // Error
  error: {
    color: '#FF4444',
    fontSize: 12,
    marginHorizontal: 28,
    marginBottom: 8,
    lineHeight: 18,
  },

  // CTA
  ctaBtn: {
    backgroundColor: '#00E87A',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 28,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.6 },
  ctaTxt: { fontSize: 15, fontWeight: '700', color: '#080808', letterSpacing: 0.3 },

  // Create account link
  createLink: { alignItems: 'center', marginTop: 16 },
  createLinkTxt: { fontSize: 13, color: '#555555' },
  createLinkGreen: { color: '#00E87A' },

  footer: {
    fontSize: 11,
    color: '#2a2a2a',
    textAlign: 'center',
    paddingHorizontal: 32,
    marginTop: 24,
    lineHeight: 17,
  },
});
