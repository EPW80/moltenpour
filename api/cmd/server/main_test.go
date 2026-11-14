package main

import "testing"

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
