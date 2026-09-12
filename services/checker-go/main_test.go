package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEvaluateFXAtToleranceBoundary(t *testing.T) {
	result, err := evaluateFX(json.RawMessage(`{"expectedRate":"1.0000","actualRate":"1.0010","toleranceBps":10}`))
	if err != nil {
		t.Fatalf("evaluateFX returned error: %v", err)
	}
	if result["verdict"] != "accept" {
		t.Fatalf("expected accept, got %v", result["verdict"])
	}
}

func TestEvaluateFXOutsideTolerance(t *testing.T) {
	result, err := evaluateFX(json.RawMessage(`{"expectedRate":"1.0000","actualRate":"1.0011","toleranceBps":10}`))
	if err != nil {
		t.Fatalf("evaluateFX returned error: %v", err)
	}
	if result["verdict"] != "reject" {
		t.Fatalf("expected reject, got %v", result["verdict"])
	}
}

func TestEvaluateFXUsesExactDecimalArithmetic(t *testing.T) {
	result, err := evaluateFX(json.RawMessage(`{"expectedRate":"1000000000000000000","actualRate":"1000000000000000000.000000000000000001","toleranceBps":0}`))
	if err != nil {
		t.Fatalf("evaluateFX returned error: %v", err)
	}
	if result["verdict"] != "reject" {
		t.Fatalf("expected reject, got %v", result["verdict"])
	}
}

func TestCheckHandlerReturnsDeterministicSchema(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/check", jsonReader(`{"ruleId":"fx-rate-v1","value":{"expectedRate":"1.00","actualRate":"1.01","toleranceBps":100}}`))
	response := httptest.NewRecorder()
	checkHandler(checkerConfig{maxBodyBytes: 1024})(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("response was not JSON: %v", err)
	}
	if body["ruleId"] != fxRule || body["reasonCode"] != "RATE_WITHIN_TOLERANCE" {
		t.Fatalf("unexpected response: %v", body)
	}
}

func TestCheckHandlerRejectsOversizedBody(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/check", jsonReader(`{"ruleId":"fx-rate-v1","value":{}}`))
	response := httptest.NewRecorder()
	checkHandler(checkerConfig{maxBodyBytes: 4})(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", response.Code)
	}
}

func jsonReader(value string) *jsonReaderType {
	return &jsonReaderType{reader: strings.NewReader(value)}
}

type jsonReaderType struct {
	reader *strings.Reader
}

func (reader *jsonReaderType) Read(target []byte) (int, error) {
	return reader.reader.Read(target)
}
