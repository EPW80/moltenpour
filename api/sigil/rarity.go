package sigil

import "math"

// Rarity is what the pour earned, as opposed to what the pour cost.
//
// TWO AXES, DELIBERATELY SEPARATE:
//
//	tierIndex (0-5)  what was PURCHASED. Sets flow, price, and the certificate's
//	                 CONSIDERATION row.
//	Rarity           what was EARNED. Sets the accent pair, SUBSTANCE and
//	                 CLASSIFICATION.
//
// See the header of app/sigil/rarity.ts for why the certificate handoff's
// four-valued tier table could not represent both.
type Rarity string

const (
	Common   Rarity = "Common"
	Uncommon Rarity = "Uncommon"
	Rare     Rarity = "Rare"
	Singular Rarity = "Singular"
)

// Thresholds on the 0-1000 pour score. Provisional — calibrated against
// simulated pours to land Common near the 55% the certificate handoff expects,
// and to keep a max-legal claim at Rare-to-Singular on tiers 3-5 as the
// accepted-risk note in telemetry.ts asserts. Re-tune against the real ledger.
const (
	thresholdUncommon = 533
	thresholdRare     = 665
	thresholdSingular = 771
)

// How much of the achievable score each tier can reach: 0.55 at tier 0 rising
// to 1.00 at tier 5.
const (
	tierReachBase = 55.0
	tierReachStep = 9.0
)

// permille reduces a value to 0-1000 of its ceiling, with an explicit floor.
//
// IMPORTANT: the scoring is integer arithmetic on purpose. A score compared
// against a float threshold can flip rarity on a last-ulp difference between the
// two languages, which mints a different classification than the user previewed.
// IEEE-754 division and floor are exact and identical in both languages, but the
// order of these operations still has to match rarity.ts line for line.
func permille(value, max float64) float64 {
	if max <= 0 {
		return 0
	}
	p := math.Floor((value * 1000) / max)
	if p < 0 {
		return 0
	}
	if p > 1000 {
		return 1000
	}
	return p
}

func clampTierIndex(tierIndex int) int {
	if tierIndex < 0 {
		return 0
	}
	if tierIndex >= len(tierFlow) {
		return len(tierFlow) - 1
	}
	return tierIndex
}

// RarityScore mirrors rarityScore() in rarity.ts. Nothing here is random:
// rarity is a pure function of the clamped telemetry and the purchased tier,
// because the product brief forbids any suggestion of a randomized outcome.
func RarityScore(t Telemetry, tierIndex int) float64 {
	flow := tierFlow[clampTierIndex(tierIndex)]

	holdMs := math.Floor(t.HoldMs)
	holdS := holdMs / 1000

	// Ceilings, recomputed exactly as ClampTelemetry derived them.
	maxDroplets := math.Ceil(flow * holdS * simDropletTolerar)
	maxFall := simSpawnVyMax + simGravity*math.Min(holdS, 1.2)
	maxSpeed := jsRound(math.Sqrt(maxFall*maxFall+simSpawnVxMax*simSpawnVxMax) * 1.1)
	maxTiltMilli := jsRound(simMaxTiltRate * holdS * 1000)

	fill := permille(math.Floor(t.DropletsLanded), maxDroplets)
	force := permille(jsRound(t.PeakVelocity), maxSpeed)
	commitment := permille(holdMs, simMaxPourMs)
	// A steady hand is the skill the ceremony rewards, so tilt counts against
	// you. It is also why a max-everything cheat does not score perfectly.
	steadiness := 1000 - permille(jsRound(t.TiltEnergy*1000), maxTiltMilli)

	base := math.Floor((fill*40 + force*25 + commitment*20 + steadiness*15) / 100)

	reach := tierReachBase + tierReachStep*float64(clampTierIndex(tierIndex))
	return math.Floor((base * reach) / 100)
}

// Classify mirrors classify() in rarity.ts.
func Classify(t Telemetry, tierIndex int) Rarity {
	score := RarityScore(t, tierIndex)
	switch {
	case score >= thresholdSingular:
		return Singular
	case score >= thresholdRare:
		return Rare
	case score >= thresholdUncommon:
		return Uncommon
	default:
		return Common
	}
}
