package main

import (
	"io"
	"log/slog"
	"testing"

	"moltenpour/api/pour"
)

func TestProductionConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name, environment, secret string
		maxTier                   int
		bad                       bool
	}{
		{"local defaults", "", "", 0, false},
		{"missing secret", "production", "", 0, true},
		{"published secret", "production", "moltenpour-development-secret-do-not-use-in-production", 0, true},
		{"unpaid paid tiers", "production", "private-test-secret", 1, true},
		{"free production", "production", "private-test-secret", 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateProduction(tc.environment, tc.secret, tc.maxTier); (err != nil) != tc.bad {
				t.Fatalf("error = %v, want refusal = %v", err, tc.bad)
			}
		})
	}
}

func TestClampTierCeiling(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	for _, tc := range []struct {
		name string
		in   int
		want int
	}{
		{"within range", 2, 2},
		{"at floor", 0, 0},
		{"below floor", -1, 0},
		{"at ceiling", pour.MaxTierIndex, pour.MaxTierIndex},
		{"above ceiling", pour.MaxTierIndex + 1, pour.MaxTierIndex},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := clampTierCeiling(tc.in, log); got != tc.want {
				t.Fatalf("clampTierCeiling(%d) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}
