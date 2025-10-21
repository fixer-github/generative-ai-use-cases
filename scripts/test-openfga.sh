#!/bin/bash

# OpenFGA Permission Testing Script
# Tests authorization logic after deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
OPENFGA_API_URL="${OPENFGA_API_URL:-http://localhost:8080}"
OPENFGA_STORE_ID="${OPENFGA_STORE_ID}"
OPENFGA_API_TOKEN="${OPENFGA_API_TOKEN}"

if [ -z "$OPENFGA_STORE_ID" ]; then
    echo -e "${RED}Error: OPENFGA_STORE_ID environment variable is not set${NC}"
    echo "Usage: export OPENFGA_STORE_ID=your-store-id"
    exit 1
fi

echo -e "${YELLOW}=====================================${NC}"
echo -e "${YELLOW}OpenFGA Authorization Test Suite${NC}"
echo -e "${YELLOW}=====================================${NC}"
echo ""
echo "API URL: $OPENFGA_API_URL"
echo "Store ID: $OPENFGA_STORE_ID"
echo ""

# Function to make OpenFGA API calls
openfga_api() {
    local method=$1
    local path=$2
    local data=$3

    if [ -n "$OPENFGA_API_TOKEN" ]; then
        AUTH_HEADER="-H \"Authorization: Bearer $OPENFGA_API_TOKEN\""
    else
        AUTH_HEADER=""
    fi

    if [ -n "$data" ]; then
        curl -s -X $method \
            -H "Content-Type: application/json" \
            $AUTH_HEADER \
            -d "$data" \
            "$OPENFGA_API_URL/stores/$OPENFGA_STORE_ID$path"
    else
        curl -s -X $method \
            -H "Content-Type: application/json" \
            $AUTH_HEADER \
            "$OPENFGA_API_URL/stores/$OPENFGA_STORE_ID$path"
    fi
}

# Test counter
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Function to run a permission check test
test_check() {
    local test_name=$1
    local user=$2
    local relation=$3
    local object=$4
    local expected=$5
    local context=$6

    TESTS_RUN=$((TESTS_RUN + 1))

    echo -n "Test $TESTS_RUN: $test_name ... "

    local payload="{\"user\":\"$user\",\"relation\":\"$relation\",\"object\":\"$object\""

    if [ -n "$context" ]; then
        payload="$payload,\"context\":$context"
    fi

    payload="$payload}"

    local response=$(openfga_api POST "/check" "$payload")
    local allowed=$(echo "$response" | jq -r '.allowed')

    if [ "$allowed" == "$expected" ]; then
        echo -e "${GREEN}PASS${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}FAIL${NC} (expected: $expected, got: $allowed)"
        echo "Response: $response"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Function to write tuples
write_tuple() {
    local user=$1
    local relation=$2
    local object=$3

    local payload="{\"writes\":[{\"user\":\"$user\",\"relation\":\"$relation\",\"object\":\"$object\"}]}"
    openfga_api POST "/write" "$payload" > /dev/null
}

echo -e "${YELLOW}Setting up test data...${NC}"

# Create test tenant and users
write_tuple "user:alice" "member" "tenant:acme"
write_tuple "user:bob" "admin" "tenant:acme"
write_tuple "user:charlie" "member" "tenant:globex"

# Assign plans
write_tuple "tenant:acme" "subscriber" "plan:pro"
write_tuple "tenant:globex" "subscriber" "plan:free"

# Set up plan permissions
write_tuple "usecase:chat" "allowed_by_plan" "plan:pro"
write_tuple "usecase:chat" "allowed_by_plan" "plan:free"
write_tuple "usecase:rag" "allowed_by_plan" "plan:pro"
write_tuple "model:claude-3-sonnet" "allowed_by_plan" "plan:pro"
write_tuple "model:claude-3-haiku" "allowed_by_plan" "plan:free"

# Create test resources
write_tuple "tenant:acme" "tenant" "conversation:123"
write_tuple "user:alice" "owner" "conversation:123"
write_tuple "user:bob" "viewer" "conversation:456"

write_tuple "tenant:acme" "tenant" "document:doc1"
write_tuple "user:alice" "owner" "document:doc1"

echo -e "${GREEN}Test data created${NC}"
echo ""

echo -e "${YELLOW}Running permission tests...${NC}"
echo ""

# Test 1: Tenant membership
test_check "Alice is member of acme" "user:alice" "view" "tenant:acme" "true"

# Test 2: Tenant admin
test_check "Bob can manage acme" "user:bob" "manage" "tenant:acme" "true"

# Test 3: Non-member access
test_check "Charlie cannot view acme" "user:charlie" "view" "tenant:acme" "false"

# Test 4: Conversation ownership
test_check "Alice can view her conversation" "user:alice" "view" "conversation:123" "true"

# Test 5: Conversation editing
test_check "Alice can edit her conversation" "user:alice" "edit" "conversation:123" "true"

# Test 6: Conversation deletion by owner
test_check "Alice can delete her conversation" "user:alice" "delete" "conversation:123" "true"

# Test 7: Conversation deletion by admin
test_check "Bob (admin) can delete conversation" "user:bob" "delete" "conversation:123" "true"

# Test 8: Conversation viewer cannot edit
test_check "Bob (viewer) cannot edit conversation 456" "user:bob" "edit" "conversation:456" "false"

# Test 9: Document upload permission
test_check "Alice can upload documents" "user:alice" "upload" "document:new" "true"

# Test 10: Document view by owner
test_check "Alice can view her document" "user:alice" "view" "document:doc1" "true"

# Test 11: Usecase access - Pro plan
test_check "Alice (pro) can execute chat" "user:alice" "execute" "usecase:chat" "true"

# Test 12: Usecase access - Pro exclusive
test_check "Alice (pro) can execute RAG" "user:alice" "execute" "usecase:rag" "true"

# Test 13: Usecase access - Free plan limitation
test_check "Charlie (free) cannot execute RAG" "user:charlie" "execute" "usecase:rag" "false"

# Test 14: Model access - Pro plan
test_check "Alice (pro) can use Claude Sonnet" "user:alice" "execute" "model:claude-3-sonnet" "true"

# Test 15: Model access - Free plan limitation
test_check "Charlie (free) cannot use Claude Sonnet" "user:charlie" "execute" "model:claude-3-sonnet" "false"

# Test 16: Model access - Free plan allowed
test_check "Charlie (free) can use Claude Haiku" "user:charlie" "execute" "model:claude-3-haiku" "true"

# Test 17: Quota check - under limit
echo -n "Test 17: Quota check (under limit) ... "
TESTS_RUN=$((TESTS_RUN + 1))
write_tuple "user:alice" "user" "model_with_quota:claude-3-sonnet"
write_tuple "user:alice" "quota_checker" "model_with_quota:claude-3-sonnet"
quota_context='{"current_usage":10,"quota_limit":50}'
test_check "Alice within quota" "user:alice" "execute" "model_with_quota:claude-3-sonnet" "true" "$quota_context"

# Test 18: Quota check - exceeded
echo -n "Test 18: Quota check (exceeded) ... "
TESTS_RUN=$((TESTS_RUN + 1))
quota_context_exceeded='{"current_usage":51,"quota_limit":50}'
test_check "Alice exceeded quota" "user:alice" "execute" "model_with_quota:claude-3-sonnet" "false" "$quota_context_exceeded"

echo ""
echo -e "${YELLOW}=====================================${NC}"
echo -e "${YELLOW}Test Summary${NC}"
echo -e "${YELLOW}=====================================${NC}"
echo "Total tests: $TESTS_RUN"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"

if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}Failed: $TESTS_FAILED${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi
