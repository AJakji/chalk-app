/**
 * ResearchComponents — inline visual components rendered inside Chalky's chat responses.
 * All built from pure React Native Views — no chart library required.
 *
 * Exports:
 *   FormattedText       — renders **text** as green highlighted spans
 *   ComponentRenderer   — legacy component switcher (bar_chart, matchup_card, odds_comparison)
 *   ResearchVisual      — new rich visual switcher (stat_card, last10_grid, trend_chart,
 *                         comparison_bar, odds_table, game_card)
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Linking,
} from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { AFFILIATE_LINKS } from '../../config';

// ── Shared fade-in wrapper ────────────────────────────────────────────────────

function FadeCard({ delay = 0, children, style }) {
  const opacity   = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(6)).current;

  useEffect(() => {
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity,    { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 350, useNativeDriver: true }),
      ]).start();
    }, delay);
  }, []);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

// ── FormattedText — renders **text** as green highlighted spans ───────────────

export function FormattedText({ text, style }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={styles.highlight}>{part}</Text>
        ) : (
          part
        )
      )}
    </Text>
  );
}

// ── AnimatedBar sub-component ─────────────────────────────────────────────────

function AnimatedBar({ value, max, delay, color = colors.green }) {
  const width = useRef(new Animated.Value(0)).current;
  const pct   = Math.max(0, Math.min(1, value / Math.max(max, 1)));

  useEffect(() => {
    setTimeout(() => {
      Animated.timing(width, { toValue: pct, duration: 550, useNativeDriver: false }).start();
    }, delay);
  }, []);

  return (
    <Animated.View
      style={[
        styles.barFill,
        {
          backgroundColor: color,
          width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          maxWidth: `${pct * 100}%`,
        },
      ]}
    />
  );
}

// ── LEGACY: BarChart ──────────────────────────────────────────────────────────

export function BarChart({ title, bars, delay = 0 }) {
  return (
    <FadeCard delay={delay} style={styles.card}>
      <Text style={styles.cardLabel}>{title}</Text>
      {bars.map((bar, i) => (
        <View key={i} style={styles.barRow}>
          <Text style={styles.barLabel}>{bar.label}</Text>
          <View style={styles.barTrack}>
            <AnimatedBar value={bar.value} max={bar.max} delay={delay + i * 120} />
          </View>
          <Text style={styles.barValue}>{bar.value}</Text>
        </View>
      ))}
    </FadeCard>
  );
}

// ── LEGACY: ConfidenceMeter ───────────────────────────────────────────────────

export function ConfidenceMeter({ pick, confidence, delay = 0 }) {
  const meterColor =
    confidence >= 75 ? colors.green : confidence >= 60 ? '#F5A623' : colors.red;
  const label =
    confidence >= 75 ? 'HIGH CONFIDENCE' : confidence >= 60 ? 'MODERATE' : 'LEAN';

  return (
    <FadeCard delay={delay} style={styles.card}>
      <Text style={styles.cardLabel}>CHALKY'S PICK</Text>
      <Text style={styles.pickText}>{pick}</Text>
      <View style={styles.meterRow}>
        <View style={styles.meterTrack}>
          <AnimatedBar value={confidence} max={100} delay={delay + 100} color={meterColor} />
        </View>
        <Text style={[styles.meterValue, { color: meterColor }]}>{confidence}%</Text>
      </View>
      <Text style={[styles.confidenceLabel, { color: meterColor }]}>{label}</Text>
    </FadeCard>
  );
}

// ── LEGACY: OddsCard ──────────────────────────────────────────────────────────

export function OddsCard({ books, bestBook, delay = 0 }) {
  const bestBookObj = books.find((b) => b.key === bestBook) || books[0];

  return (
    <FadeCard delay={delay} style={styles.card}>
      <Text style={styles.cardLabel}>BEST ODDS</Text>
      {books.map((b) => {
        const isBest = b.key === bestBook;
        return (
          <View key={b.key} style={[styles.oddsRow, isBest && styles.oddsRowBest]}>
            <Text style={[styles.oddsBook, isBest && styles.oddsBookBest]}>{b.name}</Text>
            <Text style={[styles.oddsValue, isBest && styles.oddsValueBest]}>{b.odds}</Text>
            {isBest && (
              <View style={styles.bestTag}>
                <Text style={styles.bestTagText}>BEST</Text>
              </View>
            )}
          </View>
        );
      })}
      {bestBookObj && (
        <TouchableOpacity
          style={styles.betBtn}
          onPress={() => Linking.openURL(AFFILIATE_LINKS[bestBook] || AFFILIATE_LINKS.draftkings)}
          activeOpacity={0.8}
        >
          <Text style={styles.betBtnText}>Bet on {bestBookObj.name} →</Text>
        </TouchableOpacity>
      )}
    </FadeCard>
  );
}

// ── LEGACY: MatchupCard ───────────────────────────────────────────────────────

export function MatchupCard({ away, home, stats, delay = 0 }) {
  return (
    <FadeCard delay={delay} style={styles.card}>
      <Text style={styles.cardLabel}>MATCHUP</Text>
      <View style={styles.matchupHeader}>
        <Text style={styles.teamName} numberOfLines={1}>{away.name}</Text>
        <Text style={styles.vsText}>vs</Text>
        <Text style={styles.teamName} numberOfLines={1}>{home.name}</Text>
      </View>
      {stats.map((s, i) => (
        <View key={i} style={styles.statRow}>
          <Text style={[styles.statVal, s.awayWins && styles.statValBest]}>{s.away}</Text>
          <Text style={styles.statLabel}>{s.label}</Text>
          <Text style={[styles.statVal, !s.awayWins && styles.statValBest]}>{s.home}</Text>
        </View>
      ))}
    </FadeCard>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW RICH VISUAL COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

// ── StatCard ──────────────────────────────────────────────────────────────────

export function StatCard({ data, delay = 0 }) {
  const { playerName, team, sport, stats = [], trend, trendLabel } = data;
  const trendColor = trend === 'up' ? colors.green : trend === 'down' ? colors.red : colors.grey;
  const trendArrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';

  return (
    <FadeCard delay={delay} style={styles.card}>
      {/* Header */}
      <View style={styles.scHeader}>
        <View>
          <Text style={styles.scPlayerName}>{playerName}</Text>
          {(team || sport) && (
            <Text style={styles.scTeamSport}>{[team, sport].filter(Boolean).join(' · ')}</Text>
          )}
        </View>
        {trend && (
          <View style={[styles.scTrendBadge, { borderColor: trendColor + '44', backgroundColor: trendColor + '18' }]}>
            <Text style={[styles.scTrendArrow, { color: trendColor }]}>{trendArrow}</Text>
            {trendLabel && (
              <Text style={[styles.scTrendLabel, { color: trendColor }]} numberOfLines={1}>
                {trendLabel}
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Stats grid */}
      <View style={styles.scGrid}>
        {stats.map((s, i) => (
          <View key={i} style={styles.scStatBox}>
            <Text style={styles.scStatValue}>{s.value}</Text>
            <Text style={styles.scStatLabel}>{s.label}</Text>
            {s.context && <Text style={styles.scStatContext}>{s.context}</Text>}
          </View>
        ))}
      </View>
    </FadeCard>
  );
}

// ── Last10Grid ────────────────────────────────────────────────────────────────

export function Last10Grid({ data, delay = 0 }) {
  const { playerName, statLabel, propLine, games = [], average, overCount, underCount } = data;
  const [tooltip, setTooltip] = useState(null); // { index, game }

  return (
    <FadeCard delay={delay} style={styles.card}>
      {/* Header */}
      <View style={styles.l10Header}>
        <View>
          <Text style={styles.l10PlayerName}>{playerName}</Text>
          <Text style={styles.l10StatLabel}>{statLabel}{propLine != null ? ` — Line ${propLine}` : ''}</Text>
        </View>
        {(overCount != null && underCount != null) && (
          <View style={styles.l10SummaryBadge}>
            <Text style={styles.l10SummaryText}>
              <Text style={{ color: colors.green }}>{overCount}</Text>
              <Text style={styles.l10SummarySlash}>/</Text>
              <Text style={{ color: colors.grey }}>{overCount + underCount}</Text>
            </Text>
            <Text style={styles.l10SummaryOver}>OVER</Text>
          </View>
        )}
      </View>

      {/* Tiles */}
      <View style={styles.l10Tiles}>
        {games.map((g, i) => {
          const isOver = g.overLine;
          const isActive = tooltip?.index === i;
          return (
            <TouchableOpacity
              key={i}
              style={[
                styles.l10Tile,
                { backgroundColor: isOver ? colors.green + '33' : colors.red + '22',
                  borderColor: isOver ? colors.green + '66' : colors.red + '44',
                  borderWidth: isActive ? 1.5 : 1,
                },
              ]}
              onPress={() => setTooltip(isActive ? null : { index: i, game: g })}
              activeOpacity={0.75}
            >
              <Text style={[styles.l10TileValue, { color: isOver ? colors.green : colors.red }]}>
                {g.value}
              </Text>
              <Text style={styles.l10TileOpp}>{g.opp}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Tooltip */}
      {tooltip && (
        <View style={styles.l10Tooltip}>
          <Text style={styles.l10TooltipText}>
            {tooltip.game.date} vs {tooltip.game.opp} — <Text style={{ color: tooltip.game.overLine ? colors.green : colors.red, fontWeight: '700' }}>{tooltip.game.value} {statLabel}</Text>
            {propLine != null ? ` (line: ${propLine})` : ''}
          </Text>
        </View>
      )}

      {/* Average line */}
      {average != null && (
        <Text style={styles.l10Avg}>L10 avg: {average} {statLabel?.toLowerCase()}</Text>
      )}
    </FadeCard>
  );
}

// ── TrendChart — custom sparkline with interactive bars ───────────────────────

export function TrendChart({ data, delay = 0 }) {
  const { playerName, statLabel, propLine, dataPoints = [], seasonAvg, l10Avg, l5Avg } = data;
  const [activePoint, setActivePoint] = useState(null);

  const values = dataPoints.map(p => p.value).filter(v => typeof v === 'number');
  if (values.length === 0) return null;

  const maxVal   = Math.max(...values, propLine || 0, seasonAvg || 0);
  const minVal   = Math.min(...values);
  const range    = maxVal - minVal || 1;
  const barHeight = 80;

  return (
    <FadeCard delay={delay} style={styles.card}>
      {/* Header */}
      <Text style={styles.l10PlayerName}>{playerName}</Text>
      <Text style={styles.l10StatLabel}>{statLabel} — last {dataPoints.length} games</Text>

      {/* Chart */}
      <View style={styles.tcChartWrap}>
        {/* Season avg line */}
        {seasonAvg != null && (
          <View
            style={[styles.tcRefLine, {
              bottom: ((seasonAvg - minVal) / range) * barHeight,
              borderColor: colors.grey + '55',
            }]}
          />
        )}
        {/* Prop line */}
        {propLine != null && (
          <View
            style={[styles.tcRefLine, {
              bottom: ((propLine - minVal) / range) * barHeight,
              borderColor: colors.green + '88',
              borderStyle: 'dashed',
            }]}
          />
        )}

        {/* Bars */}
        <View style={styles.tcBars}>
          {dataPoints.map((p, i) => {
            const heightPct = ((p.value - minVal) / range);
            const isOver = propLine != null ? p.value > propLine : p.value >= (seasonAvg || 0);
            const isActive = activePoint?.game === p.game;
            return (
              <TouchableOpacity
                key={i}
                style={styles.tcBarCol}
                onPress={() => setActivePoint(isActive ? null : p)}
                activeOpacity={0.7}
              >
                <View style={styles.tcBarTrack}>
                  <TcBar
                    heightPct={heightPct}
                    barHeight={barHeight}
                    color={isOver ? colors.green : colors.red}
                    isActive={isActive}
                    delay={delay + i * 25}
                  />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Active point tooltip */}
      {activePoint && (
        <View style={styles.tcTooltip}>
          <Text style={styles.tcTooltipText}>
            {activePoint.date}{activePoint.opp ? ` vs ${activePoint.opp}` : ''} — <Text style={{ fontWeight: '700', color: colors.offWhite }}>{activePoint.value}</Text>
          </Text>
        </View>
      )}

      {/* Summary row */}
      <View style={styles.tcSummary}>
        {l5Avg != null && <View style={styles.tcSummaryItem}><Text style={styles.tcSumVal}>{l5Avg}</Text><Text style={styles.tcSumLabel}>L5</Text></View>}
        {l10Avg != null && <View style={styles.tcSummaryItem}><Text style={styles.tcSumVal}>{l10Avg}</Text><Text style={styles.tcSumLabel}>L10</Text></View>}
        {seasonAvg != null && <View style={styles.tcSummaryItem}><Text style={styles.tcSumVal}>{seasonAvg}</Text><Text style={styles.tcSumLabel}>Season</Text></View>}
        {propLine != null && <View style={styles.tcSummaryItem}><Text style={[styles.tcSumVal, { color: colors.green }]}>{propLine}</Text><Text style={styles.tcSumLabel}>Line</Text></View>}
      </View>
    </FadeCard>
  );
}

// Animated bar for TrendChart
function TcBar({ heightPct, barHeight, color, isActive, delay }) {
  const animH = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setTimeout(() => {
      Animated.timing(animH, { toValue: heightPct, duration: 450, useNativeDriver: false }).start();
    }, delay);
  }, []);

  const h = animH.interpolate({ inputRange: [0, 1], outputRange: [2, barHeight] });

  return (
    <Animated.View
      style={{
        height: h,
        width: '100%',
        backgroundColor: color + (isActive ? 'FF' : '99'),
        borderRadius: 2,
        alignSelf: 'flex-end',
      }}
    />
  );
}

// ── ComparisonBars ────────────────────────────────────────────────────────────

export function ComparisonBars({ data, delay = 0 }) {
  const { label, stats = [] } = data;
  if (!stats.length) return null;

  const awayTeam = stats[0]?.awayTeam || 'Away';
  const homeTeam = stats[0]?.homeTeam || 'Home';

  return (
    <FadeCard delay={delay} style={styles.card}>
      {/* Teams header */}
      <View style={styles.cbHeader}>
        <Text style={styles.cbTeam}>{awayTeam}</Text>
        {label ? <Text style={styles.cbVs}>vs</Text> : null}
        <Text style={styles.cbTeam}>{homeTeam}</Text>
      </View>
      {label && <Text style={styles.cbLabel}>{label}</Text>}

      {/* Stat rows */}
      {stats.map((s, i) => {
        const awayWins = s.higherIsBetter
          ? s.awayValue > s.homeValue
          : s.awayValue < s.homeValue;
        const maxVal = Math.max(Math.abs(s.awayValue), Math.abs(s.homeValue), 0.1);
        const awayPct = Math.abs(s.awayValue) / maxVal;
        const homePct = Math.abs(s.homeValue) / maxVal;

        return (
          <View key={i} style={styles.cbRow}>
            {/* Away bar (right-aligned) */}
            <View style={styles.cbBarWrapAway}>
              <Text style={[styles.cbVal, awayWins && { color: colors.green }]}>
                {s.awayValue}
              </Text>
              <CbBar pct={awayPct} color={awayWins ? colors.green : colors.border} delay={delay + i * 100} align="right" />
            </View>

            {/* Stat label center */}
            <View style={styles.cbStatLabel}>
              <Text style={styles.cbStatLabelText} numberOfLines={2}>{s.label}</Text>
            </View>

            {/* Home bar (left-aligned) */}
            <View style={styles.cbBarWrapHome}>
              <CbBar pct={homePct} color={!awayWins ? colors.green : colors.border} delay={delay + i * 100 + 50} align="left" />
              <Text style={[styles.cbVal, !awayWins && { color: colors.green }]}>
                {s.homeValue}
              </Text>
            </View>
          </View>
        );
      })}
    </FadeCard>
  );
}

function CbBar({ pct, color, delay, align }) {
  const width = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setTimeout(() => {
      Animated.timing(width, { toValue: pct, duration: 500, useNativeDriver: false }).start();
    }, delay);
  }, []);

  return (
    <View style={styles.cbTrack}>
      <Animated.View
        style={{
          height: 7,
          borderRadius: 3,
          backgroundColor: color,
          alignSelf: align === 'right' ? 'flex-end' : 'flex-start',
          width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
}

// ── OddsTable ─────────────────────────────────────────────────────────────────

export function OddsTable({ data, delay = 0 }) {
  const { title, rows = [], lineMovement } = data;
  const BOOKS = ['dk', 'fd', 'mgm', 'b365'];
  const BOOK_LABELS = { dk: 'DraftKings', fd: 'FanDuel', mgm: 'BetMGM', b365: 'Bet365' };
  const BOOK_KEYS   = { dk: 'draftkings', fd: 'fanduel', mgm: 'betmgm', b365: 'bet365' };

  return (
    <FadeCard delay={delay} style={styles.card}>
      {title && <Text style={styles.cardLabel}>{title}</Text>}

      {/* Book header row */}
      <View style={styles.otHeaderRow}>
        <View style={styles.otSideCol} />
        {BOOKS.map(b => (
          <View key={b} style={styles.otBookCol}>
            <Text style={styles.otBookLabel}>{BOOK_LABELS[b]}</Text>
          </View>
        ))}
      </View>

      {/* Data rows */}
      {rows.map((row, i) => (
        <View key={i} style={styles.otDataRow}>
          <View style={styles.otSideCol}>
            <Text style={styles.otSideText}>{row.label}</Text>
          </View>
          {BOOKS.map(b => {
            const isBest = row.best === BOOK_LABELS[b] || row.best === b;
            const odds   = row[b] || '—';
            return (
              <TouchableOpacity
                key={b}
                style={[styles.otBookCol, isBest && styles.otBestCell]}
                onPress={() => isBest && Linking.openURL(AFFILIATE_LINKS[BOOK_KEYS[b]] || AFFILIATE_LINKS.draftkings)}
                activeOpacity={isBest ? 0.8 : 1}
              >
                <Text style={[styles.otOdds, isBest && styles.otBestOdds]}>{odds}</Text>
                {isBest && <Text style={styles.otBestTag}>BEST</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      {lineMovement && (
        <Text style={styles.otLineMovement}>{lineMovement}</Text>
      )}
    </FadeCard>
  );
}

// ── GameCard ──────────────────────────────────────────────────────────────────

export function GameCard({ data, delay = 0 }) {
  const {
    sport, homeTeam, awayTeam, gameTime,
    spread, total, moneyline, keyStats = [], weather,
  } = data;

  return (
    <FadeCard delay={delay} style={styles.card}>
      {/* Teams */}
      <View style={styles.gcMatchup}>
        <Text style={styles.gcTeam}>{awayTeam}</Text>
        <View style={styles.gcCenter}>
          <Text style={styles.gcAt}>@</Text>
          {gameTime && <Text style={styles.gcTime}>{gameTime}</Text>}
        </View>
        <Text style={styles.gcTeam}>{homeTeam}</Text>
      </View>

      {/* Lines pills */}
      <View style={styles.gcPills}>
        {spread     && <View style={styles.gcPill}><Text style={styles.gcPillText}>{spread}</Text></View>}
        {total      && <View style={styles.gcPill}><Text style={styles.gcPillText}>{total}</Text></View>}
        {moneyline  && <View style={styles.gcPill}><Text style={styles.gcPillText}>{moneyline}</Text></View>}
      </View>

      {/* Key stats */}
      {keyStats.length > 0 && (
        <View style={styles.gcStats}>
          {keyStats.map((s, i) => (
            <View key={i} style={styles.gcStatRow}>
              <Text style={styles.gcStatDot}>·</Text>
              <Text style={styles.gcStatText}>{s}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Weather (MLB) */}
      {weather && (
        <View style={styles.gcWeather}>
          <Text style={styles.gcWeatherText}>⛅ {weather}</Text>
        </View>
      )}
    </FadeCard>
  );
}

// ── ResearchVisual — router for new rich visuals ──────────────────────────────

export function ResearchVisual({ visualData, delay = 0 }) {
  if (!visualData || !visualData.type || !visualData.data) return null;

  switch (visualData.type) {
    case 'stat_card':
      return <StatCard data={visualData.data} delay={delay} />;
    case 'last10_grid':
      return <Last10Grid data={visualData.data} delay={delay} />;
    case 'trend_chart':
      return <TrendChart data={visualData.data} delay={delay} />;
    case 'comparison_bar':
      return <ComparisonBars data={visualData.data} delay={delay} />;
    case 'odds_table':
      return <OddsTable data={visualData.data} delay={delay} />;
    case 'game_card':
      return <GameCard data={visualData.data} delay={delay} />;
    default:
      return null;
  }
}

// ── ComponentRenderer — legacy switcher ──────────────────────────────────────

export function ComponentRenderer({ component, index = 0 }) {
  const baseDelay = index * 150;
  switch (component.type) {
    case 'bar_chart':
      return <BarChart title={component.title} bars={component.bars} delay={baseDelay} />;
    case 'confidence_meter':
      return <ConfidenceMeter pick={component.pick} confidence={component.confidence} delay={baseDelay} />;
    case 'odds_comparison':
      return <OddsCard books={component.books} bestBook={component.bestBook} delay={baseDelay} />;
    case 'matchup_card':
      return <MatchupCard away={component.away} home={component.home} stats={component.stats} delay={baseDelay} />;
    default:
      return null;
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  highlight: {
    color: colors.green,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },

  // Legacy bar chart
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: spacing.sm },
  barLabel: { width: 70, fontSize: 12, color: colors.offWhite, fontWeight: '600' },
  barTrack: { flex: 1, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  barValue: { width: 32, fontSize: 12, color: colors.grey, textAlign: 'right', fontVariant: ['tabular-nums'] },

  // Legacy confidence meter
  pickText: { fontSize: 17, fontWeight: '800', color: colors.offWhite, letterSpacing: -0.3, marginBottom: spacing.sm },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meterTrack: { flex: 1, height: 10, backgroundColor: colors.border, borderRadius: 5, overflow: 'hidden' },
  meterValue: { fontSize: 16, fontWeight: '800', width: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },
  confidenceLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 6 },

  // Legacy odds card
  oddsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  oddsRowBest: { borderBottomColor: colors.green + '33' },
  oddsBook: { flex: 1, fontSize: 13, color: colors.grey, fontWeight: '500' },
  oddsBookBest: { color: colors.offWhite, fontWeight: '700' },
  oddsValue: { fontSize: 14, color: colors.grey, fontWeight: '600', fontVariant: ['tabular-nums'] },
  oddsValueBest: { color: colors.green, fontWeight: '800' },
  bestTag: { backgroundColor: colors.green + '22', borderRadius: radius.full, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: colors.green + '44' },
  bestTagText: { fontSize: 9, fontWeight: '800', color: colors.green, letterSpacing: 0.5 },
  betBtn: { marginTop: spacing.md, backgroundColor: colors.green, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center' },
  betBtnText: { fontSize: 13, fontWeight: '800', color: colors.background },

  // Legacy matchup card
  matchupHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm },
  teamName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.offWhite, textAlign: 'center' },
  vsText: { fontSize: 11, color: colors.grey, fontWeight: '600' },
  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  statVal: { flex: 1, fontSize: 13, color: colors.grey, textAlign: 'center', fontVariant: ['tabular-nums'] },
  statValBest: { color: colors.green, fontWeight: '700' },
  statLabel: { width: 90, fontSize: 11, color: colors.grey, textAlign: 'center', fontWeight: '500' },

  // ── StatCard ────────────────────────────────────────────────────────────────
  scHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.sm },
  scPlayerName: { fontSize: 15, fontWeight: '800', color: colors.offWhite, letterSpacing: -0.3 },
  scTeamSport: { fontSize: 11, color: colors.grey, marginTop: 2 },
  scTrendBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  scTrendArrow: { fontSize: 13, fontWeight: '800' },
  scTrendLabel: { fontSize: 11, fontWeight: '600', maxWidth: 120 },
  scGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  scStatBox: { flex: 1, minWidth: '22%', backgroundColor: colors.background, borderRadius: radius.sm, padding: spacing.sm, alignItems: 'center' },
  scStatValue: { fontSize: 20, fontWeight: '800', color: colors.offWhite, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  scStatLabel: { fontSize: 10, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 },
  scStatContext: { fontSize: 9, color: colors.grey + 'AA', marginTop: 1 },

  // ── Last10Grid ──────────────────────────────────────────────────────────────
  l10Header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  l10PlayerName: { fontSize: 14, fontWeight: '800', color: colors.offWhite },
  l10StatLabel: { fontSize: 11, color: colors.grey, marginTop: 2 },
  l10SummaryBadge: { alignItems: 'center' },
  l10SummaryText: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  l10SummarySlash: { color: colors.grey },
  l10SummaryOver: { fontSize: 9, fontWeight: '700', color: colors.grey, letterSpacing: 0.8, marginTop: -2 },
  l10Tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  l10Tile: { width: '8.5%', aspectRatio: 0.75, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  l10TileValue: { fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  l10TileOpp: { fontSize: 7, color: colors.grey, marginTop: 1 },
  l10Tooltip: { marginTop: spacing.sm, backgroundColor: colors.background, borderRadius: radius.sm, padding: spacing.sm },
  l10TooltipText: { fontSize: 12, color: colors.grey },
  l10Avg: { fontSize: 11, color: colors.grey, marginTop: spacing.sm },

  // ── TrendChart ──────────────────────────────────────────────────────────────
  tcChartWrap: { height: 90, marginTop: spacing.sm, marginBottom: spacing.xs, position: 'relative' },
  tcRefLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, height: 0 },
  tcBars: { flexDirection: 'row', alignItems: 'flex-end', height: 80, gap: 2 },
  tcBarCol: { flex: 1, height: 80, justifyContent: 'flex-end' },
  tcBarTrack: { height: 80, justifyContent: 'flex-end' },
  tcTooltip: { backgroundColor: colors.background, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.xs },
  tcTooltipText: { fontSize: 12, color: colors.grey },
  tcSummary: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  tcSummaryItem: { flex: 1, alignItems: 'center' },
  tcSumVal: { fontSize: 14, fontWeight: '800', color: colors.offWhite, fontVariant: ['tabular-nums'] },
  tcSumLabel: { fontSize: 9, color: colors.grey, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 },

  // ── ComparisonBars ──────────────────────────────────────────────────────────
  cbHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  cbTeam: { fontSize: 14, fontWeight: '800', color: colors.offWhite },
  cbVs: { fontSize: 11, color: colors.grey },
  cbLabel: { fontSize: 11, color: colors.grey, marginBottom: spacing.sm },
  cbRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: spacing.sm },
  cbBarWrapAway: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  cbBarWrapHome: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  cbTrack: { flex: 1, height: 7, backgroundColor: colors.background, borderRadius: 3, overflow: 'hidden' },
  cbVal: { fontSize: 12, fontWeight: '700', color: colors.grey, minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] },
  cbStatLabel: { width: 70, alignItems: 'center' },
  cbStatLabelText: { fontSize: 10, color: colors.grey, textAlign: 'center' },

  // ── OddsTable ────────────────────────────────────────────────────────────────
  otHeaderRow: { flexDirection: 'row', marginBottom: 6 },
  otSideCol: { flex: 2 },
  otBookCol: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  otBookLabel: { fontSize: 9, color: colors.grey, fontWeight: '600', textAlign: 'center' },
  otDataRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 6 },
  otSideText: { fontSize: 12, fontWeight: '600', color: colors.offWhite },
  otBestCell: { backgroundColor: colors.green + '15', borderRadius: radius.sm },
  otOdds: { fontSize: 13, fontWeight: '600', color: colors.grey, fontVariant: ['tabular-nums'], textAlign: 'center' },
  otBestOdds: { color: colors.green, fontWeight: '800' },
  otBestTag: { fontSize: 8, fontWeight: '800', color: colors.green, letterSpacing: 0.5, textAlign: 'center', marginTop: 1 },
  otLineMovement: { fontSize: 11, color: colors.grey, marginTop: spacing.sm, fontStyle: 'italic' },

  // ── GameCard ─────────────────────────────────────────────────────────────────
  gcMatchup: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  gcTeam: { fontSize: 16, fontWeight: '800', color: colors.offWhite },
  gcCenter: { alignItems: 'center' },
  gcAt: { fontSize: 12, color: colors.grey },
  gcTime: { fontSize: 11, color: colors.grey, marginTop: 2 },
  gcPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
  gcPill: { backgroundColor: colors.background, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.border },
  gcPillText: { fontSize: 12, fontWeight: '600', color: colors.offWhite },
  gcStats: { gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  gcStatRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  gcStatDot: { fontSize: 14, color: colors.grey, lineHeight: 18 },
  gcStatText: { flex: 1, fontSize: 12, color: colors.grey, lineHeight: 18 },
  gcWeather: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  gcWeatherText: { fontSize: 12, color: colors.grey },
});
