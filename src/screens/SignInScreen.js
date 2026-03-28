/**
 * SignInScreen — Premium Chalky welcome screen.
 * Sign In / Create Account with Apple, Google, and Email auth via Clerk.
 */
import React, { useState } from 'react';
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
} from 'react-native';
import { useSignIn, useSignUp, useOAuth } from '@clerk/clerk-expo';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { API_URL } from '../config';

WebBrowser.maybeCompleteAuthSession();

const CHALKY_PNG = require('../../assets/chalky.png');
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── OAuth handlers ────────────────────────────────────────────────────────────

function useAppleSignIn() {
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_apple' });
  return async () => {
    try {
      const { createdSessionId, setActive } = await startOAuthFlow({
        redirectUrl: Linking.createURL('/', { scheme: 'chalky' }),
      });
      if (createdSessionId) {
        await setActive({ session: createdSessionId });
      }
    } catch (err) {
      console.error('Apple auth error:', err);
    }
  };
}

function useGoogleSignIn() {
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' });
  return async () => {
    try {
      const { createdSessionId, setActive } = await startOAuthFlow({
        redirectUrl: Linking.createURL('/', { scheme: 'chalky' }),
      });
      if (createdSessionId) {
        await setActive({ session: createdSessionId });
      }
    } catch (err) {
      console.error('Google auth error:', err);
    }
  };
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SignInScreen() {
  const { signIn, setActive: setSignInActive, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setSignUpActive, isLoaded: signUpLoaded } = useSignUp();

  const handleAppleSignIn = useAppleSignIn();
  const handleGoogleSignIn = useGoogleSignIn();

  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'verify'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);
  const [usernameFocused, setUsernameFocused] = useState(false);

  async function handleSignIn() {
    if (!signInLoaded) return;
    setLoading(true);
    setError('');
    try {
      const result = await signIn.create({ identifier: email, password });
      if (result.status === 'complete') {
        await setSignInActive({ session: result.createdSessionId });
      } else {
        setError('Sign in incomplete. Please try again.');
      }
    } catch (e) {
      setError(clerkErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp() {
    if (!signUpLoaded) return;
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await signUp.create({ emailAddress: email, password, username });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setMode('verify');
    } catch (e) {
      setError(clerkErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!signUpLoaded) return;
    setLoading(true);
    setError('');
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === 'complete') {
        await setSignUpActive({ session: result.createdSessionId });
      } else {
        setError('Verification incomplete. Try again.');
      }
    } catch (e) {
      setError(clerkErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // ── Verify screen ──────────────────────────────────────────────────────────
  if (mode === 'verify') {
    return (
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.verifyInner}>
            <Image source={CHALKY_PNG} style={styles.verifyAvatar} resizeMode="contain" />
            <Text style={styles.verifyTitle}>Check your email</Text>
            <Text style={styles.verifySub}>
              We sent a 6-digit code to{'\n'}
              <Text style={styles.verifyEmail}>{email}</Text>
            </Text>

            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              placeholderTextColor="#444444"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.ctaBtn, loading && styles.ctaBtnDisabled]}
              onPress={handleVerify}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#080808" />
                : <Text style={styles.ctaBtnText}>Verify & Enter</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => { setMode('signup'); setError(''); }}>
              <Text style={styles.switchLink}>Wrong email? Go back</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const isSignUp = mode === 'signup';

  return (
    <SafeAreaView style={styles.safe}>
      {/* Radial green glow behind avatar */}
      <View style={styles.glowAbsolute} pointerEvents="none" />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* ── Hero section ── */}
          <View style={styles.heroSection}>
            <Image source={CHALKY_PNG} style={styles.heroAvatar} resizeMode="contain" />
            <Text style={styles.appName}>CHALKY</Text>
            <Text style={styles.tagline}>The edge has a name.</Text>
          </View>

          {/* ── Auth section ── */}
          <View style={styles.authSection}>
            {/* Mode toggle */}
            <View style={styles.authToggle}>
              <TouchableOpacity
                style={[styles.toggleBtn, mode === 'signin' && styles.toggleBtnActive]}
                onPress={() => { setMode('signin'); setError(''); }}
                activeOpacity={0.75}
              >
                <Text style={[styles.toggleText, mode === 'signin' && styles.toggleTextActive]}>
                  Sign In
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleBtn, mode === 'signup' && styles.toggleBtnActive]}
                onPress={() => { setMode('signup'); setError(''); }}
                activeOpacity={0.75}
              >
                <Text style={[styles.toggleText, mode === 'signup' && styles.toggleTextActive]}>
                  Create Account
                </Text>
              </TouchableOpacity>
            </View>

            {/* Social buttons */}
            <TouchableOpacity style={styles.appleBtn} onPress={handleAppleSignIn} activeOpacity={0.85}>
              <View style={styles.socialBtnInner}>
                <Text style={styles.appleLogo}></Text>
                <Text style={styles.appleBtnText}>Continue with Apple</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.googleBtn} onPress={handleGoogleSignIn} activeOpacity={0.85}>
              <View style={styles.socialBtnInner}>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={styles.googleBtnText}>Continue with Google</Text>
              </View>
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Username — sign up only */}
            {isSignUp && (
              <>
                <TextInput
                  style={[styles.input, usernameFocused && styles.inputFocused]}
                  placeholder="Username"
                  placeholderTextColor="#444444"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onFocus={() => setUsernameFocused(true)}
                  onBlur={() => setUsernameFocused(false)}
                />
              </>
            )}

            {/* Email */}
            <TextInput
              style={[styles.input, emailFocused && styles.inputFocused]}
              placeholder="Email"
              placeholderTextColor="#444444"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
            />

            {/* Password */}
            <View style={[styles.inputWrap, passwordFocused && styles.inputWrapFocused]}>
              <TextInput
                style={styles.inputInner}
                placeholder="Password"
                placeholderTextColor="#444444"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={showPassword ? 'eye-off' : 'eye'}
                  size={18}
                  color="#444444"
                />
              </TouchableOpacity>
            </View>

            {/* Confirm password — sign up only */}
            {isSignUp && (
              <View style={[styles.inputWrap, confirmFocused && styles.inputWrapFocused]}>
                <TextInput
                  style={styles.inputInner}
                  placeholder="Confirm Password"
                  placeholderTextColor="#444444"
                  secureTextEntry={!showConfirm}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  onFocus={() => setConfirmFocused(true)}
                  onBlur={() => setConfirmFocused(false)}
                />
                <TouchableOpacity
                  onPress={() => setShowConfirm(!showConfirm)}
                  style={styles.eyeBtn}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={showConfirm ? 'eye-off' : 'eye'}
                    size={18}
                    color="#444444"
                  />
                </TouchableOpacity>
              </View>
            )}

            {/* Error */}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {/* CTA */}
            <TouchableOpacity
              style={[styles.ctaBtn, loading && styles.ctaBtnDisabled]}
              onPress={isSignUp ? handleSignUp : handleSignIn}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#080808" />
                : <Text style={styles.ctaBtnText}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>}
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <Text style={styles.footer}>
            By continuing you agree to Chalky's Terms of Service.{'\n'}18+ only. Bet responsibly.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function clerkErrorMessage(e) {
  if (e?.errors?.[0]?.longMessage) return e.errors[0].longMessage;
  if (e?.errors?.[0]?.message) return e.errors[0].message;
  return 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#080808',
  },
  flex: { flex: 1 },

  // Background glow
  glowAbsolute: {
    position: 'absolute',
    top: 0,
    left: '50%',
    marginLeft: -140,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: '#00E87A',
    opacity: 0.06,
  },

  scrollContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },

  // ── Hero ───────────────────────────────────────────────────────────────────
  heroSection: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 52,
  },
  heroAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  appName: {
    fontSize: 52,
    fontWeight: '900',
    color: '#F5F5F0',
    letterSpacing: 6,
    marginTop: 16,
    lineHeight: 56,
  },
  tagline: {
    fontSize: 15,
    color: '#888888',
    marginTop: 8,
    letterSpacing: 0.2,
  },

  // ── Auth section ───────────────────────────────────────────────────────────
  authSection: {
    gap: 12,
  },

  // Toggle
  authToggle: {
    flexDirection: 'row',
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 4,
    marginHorizontal: 24,
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    borderRadius: 9,
  },
  toggleBtnActive: {
    backgroundColor: '#1a1a1a',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#888888',
  },
  toggleTextActive: {
    color: '#F5F5F0',
    fontWeight: '700',
  },

  // Social buttons
  appleBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    marginHorizontal: 24,
  },
  appleBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  appleLogo: {
    fontSize: 18,
    color: '#000000',
    marginRight: 8,
    lineHeight: 22,
  },
  googleBtn: {
    backgroundColor: '#141414',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingVertical: 14,
    marginHorizontal: 24,
  },
  googleBtnText: {
    color: '#F5F5F0',
    fontSize: 15,
    fontWeight: '600',
  },
  googleIcon: {
    fontSize: 16,
    fontWeight: '800',
    color: '#4285F4',
    marginRight: 8,
  },
  socialBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Divider
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1e1e1e',
  },
  dividerText: {
    color: '#444444',
    fontSize: 12,
    marginHorizontal: 12,
    fontWeight: '500',
  },

  // Inputs
  input: {
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    color: '#F5F5F0',
    fontSize: 15,
    marginHorizontal: 24,
  },
  inputFocused: {
    borderColor: '#00E87A',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 12,
    marginHorizontal: 24,
  },
  inputWrapFocused: {
    borderColor: '#00E87A',
  },
  inputInner: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 18,
    color: '#F5F5F0',
    fontSize: 15,
  },
  eyeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },

  // Error
  errorText: {
    color: '#FF4444',
    fontSize: 12,
    marginHorizontal: 28,
    marginTop: -4,
  },

  // CTA
  ctaBtn: {
    backgroundColor: '#00E87A',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 24,
    alignItems: 'center',
    marginTop: 4,
  },
  ctaBtnDisabled: {
    opacity: 0.6,
  },
  ctaBtnText: {
    color: '#080808',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // Footer
  footer: {
    fontSize: 11,
    color: '#3a3a3a',
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: 32,
    marginTop: 28,
  },

  // ── Verify screen ──────────────────────────────────────────────────────────
  verifyInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  verifyAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: 8,
  },
  verifyTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F5F5F0',
    letterSpacing: -0.5,
  },
  verifySub: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 22,
  },
  verifyEmail: {
    color: '#F5F5F0',
    fontWeight: '600',
  },
  codeInput: {
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    color: '#F5F5F0',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 10,
    textAlign: 'center',
    alignSelf: 'stretch',
    marginTop: 8,
  },
  switchLink: {
    fontSize: 13,
    color: '#555555',
    textDecorationLine: 'underline',
    marginTop: 4,
  },
});
