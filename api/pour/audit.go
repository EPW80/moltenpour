package pour

import (
	"context"
	"database/sql"
	"fmt"
)

// The escalation triggers stated at the bottom of app/sigil/telemetry.ts. They
// are the accepted-risk note's review mechanism: a patched client minting
// max-legal telemetry shows up as either overclaims on more than 2% of pours,
// or a Singular share on tiers 3-5 above twice what the corpus models under
// uniform noise. Audit turns the raw log lines the server already emits into a
// check someone can run against a ledger.
const violationRateThreshold = 0.02

// ModeledSingularShare345 is the Singular share the committed corpus produces
// on tiers 3-5 under uniform-noise telemetry: 4 of its 150 such rows. It is the
// baseline the escalation's "twice the modeled rate" refers to, and it is pinned
// to the corpus by TestModeledSingularShareMatchesCorpus so a regenerated corpus
// cannot silently move the alarm.
const ModeledSingularShare345 = 4.0 / 150.0

// TierCount is one row of the per-tier table.
type TierCount struct {
	Tier  int
	Count int
}

// AuditReport is everything the audit prints and checks.
type AuditReport struct {
	Total           int
	HighestPosition int
	Tiers           []TierCount
	// Violations is the number of pours whose clamped telemetry overclaimed.
	Violations int
	// Singular345 is the number of Singular pours on tiers 3-5, the only rungs
	// that can reach Singular.
	Singular345 int
	Tiers345    int
}

// ViolationRate is the share of pours that overclaimed, over the whole ledger.
func (r AuditReport) ViolationRate() float64 {
	if r.Total == 0 {
		return 0
	}
	return float64(r.Violations) / float64(r.Total)
}

// SingularShare is the share of tiers 3-5 pours that reached Singular.
func (r AuditReport) SingularShare() float64 {
	if r.Tiers345 == 0 {
		return 0
	}
	return float64(r.Singular345) / float64(r.Tiers345)
}

// Alarms returns the escalation triggers the ledger has crossed, or nothing.
func (r AuditReport) Alarms() []string {
	var out []string
	if r.ViolationRate() > violationRateThreshold {
		out = append(out, fmt.Sprintf(
			"telemetry overclaims on %.2f%% of pours, above the %.2f%% threshold",
			r.ViolationRate()*100, violationRateThreshold*100,
		))
	}
	if r.SingularShare() > 2*ModeledSingularShare345 {
		out = append(out, fmt.Sprintf(
			"Singular share on tiers 3-5 is %.2f%%, above twice the %.2f%% modeled rate",
			r.SingularShare()*100, ModeledSingularShare345*100,
		))
	}
	return out
}

// Audit opens an existing ledger read-only and answers the two questions the
// escalation triggers are built from. It never writes, creates, or migrates.
func Audit(ctx context.Context, path string) (AuditReport, error) {
	db, err := openExistingSQLite(path)
	if err != nil {
		return AuditReport{}, fmt.Errorf("open ledger: %w", err)
	}
	defer db.Close()

	var r AuditReport
	if err := db.QueryRowContext(ctx,
		`SELECT COUNT(*), COALESCE(MAX(ledger_position), 0) FROM pours`,
	).Scan(&r.Total, &r.HighestPosition); err != nil {
		return AuditReport{}, fmt.Errorf("read ledger totals: %w", err)
	}

	rows, err := db.QueryContext(ctx,
		`SELECT tier_index, COUNT(*) FROM pours GROUP BY tier_index ORDER BY tier_index`)
	if err != nil {
		return AuditReport{}, fmt.Errorf("read tier counts: %w", err)
	}
	for rows.Next() {
		var tc TierCount
		if err := rows.Scan(&tc.Tier, &tc.Count); err != nil {
			rows.Close()
			return AuditReport{}, fmt.Errorf("scan tier count: %w", err)
		}
		r.Tiers = append(r.Tiers, tc)
	}
	if err := rows.Close(); err != nil {
		return AuditReport{}, fmt.Errorf("close tier counts: %w", err)
	}
	if err := rows.Err(); err != nil {
		return AuditReport{}, fmt.Errorf("iterate tier counts: %w", err)
	}

	if r.Violations, err = countOne(ctx, db,
		`SELECT COUNT(*) FROM pours WHERE violations <> '[]'`); err != nil {
		return AuditReport{}, fmt.Errorf("count overclaims: %w", err)
	}
	if r.Tiers345, err = countOne(ctx, db,
		`SELECT COUNT(*) FROM pours WHERE tier_index BETWEEN 3 AND 5`); err != nil {
		return AuditReport{}, fmt.Errorf("count tiers 3-5: %w", err)
	}
	if r.Singular345, err = countOne(ctx, db,
		`SELECT COUNT(*) FROM pours WHERE tier_index BETWEEN 3 AND 5 AND rarity = 'Singular'`); err != nil {
		return AuditReport{}, fmt.Errorf("count Singular: %w", err)
	}
	return r, nil
}

func countOne(ctx context.Context, db *sql.DB, query string, args ...any) (int, error) {
	var n int
	err := db.QueryRowContext(ctx, query, args...).Scan(&n)
	return n, err
}