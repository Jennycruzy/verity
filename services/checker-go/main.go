package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const fxRule = "fx-rate-v1"

var decimalPattern = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$`)

type checkerConfig struct {
	port         int
	checkerID    string
	maxBodyBytes int64
}

type checkRequest struct {
	RuleID string          `json:"ruleId"`
	Value  json.RawMessage `json:"value"`
}

type fxObservation struct {
	ExpectedRate *string `json:"expectedRate"`
	ActualRate   *string `json:"actualRate"`
	ToleranceBps *int64  `json:"toleranceBps"`
}

func main() {
	config, err := readConfig(os.LookupEnv)
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler(config))
	mux.HandleFunc("/check", checkHandler(config))
	server := &http.Server{
		Addr:              ":" + strconv.Itoa(config.port),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}
	log.Printf("checker=%s port=%d implementation=go", config.checkerID, config.port)
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func readConfig(lookup func(string) (string, bool)) (checkerConfig, error) {
	port, err := requiredPositiveInt(lookup, "CHECKER_PORT")
	if err != nil {
		return checkerConfig{}, err
	}
	checkerID, ok := lookup("CHECKER_ID")
	if !ok || strings.TrimSpace(checkerID) == "" {
		return checkerConfig{}, errors.New("VERITY_CHECKER_GO_CONFIG_MISSING: CHECKER_ID is required")
	}
	maxBodyBytes, err := requiredPositiveInt64(lookup, "CHECKER_MAX_BODY_BYTES")
	if err != nil {
		return checkerConfig{}, err
	}
	return checkerConfig{port: port, checkerID: strings.TrimSpace(checkerID), maxBodyBytes: maxBodyBytes}, nil
}

func requiredPositiveInt(lookup func(string) (string, bool), name string) (int, error) {
	value, ok := lookup(name)
	if !ok || strings.TrimSpace(value) == "" {
		return 0, fmt.Errorf("VERITY_CHECKER_GO_CONFIG_MISSING: %s is required", name)
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("VERITY_CHECKER_GO_CONFIG_INVALID: %s must be a positive integer", name)
	}
	return parsed, nil
}

func requiredPositiveInt64(lookup func(string) (string, bool), name string) (int64, error) {
	value, ok := lookup(name)
	if !ok || strings.TrimSpace(value) == "" {
		return 0, fmt.Errorf("VERITY_CHECKER_GO_CONFIG_MISSING: %s is required", name)
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("VERITY_CHECKER_GO_CONFIG_INVALID: %s must be a positive integer", name)
	}
	return parsed, nil
}

func healthHandler(config checkerConfig) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ok", "checker": config.checkerID, "implementation": "go"})
	}
}

func checkHandler(config checkerConfig) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		body, err := io.ReadAll(io.LimitReader(request.Body, config.maxBodyBytes+1))
		if err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "checker_body_read_failed"})
			return
		}
		if int64(len(body)) > config.maxBodyBytes {
			writeJSON(writer, http.StatusRequestEntityTooLarge, map[string]string{"error": "checker_body_too_large"})
			return
		}

		var input checkRequest
		if err := json.Unmarshal(body, &input); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "checker_json_invalid"})
			return
		}
		if input.RuleID != fxRule {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "checker_rule_unsupported", "expectedRule": fxRule})
			return
		}
		verdict, err := evaluateFX(input.Value)
		if err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusOK, verdict)
	}
}

func evaluateFX(raw json.RawMessage) (map[string]any, error) {
	var observation fxObservation
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&observation); err != nil {
		return nil, errors.New("VERITY_CHECKER_GO_VALUE_INVALID: FX value must contain only expectedRate, actualRate, and toleranceBps")
	}
	if observation.ExpectedRate == nil || observation.ActualRate == nil || observation.ToleranceBps == nil {
		return nil, errors.New("VERITY_CHECKER_GO_VALUE_INVALID: FX value requires expectedRate, actualRate, and toleranceBps")
	}
	if *observation.ToleranceBps < 0 || *observation.ToleranceBps > 10000 {
		return nil, errors.New("VERITY_CHECKER_GO_VALUE_INVALID: toleranceBps must be an integer from 0 through 10000")
	}
	expected, err := parseDecimal(*observation.ExpectedRate)
	if err != nil {
		return nil, err
	}
	actual, err := parseDecimal(*observation.ActualRate)
	if err != nil {
		return nil, err
	}
	difference := new(big.Rat).Sub(expected, actual)
	difference.Abs(difference)
	reference := new(big.Rat).Abs(new(big.Rat).Set(expected))
	left := new(big.Rat).Mul(difference, big.NewRat(10000, 1))
	right := new(big.Rat).Mul(reference, big.NewRat(*observation.ToleranceBps, 1))
	withinTolerance := left.Cmp(right) <= 0
	reasonCode := "RATE_OUTSIDE_TOLERANCE"
	verdict := "reject"
	if withinTolerance {
		reasonCode = "RATE_WITHIN_TOLERANCE"
		verdict = "accept"
	}
	return map[string]any{
		"verdict":    verdict,
		"ruleId":     fxRule,
		"reasonCode": reasonCode,
		"evidence": map[string]any{
			"expectedRate": *observation.ExpectedRate,
			"actualRate":   *observation.ActualRate,
			"toleranceBps": *observation.ToleranceBps,
		},
	}, nil
}

func parseDecimal(value string) (*big.Rat, error) {
	if !decimalPattern.MatchString(value) {
		return nil, fmt.Errorf("VERITY_CHECKER_GO_DECIMAL_INVALID: %s is not a canonical decimal", value)
	}
	negative := strings.HasPrefix(value, "-")
	unsigned := strings.TrimPrefix(value, "-")
	parts := strings.SplitN(unsigned, ".", 2)
	whole, ok := new(big.Int).SetString(parts[0], 10)
	if !ok {
		return nil, fmt.Errorf("VERITY_CHECKER_GO_DECIMAL_INVALID: %s is not a valid decimal", value)
	}
	denominator := big.NewInt(1)
	numerator := new(big.Int).Mul(whole, denominator)
	if len(parts) == 2 {
		fraction, ok := new(big.Int).SetString(parts[1], 10)
		if !ok {
			return nil, fmt.Errorf("VERITY_CHECKER_GO_DECIMAL_INVALID: %s is not a valid decimal", value)
		}
		denominator.Exp(big.NewInt(10), big.NewInt(int64(len(parts[1]))), nil)
		numerator.Mul(whole, denominator)
		numerator.Add(numerator, fraction)
	}
	result := new(big.Rat).SetFrac(numerator, denominator)
	if negative {
		result.Neg(result)
	}
	return result, nil
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("content-type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	if err := json.NewEncoder(writer).Encode(value); err != nil {
		log.Printf("checker response encoding failed: %v", err)
	}
}
